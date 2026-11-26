import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { armScenario, runRehearsal } from "../server/rehearsal.mjs"
const scenarios = JSON.parse(readFileSync(new URL("../server/scenarios.json", import.meta.url)))

for (const scenario of scenarios) {
  test(`${scenario.id}: switching on captures treatment, switching off measures both outcomes`, async () => {
    let enabled = false
    const flag = {
      async setEnabled(value) { enabled = value },
      async evaluate() { return enabled ? "treatment" : "control" },
    }
    const captured = await armScenario(flag, scenario)
    assert.equal(enabled, true)
    assert.equal(captured.capture.assignment, "treatment")
    const report = await runRehearsal(flag, scenario, captured)
    assert.equal(enabled, false)
    assert.equal(report.flag, scenario.flag)
    assert.equal(report.original.steps.at(-1).httpStatus, scenario.failureStatus)
    assert.equal(report.revised.steps.at(-2).httpStatus, scenario.successStatus)
    assert.equal(report.original.steps[2].assignment, "control")
    assert.equal(report.original.steps[0].capturedAt, captured.steps[0].capturedAt)
    assert.deepEqual(report.original.final, report.revised.final)
  })
}
