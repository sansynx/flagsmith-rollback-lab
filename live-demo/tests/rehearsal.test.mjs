import assert from "node:assert/strict"
import { test } from "node:test"
import { runRehearsal } from "../server/rehearsal.mjs"

test("a live checkout replay derives the drain guard from the failed ordering", async () => {
  let enabled = false
  const evidence = await runRehearsal({
    async setEnabled(value) { enabled = value },
    async evaluate() { return enabled ? "treatment" : "control" },
  })
  assert.equal(evidence.status, "verified")
  assert.deepEqual(evidence.original.steps.map(step => step.action), [
    "Open checkout", "Disable treatment", "Open fresh checkout", "Retire v2 handler", "Submit original checkout",
  ])
  assert.equal(evidence.original.steps.at(-1).httpStatus, 410)
  assert.equal(evidence.original.steps[3].pendingTreatment, 1)
  assert.equal(evidence.revised.steps.at(-2).httpStatus, 201)
  assert.equal(evidence.revised.steps.at(-1).pendingTreatment, 0)
  assert.deepEqual(evidence.original.final, evidence.revised.final)
  for (const run of [evidence.original, evidence.revised]) {
    assert.equal(run.steps[0].assignment, "treatment")
    assert.equal(run.steps[2].assignment, "control")
  }
  assert.equal(enabled, false)
})

test("the agent restores control when its sandbox can't confirm treatment", async () => {
  const settings = []
  await assert.rejects(runRehearsal({
    async setEnabled(value) { settings.push(value) },
    async evaluate() { return "control" },
  }), /expected treatment/)
  assert.deepEqual(settings, [true, false])
})
