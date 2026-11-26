import { randomBytes, randomUUID } from "node:crypto"
import { isIP } from "node:net"
import { resetScopeFlags, scopeFlag } from "./flagsmith.mjs"
import { armScenario, finishSession, runRehearsal, scenarios } from "./rehearsal.mjs"

import { createStorefront, registerStorefront, retireStorefront } from "./storefront.mjs"

const COOKIE = "rollback_sandbox"
const LEASE_MS = 20 * 60 * 1000
const VISITOR_LIMIT = 200
const ACTIVE_PER_ADDRESS = 4
const flagNames = scenarios.map(scenario => scenario.flag)

export function registerReviewerRoutes(app, config) {
  const leases = new Map()
  const slots = config.pool.map(scope => ({ scope, inUse: false }))

  function clientToken(request) {
    const header = request.get("X-Rehearsal-Session") ?? ""
    if (/^[0-9a-f]{48}$/.test(header)) return header
    return (request.get("Cookie") ?? "").match(/(?:^|;\s*)rollback_sandbox=([0-9a-f]{48})(?:;|$)/)?.[1]
  }

  function visitor(request) {
    const key = clientToken(request)
    const lease = key && leases.get(key)
    return lease && (lease.busy || lease.expires > Date.now()) ? lease : null
  }

  function release(lease) {
    if (!lease.slot) return
    lease.slot.inUse = false
    lease.slot = undefined
    lease.ready = false
  }

  function collectExpired() {
    for (const [key, lease] of leases) {
      if (!lease.busy && lease.expires <= Date.now()) {
        release(lease)
        leases.delete(key)
      }
    }
  }

  function allocate(address, token) {
    if (leases.size >= VISITOR_LIMIT) {
      const idle = [...leases.values()].find(lease => !lease.slot && !lease.busy)
      if (!idle) return null
      leases.delete(idle.id)
    }
    const id = token ?? randomBytes(24).toString("hex")
    const lease = { id, address, expires: Date.now() + LEASE_MS, busy: false, ready: false, state: new Map() }
    leases.set(id, lease)
    return lease
  }

  function view(state) {
    return { enabled: Boolean(state?.armed), assignment: state?.armed?.capture.assignment ?? "control",
      opened: state?.armed?.steps[0], payments: state?.payments, evidence: state?.evidence, recovery: Boolean(state?.recovery) }
  }

  app.post("/api/presenter/shop", (request, response) => {
    if (request.get("X-Rehearsal-Request") !== "run") return response.sendStatus(403)
    const owner = request.get("X-Rehearsal-Session")
    if (!/^[a-f0-9]{48}$/.test(owner ?? "")) return response.status(400).json({ message: "Refresh the presenter to start a session." })
    collectExpired()
    const address = request.get("CF-Connecting-IP") ?? request.socket.remoteAddress
    const lease = visitor(request) ?? allocate(address, owner)
    if (!lease) return response.status(503).json({ message: "The demo is busy. Try again shortly." })
    lease.shop ??= createStorefront()
    lease.expires = Date.now() + LEASE_MS
    return response.json({ path: `/shop/${lease.shop.key}`, checkout: view(lease.state.get("checkout")) })
  })

  app.get("/api/presenter/status", (request, response) => {
    const lease = visitor(request)
    if (!lease?.shop) return response.status(404).json({ message: "This session expired. Reload the presenter to start again." })
    const carts = [...lease.shop.carts.values()]
    response.json({ enabled: Boolean(lease.state.get("checkout")?.armed),
      unverified: Boolean(lease.state.get("checkout")?.recovery), changing: lease.busy,
      connected: Date.now() - (lease.shop.lastSeen ?? 0) < 20000,
      open: carts.filter(cart => !cart.payment).length,
      paid: carts.filter(cart => cart.payment?.status === 201).length,
      failed: carts.filter(cart => cart.payment?.status === 410).length })
  })

  registerStorefront(app, key => {
    if (!/^[a-f0-9]{48}$/.test(key)) return null
    for (const lease of leases.values()) {
      if (lease.shop?.key === key && (lease.busy || lease.expires > Date.now())) return lease
    }
    return null
  })

  app.get("/api/scenarios", (_, response) => response.json(scenarios.map(scenario => ({
    id: scenario.id, title: scenario.title, flag: scenario.flag, description: scenario.description,
    expectedOriginal: scenario.failureStatus, expectedRevised: scenario.successStatus,
  }))))

  app.get("/api/session", (request, response) => {
    const lease = visitor(request)
    response.json(Object.fromEntries(scenarios.map(scenario => [scenario.id, view(lease?.state.get(scenario.id))])))
  })

  app.post("/api/scenarios/checkout/pay", (request, response) => {
    if (request.get("X-Rehearsal-Request") !== "run") return response.sendStatus(403)
    const lease = visitor(request)
    if (lease?.busy) return response.status(409).json({ message: "The flag is changing. Try again in a moment." })
    const current = lease?.state.get("checkout")
    const { plan, capturedAt } = request.body ?? {}
    const replay = current?.evidence
    const capture = current?.armed?.capture ?? replay?.original.steps[0]
    if (!capture || capturedAt !== capture.capturedAt || current.recovery) {
      return response.status(409).json({ message: "This checkout has changed or expired. Refresh to reopen it." })
    }
    if (current.armed ? plan !== "live" : plan !== "original" && plan !== "revised") {
      return response.status(409).json({ message: "The rollback plan has changed. Refresh the checkout." })
    }
    lease.expires = Date.now() + LEASE_MS
    current.payments ??= {}
    let payment = current.payments[plan]
    if (!payment) {
      const scenario = scenarios.find(item => item.id === "checkout")
      // Fork the captured order immediately before Pay in the chosen verified timeline.
      const steps = replay?.[plan]?.steps
      const beforePay = steps ? steps[steps.findIndex(step => step.action === scenario.finish) - 1] : current.armed.steps[0]
      const outcome = finishSession(scenario, { ...capture, complete: false }, capture.artifact, beforePay.handlerAvailable)
      payment = { status: outcome.status, message: outcome.body.result, plan, capturedAt,
        ...(outcome.status === 201 && { receipt: randomUUID().slice(0, 8).toUpperCase() }) }
      current.payments[plan] = payment
    }
    return response.status(payment.status).json(payment)
  })

  app.post("/api/scenarios/:id/toggle", (request, response, next) => {
    if (request.get("X-Rehearsal-Request") !== "run") return response.sendStatus(403)
    next()
  }, async (request, response) => {
    const scenario = scenarios.find(candidate => candidate.id === request.params.id)
    const enabled = request.body?.enabled
    if (!scenario) return response.status(404).json({ message: "Unknown scenario." })
    if (typeof enabled !== "boolean") return response.status(400).json({ message: "Send enabled as a boolean." })

    const policy = request.body?.policy ?? "protected"
    if (!["protected", "immediate"].includes(policy)) return response.status(400).json({ message: "Unknown rollback policy." })
    collectExpired()
    const prior = visitor(request)
    if (prior?.busy) return response.status(409).json({ message: "Your sandbox is already running a rehearsal." })
    let current = prior?.state.get(scenario.id)
    if (!enabled && !current?.armed) {
      return current?.evidence
        ? response.json(view(current))
        : response.status(409).json({ message: "Turn the flag on first to capture a session." })
    }

    const edgeAddress = request.get("CF-Connecting-IP") ?? ""
    const address = prior?.address ?? (isIP(edgeAddress) ? edgeAddress : request.socket.remoteAddress)
    const slot = prior?.slot ?? slots.find(candidate => !candidate.inUse)
    if (!slot) return response.status(503).json({ message: "All sandboxes are in use. Try again shortly." })
    if (!prior?.slot) {
      const activeHere = [...leases.values()].filter(lease => lease.slot && lease.address === address).length
      if (activeHere >= ACTIVE_PER_ADDRESS) return response.status(429).json({ message: "Finish a rehearsal you started, then try again." })
    }

    const lease = prior ?? allocate(address, clientToken(request))
    if (!lease) return response.status(503).json({ message: "The demo is busy. Try again shortly." })
    slot.inUse = true
    lease.slot = slot
    lease.busy = true
    lease.expires = Date.now() + LEASE_MS
    response.cookie(COOKIE, lease.id, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: LEASE_MS,
      secure: request.get("X-Forwarded-Proto") === "https",
    })
    try {
      const flag = scopeFlag(config, slot.scope, scenario.flag)
      if (!lease.ready) {
        await resetScopeFlags(config, lease.slot.scope, flagNames)
        lease.ready = true
      }
      if (enabled && current?.armed) {
        if (await flag.evaluate() !== "treatment") {
          lease.state.delete(scenario.id)
          throw new Error("An armed session lost its treatment flag")
        }
      } else if (enabled) {
        current = { armed: await armScenario(flag, scenario) }
        lease.state.set(scenario.id, current)
      } else {
        const armed = current.armed
        current = { evidence: await runRehearsal(flag, scenario, armed) }
        if (scenario.id === "checkout" && lease.shop) retireStorefront(lease.shop, armed.capture.capturedAt, policy)
        lease.state.set(scenario.id, current)
      }
      return response.json(view(current))
    } catch (error) {
      if (!enabled && current?.armed) lease.state.set(scenario.id, { ...current, recovery: true })
      console.error("Reviewer rehearsal failed:", error.message)
      return response.status(503).json({ message: current?.armed && !enabled
        ? "The rollback couldn’t be verified. The original session is saved. Switch off to retry."
        : "The local flag couldn’t be verified. Try switching it on again." })
    } finally {
      lease.busy = false
      if (![...lease.state.values()].some(state => state.armed)) release(lease)
    }
  })
}
