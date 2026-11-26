#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
umask 077
mkdir -p .runtime
if [ ! -f .env ]; then
  printf 'ROLLBACK_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env
fi
project="${COMPOSE_PROJECT_NAME:-flagsmith-rollback-lab}"
if docker info >/dev/null 2>&1; then
  compose=(docker compose --project-name "$project")
else
  compose=(sudo -n docker compose --project-name "$project")
fi
"${compose[@]}" up -d --wait --wait-timeout 150
address=$("${compose[@]}" port flagsmith 8000)
if [ ! -f .runtime/flagsmith.json ] || ! node --input-type=module -e 'import { readFileSync } from "node:fs"; const config = JSON.parse(readFileSync(".runtime/flagsmith.json")); if(config.version !== 2 || config.pool?.length !== 20 || config.origin !== "http://"+process.argv[1]) process.exit(1); import { localFlagsmith } from "./server/flagsmith.mjs"; await (await localFlagsmith()).evaluate()' "$address" >/dev/null 2>&1; then
  python3 - <<'SEED' | "${compose[@]}" exec -T flagsmith flagsmith shell |
import json
from pathlib import Path
print("SCENARIO_FLAGS = " + repr([scenario["flag"] for scenario in json.loads(Path("server/scenarios.json").read_bytes())]))
print(Path("server/seed.py").read_text())
SEED
    python3 -c 'import json, sys; marker = "ROLLBACK_CONFIG="; rows = [line[len(marker):] for line in sys.stdin if line.startswith(marker)]; assert len(rows) == 1, "Flagsmith setup produced no credentials"; obj = json.loads(rows[0]); obj["origin"] = "http://" + sys.argv[1]; print(json.dumps(obj))' "$address" > .runtime/flagsmith.json.tmp
  mv .runtime/flagsmith.json.tmp .runtime/flagsmith.json
fi
