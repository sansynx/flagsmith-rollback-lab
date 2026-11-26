import { readFile } from "node:fs/promises"

export async function readFlagsmithConfig() {
  const config = JSON.parse(await readFile(new URL("../.runtime/flagsmith.json", import.meta.url), "utf8"))
  const base = new URL(config.origin)
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || !base.port || base.origin !== config.origin) {
    throw new Error("Expected the isolated loopback Flagsmith origin")
  }
  if (config.version !== 2 || config.pool?.length !== 20) throw new Error("Run make setup to provision reviewer sandboxes")
  return config
}

async function request(config, path, options) {
    const response = await fetch(new URL(path, config.origin), {
      ...options, redirect: "error", signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Local Flagsmith returned HTTP ${response.status}`)
    return response.json()
  }

export function scopeFlag(config, scope, flagName) {
  const stateId = scope.states[flagName]
  if (!Number.isInteger(stateId)) throw new Error("Scenario flag is missing from the local scope")
  return {
    async setEnabled(enabled) {
      const state = await request(config, `/api/v1/environments/${encodeURIComponent(scope.environmentKey)}/featurestates/${stateId}/`, {
        method: "PATCH",
        headers: { Authorization: `Api-Key ${config.managementKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      if (state.enabled !== enabled) throw new Error("The Flagsmith flag update did not take effect")
    },
    async evaluate() {
      const states = await request(config, "/api/v1/flags/", { headers: { "X-Environment-Key": scope.environmentKey } })
      const flag = states.find(state => state.feature?.name === flagName)
      if (typeof flag?.enabled !== "boolean") throw new Error(`${flagName} is missing from the Flagsmith SDK response`)
      return flag.enabled ? "treatment" : "control"
    },
  }
}

export async function localFlagsmith(flagName = "checkout_v2") {
  const config = await readFlagsmithConfig()
  return scopeFlag(config, config.default, flagName)
}

export async function resetScopeFlags(config, scope, names) {
  const live = await request(config, "/api/v1/flags/", { headers: { "X-Environment-Key": scope.environmentKey } })
  const enabled = new Map(live.map(state => [state.feature?.name, state.enabled]))
  for (const flag of names) {
    const value = enabled.get(flag)
    if (typeof value !== "boolean") throw new Error("A scenario flag is missing from the reviewer scope")
    if (value) await scopeFlag(config, scope, flag).setEnabled(false)
  }
}
