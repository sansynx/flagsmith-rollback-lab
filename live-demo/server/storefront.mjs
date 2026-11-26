import { randomBytes, randomUUID } from "node:crypto"
import { finishSession, scenarios } from "./rehearsal.mjs"

const checkout = scenarios.find(item => item.id === "checkout")
const maxCarts = 64
const validCart = /^[a-f0-9]{32}$/

export function createStorefront() {
  return { key: randomBytes(24).toString("hex"), carts: new Map() }
}

// The rollout decides the fate of orders already open. A later rollout must
// never retroactively change a decision made for an earlier generation.
export function retireStorefront(room, generation, policy) {
  for (const cart of room.carts.values()) {
    if (cart.generation === generation && !cart.payment) cart.handlerAvailable = policy === "protected"
  }
}

export function registerStorefront(app, lookup) {
  app.use("/api/shop/:key", (req, res, next) => {
    const lease = lookup(req.params.key)
    if (!lease) return res.status(404).json({ message: "This shop link has expired. Open a fresh link from the presenter." })
    res.locals.lease = lease
    next()
  })

  function shopView(lease) {
    return { enabled: Boolean(lease.state.get("checkout")?.armed), changing: lease.busy,
      unverified: Boolean(lease.state.get("checkout")?.recovery) }
  }

  function cartView(cart) {
    return cart ? { assignment: cart.assignment, payment: cart.payment } : null
  }

  app.get("/api/shop/:key", (req, res) => {
    const lease = res.locals.lease
    lease.shop.lastSeen = Date.now()
    res.json({ ...shopView(lease), cart: cartView(lease.shop.carts.get(req.get("X-Shop-Cart"))) })
  })

  app.post("/api/shop/:key/:action", (req, res) => {
    if (req.get("X-Rehearsal-Request") !== "run") return res.sendStatus(403)
    const id = req.get("X-Shop-Cart") ?? ""
    if (!validCart.test(id)) return res.status(400).json({ message: "Open this checkout again to start an order." })
    const lease = res.locals.lease
    const state = lease.state.get("checkout")
    if (lease.busy || state?.recovery) return res.status(409).json({ message: "The flag is changing. Try again in a moment." })
    const carts = lease.shop.carts
    const action = req.params.action
    let cart = carts.get(id)
    if (action === "open") {
      if (!cart) {
        if (carts.size >= maxCarts) return res.status(429).json({ message: "This demo shop has reached its order limit. Start a fresh presenter session." })
        const capture = state?.armed?.capture
        cart = { assignment: capture?.assignment ?? "control", artifact: capture?.artifact ?? "control",
          generation: capture?.capturedAt, handlerAvailable: true, complete: false }
        carts.set(id, cart)
      }
    } else if (action === "pay") {
      if (!cart) return res.status(409).json({ message: "Open an order before paying." })
      if (!cart.payment) {
        const result = finishSession(checkout, cart, cart.artifact, cart.handlerAvailable)
        cart.payment = { status: result.status, ...(result.status === 201 && { receipt: randomUUID().slice(0, 8).toUpperCase() }) }
      }
      return res.status(cart.payment.status).json({ ...shopView(lease), cart: cartView(cart) })
    } else {
      return res.sendStatus(404)
    }
    return res.json({ ...shopView(lease), cart: cartView(cart) })
  })
}
