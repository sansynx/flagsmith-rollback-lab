import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { readFlagsmithConfig } from "../server/flagsmith.mjs"

const skill = fileURLToPath(new URL("../../skills/rehearse-flag-rollback/", import.meta.url))
const config = await readFlagsmithConfig()
const host = new URL(config.origin).host.replaceAll(".", "_").replaceAll(":", "_")
const env = { ...process.env, [`FLAGSMITH_API_KEY_${host}`]: config.managementKey }
const cli = spawnSync("flagsmith", [
  "--no-input", "--api-url", config.origin, "project", "get", "Checkout rehearsal", "--jq", ".id",
], { env, encoding: "utf8" })
if (cli.error?.code === "ENOENT") throw new Error("Install Flagsmith CLI v2.0.0 to run the skill demo")
if (cli.status !== 0 || !/^[1-9]\d*$/.test(cli.stdout.trim())) {
  throw new Error("Could not resolve the seeded project on the local Flagsmith instance")
}

const result = spawnSync("python3", [
  "scripts/rehearse.py", "--api-url", config.origin, "--sdk-api-url", config.origin,
  "--project", cli.stdout.trim(), "--source", config.default.environmentKey, "--flag", "checkout_v2",
  "--probe", "examples/queue_probe.py", "--plan", "immediate", "--plan", "drain",
  "--check", "fresh_legacy_job", "--check", "inflight_delivered_once",
], { cwd: skill, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })

if (result.error) throw result.error
process.stdout.write(result.stdout)
assert.equal(result.status, 1, "The comparison must reproduce the immediate-retirement failure")
const receipt = JSON.parse(result.stdout)
assert.equal(receipt.cleanup, "verified")
assert.equal(receipt.verdict, "fail")
assert.deepEqual(receipt.plans, {
  immediate: { fresh_legacy_job: true, inflight_delivered_once: false },
  drain: { fresh_legacy_job: true, inflight_delivered_once: true },
})
