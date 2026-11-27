# Working on Rollback Rehearsal

Run commands from the repository root unless a command changes directories. For judging, start with `make demo` and `make skill-demo`. The prerequisites and expected results are in [README.md](README.md). For an agent performing a rollback rehearsal, the instructions are in [SKILL.md](skills/rehearse-flag-rollback/SKILL.md).

## Where changes belong

| Change | Source | Verification |
| --- | --- | --- |
| Flagsmith provisioning or API access | `live-demo/compose.yaml`, `live-demo/scripts/setup.sh`, `live-demo/server/seed.py`, `live-demo/server/flagsmith.mjs` | `make demo` and `make skill-demo` against a fresh Compose project |
| Replays or storefront behavior | `live-demo/server/` and `live-demo/src/` | `make test`, `make demo` and the browser walkthrough below |
| Agent skill, runner or probe | `skills/rehearse-flag-rollback/` | `python3 -m unittest discover -s tests/skills -v` and `make skill-demo`. Record intentional differences from the upstream revision in the README. |
| Python targeting and offline history | `rollout_rehearsal/`, `examples/`, `tests/` | Install the package in a virtualenv, then run `python -m unittest discover -s tests -v`. For SDK parity run `python tests/reference/run.py` with Docker available. |
| Offline history dashboard | `dashboard-ui/src/` | Run `npm ci`, `npm run typecheck` and `npm run build` in `dashboard-ui/`. Commit its rebuilt assets in `rollout_rehearsal/dashboard_assets/` alongside the source. |

## Release behavior to preserve

- Verify a flag write by reading what the SDK serves. Capture the original session once, and test both its completion and a fresh visitor's assignment. Compare the final flag and handler state across policies.
- Scope rehearsal writes to the local demo or the skill's verified disposable clone. The queue example's mixed result is expected. Check the per-policy observations and cleanup status before interpreting an exit code.
- Keep the management key on the server. Setup generates `live-demo/.env` and `live-demo/.runtime/` locally. Keep them out of commits and logs. Use synthetic orders, identities and fixtures.

## Browser checks

Start `make web` in one terminal. In another, run:

```sh
cd live-demo
npm run typecheck
npx playwright install chromium
node tests/live-shop-browser.mjs
node tests/shopper-browser.mjs
node tests/browser.mjs
```

The app defaults to port 4197. Use `PORT` on the server and `BROWSER_URL` on the tests to select another address. `CHROME_PATH` selects an installed Chromium executable. The [CI workflow](.github/workflows/test.yml) also builds the offline history dashboard and runs the Docker-backed reference check.

## Video production

For video creation or editing, open the installed `remotion-best-practices` skill from `remotion-dev/skills` and follow its creation, markup, preview and rendering guidance. Check the exported duration and streams, then inspect representative frames. Keep generated media and narration in the ignored local workspace.
