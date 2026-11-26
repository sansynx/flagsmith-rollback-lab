import assert from "node:assert/strict"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"

export const scenarios = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url), "utf8"))
const OFF = "Disable treatment"

export function finishSession(scenario, session, artifact, handlerAvailable) {
  if (!session || session.complete || session.artifact !== artifact) {
    return { status: 409, body: { result: "No matching pending session" } }
  }
  if (session.assignment === "treatment" && !handlerAvailable) {
    return { status: scenario.failureStatus, body: { assignment: session.assignment, result: scenario.failure } }
  }
  session.complete = true
  return { status: scenario.successStatus, body: { assignment: session.assignment, result: scenario.success } }
}

async function sandbox(flags, scenario, schedule, { armed, guarded = false } = {}) {
  const sessions = new Map(armed ? [["original", { ...armed.capture }]] : [])
  const pending = () => [...sessions.values()].filter(session => session.assignment === "treatment" && !session.complete).length
  let handlerAvailable = true
  let flagEnabled = true

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1")
    const send = (status, body) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))
    try {
      if (request.method === "POST" && (url.pathname === "/open/original" || url.pathname === "/open/fresh")) {
        const actor = url.pathname.split("/").at(-1)
        const assignment = await flags.evaluate()
        const artifact = assignment === "treatment" ? scenario.artifact : "control"
        sessions.set(actor, { assignment, artifact, complete: false, capturedAt: new Date().toISOString() })
        const result = scenario.id === "checkout" ? `${assignment} checkout opened` : `${assignment} session opened`
        return send(200, { assignment, artifact, capturedAt: sessions.get(actor).capturedAt, result })
      }
      if (request.method !== scenario.method || url.pathname !== scenario.path) {
        return send(404, { result: "Unknown fixture action" })
      }
      const session = sessions.get("original")
      const { status, body } = finishSession(scenario, session, url.searchParams.get("artifact"), handlerAvailable)
      return send(status, body)
    } catch {
      return send(503, { result: "Flagsmith assignment unavailable" })
    }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = `http://127.0.0.1:${server.address().port}`
  const steps = armed ? [...armed.steps] : []
  try {
    if (!armed) await flags.setEnabled(true)
    for (const action of schedule) {
      const step = { action }
      if (action === OFF) {
        await flags.setEnabled(false)
        flagEnabled = false
        step.result = "New treatment assignments disabled in Flagsmith"
      } else if (action === scenario.retire) {
        if (guarded && (flagEnabled || pending() !== 0)) throw new Error("Retirement requires control and zero pending treatment sessions")
        handlerAvailable = false
        step.result = guarded ? "Handler retired after its last session finished" : "Handler retired immediately"
      } else {
        const finish = action === scenario.finish
        const path = finish
          ? `${scenario.path}?artifact=${encodeURIComponent(sessions.get("original")?.artifact ?? "")}`
          : action === scenario.fresh ? "/open/fresh" : "/open/original"
        const method = finish ? scenario.method : "POST"
        const response = await fetch(address + path, { method, signal: AbortSignal.timeout(12000) })
        Object.assign(step, await response.json(), { httpStatus: response.status, request: `${method} ${finish ? scenario.path : path}` })
        if (!finish) {
          const expected = action === scenario.open ? "treatment" : "control"
          if (response.status !== 200 || step.assignment !== expected) {
            throw new Error(`Session expected ${expected}; received ${step.assignment ?? "no assignment"}`)
          }
        }
      }
      steps.push({ ...step, pendingTreatment: pending(), handlerAvailable, flagEnabled })
    }
    return { steps, final: { flagEnabled, handlerAvailable }, capture: sessions.get("original") }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

export async function armScenario(flags, scenario = scenarios[0]) {
  try {
    return await sandbox(flags, scenario, [scenario.open])
  } catch (error) {
    await flags.setEnabled(false)
    throw error
  }
}

export async function runRehearsal(flags, scenario = scenarios[0], armed) {
  try {
    const original = await sandbox(flags, scenario, [
      ...(armed ? [] : [scenario.open]), OFF, scenario.fresh, scenario.retire, scenario.finish,
    ], { armed })
    const retirement = original.steps.find(step => step.action === scenario.retire)
    const failure = original.steps.find(step => step.action === scenario.finish)
    if (!retirement.pendingTreatment || failure.assignment !== "treatment" || failure.httpStatus !== scenario.failureStatus) {
      throw new Error("The proposed counterexample was not reproduced")
    }
    const revisedOrder = original.steps.map(step => step.action).filter(action => action !== scenario.retire)
    revisedOrder.splice(revisedOrder.indexOf(failure.action) + 1, 0, scenario.retire)
    const replayStart = armed ?? { capture: original.capture, steps: [original.steps[0]] }
    const revised = await sandbox(flags, scenario, revisedOrder.slice(1), { armed: replayStart, guarded: true })
    assert.equal(revised.steps.find(step => step.action === scenario.finish).httpStatus, scenario.successStatus, "Existing session must complete")
    assert.equal(revised.steps.at(-1).pendingTreatment, 0, "Retirement must see a drained treatment")
    assert.deepEqual(revised.final, original.final, "Both plans must end with the same flag and handler state")
    delete original.capture
    delete revised.capture
    return {
      status: "verified", generatedAt: new Date().toISOString(), flag: scenario.flag, scenario: scenario.id,
      counterexample: [scenario.open, OFF, scenario.retire, scenario.finish],
      rule: `Disable new treatment sessions. Retire the ${scenario.resource} only when pending treatment sessions reach zero.`,
      original, revised,
    }
  } finally {
    await flags.setEnabled(false)
  }
}
