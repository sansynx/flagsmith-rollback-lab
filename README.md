# Rollback Rehearsal

What happens to the shopper who already has express checkout open when you turn its flag off? Rollback Rehearsal lets you press Pay and see the result. Built for **Toggle Wars, Track 03 · Build on Open Source Flagsmith**.

[Watch the 92-second submission video](https://flagsmith-rollback-lab.vercel.app/watch) · [Open the hosted demo](https://flagsmith-rollback-lab.vercel.app/presenter) · [Explore the rehearsal lab](https://flagsmith-rollback-lab.vercel.app/)

Vercel serves the frontend. The hosted API reaches the self-hosted Flagsmith sandbox through a Cloudflare tunnel. The local setup below runs independently.

## Run the project

Install Node.js 24, Python 3.10+, Docker with Compose v2, Make and OpenSSL. Run these commands from the repository root on Linux or macOS with Docker running.

```sh
make demo
make web
```

`make demo` starts the pinned local Flagsmith and PostgreSQL containers, provisions disposable credentials, and verifies six rollback scenarios. Each prints the original and revised HTTP outcomes and saves machine-readable evidence in `live-demo/.runtime/evidence.json`. The checkout example returns **410 Gone** followed by **201 Created**. The command exits nonzero if verification fails.

`make web` installs the frontend dependencies, builds the dashboard and serves the site at **http://127.0.0.1:4197**. Open **/presenter**, then **Open live shop** in a second window. No sign-in is needed. All payments are synthetic.

1. Switch on `checkout_v2`. The paired shop changes from standard to express checkout without reloading. Start an express order.
2. Choose **Retire express checkout immediately** and switch off. Return to the existing order and press **Pay**. New shoppers see standard checkout. The existing order fails.
3. Return to the shop and repeat with **Let open orders finish**. Pay now produces a demo receipt. The presenter shows counts for open, paid and failed orders.
4. Visit **/** for checkout, upload, booking, export, onboarding and pricing scenarios. Switch a scenario on and off to capture its session and replay both orders. Compare **Original plan** and **Revised plan** under **Run evidence**, then download the result under **Agent proposal**.

To release the local containers when finished, run `docker compose --project-name flagsmith-rollback-lab --project-directory live-demo down`. If you set a different `COMPOSE_PROJECT_NAME`, use that project name.

## Where Flagsmith fits

- Docker Compose runs open-source Flagsmith 2.292.0 and PostgreSQL. A Python provisioning script creates the six feature flags and the isolated environments used by the demo.
- The Node server writes the selected feature state through the Flagsmith Management API. It reads the SDK flags endpoint to verify the assignment before exposing it to the paired shop. The credentials stay on the server. Each storefront polls its presenter's confirmed state and pins an order's assignment when checkout opens.
- The rehearsal engine captures a synthetic in-flight session, tries the original retirement order against an HTTP fixture, then replays the same session with retirement moved after completion. It checks the actual responses, the number of pending sessions, and the final state of the flag and handler. The planner covers these six workflows. It is deterministic.
- The included **Python targeting CLI** answers a separate release question: which saved personas would see a feature after a targeting edit? It uses the actual Flagsmith Python SDK evaluator and can run against an offline snapshot. [Python setup, examples and tests](docs/python-cli.md)

## Verify the implementation

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
make test
npm --prefix live-demo ci
npm --prefix live-demo run typecheck
npm --prefix live-demo run build
```

For the end-to-end browser tests, keep `make web` running. In another terminal:

```sh
cd live-demo
npx playwright install chromium
node tests/live-shop-browser.mjs
node tests/shopper-browser.mjs
node tests/browser.mjs
```

Set `CHROME_PATH` to use an installed Chromium executable. Use `PORT` to choose another app port and `BROWSER_URL` to point the browser tests at it. The [demo guide](live-demo/public/demo.md) includes the no-login API walkthrough.

## Source layout

| Directory | What it contains |
| --- | --- |
| live-demo/server, live-demo/scripts | Flagsmith integration, Python provisioner, store sessions, rollback planner and verifier |
| live-demo/src | React, TypeScript, shadcn/ui dashboard, presenter and shop |
| rollout_rehearsal, examples | Python targeting CLI, offline reports and synthetic example data |
| dashboard-ui | Source for the Python CLI's offline history dashboard |
| tests, live-demo/tests | Python, Node and browser regression tests |

The Python targeting tool predates the event. This submission brings it together with the six-scenario rollback lab and paired storefront. The [event rules](https://www.wemakedevs.org/hackathons/flagsmith/rules) allow a head start. The UI uses shadcn/ui components and credits the event artwork in the [live-demo README](live-demo/README.md).
