import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { localFlagsmith } from "./flagsmith.mjs"
import { armScenario, runRehearsal, scenarios } from "./rehearsal.mjs"

const evidence = []
for (const scenario of scenarios) {
  const flag = await localFlagsmith(scenario.flag)
  const report = await runRehearsal(flag, scenario, await armScenario(flag, scenario))
  assert.equal(report.status, "verified")
  assert.equal(report.original.steps.at(-1).httpStatus, scenario.failureStatus)
  assert.equal(report.revised.steps.at(-2).httpStatus, scenario.successStatus)
  assert.deepEqual(report.original.final, report.revised.final)
  console.log(`${scenario.title}: HTTP ${scenario.failureStatus} → ${scenario.successStatus}; fresh visitor control; final state identical`)
  evidence.push(report)
}
await writeFile(new URL("../.runtime/evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 })
console.log("\nVerified all six scenarios. Evidence written to .runtime/evidence.json.")
