# Rollback Rehearsal

A shopper opens express checkout. You turn its feature flag off, and new shoppers go back to standard checkout. The shopper who already has a payment open still needs the express handler. When can you safely retire it?

Rollback Rehearsal lets you try both orders against self-hosted Flagsmith and see what happens to the same pending payment. The lab supplies the storefront and six reproducible scenarios. The companion agent skill takes that workflow to another application through a small test fixture. [Watch the checkout demo on YouTube](https://youtu.be/_Q_UA8obmvI)

| Toggle Wars entry | Start here | What to look for |
| --- | --- | --- |
| Track 3 · Build on Open Source Flagsmith | `make demo` | New shoppers see standard checkout in both runs. The same open order fails with immediate retirement and completes when the handler drains. |
| Track 4 · Flagsmith Agent Skills | `make skill-demo` | The official CLI changes a flag in a disposable clone. A queued job exercises the old and new readers, and the agent gets a JSON result including cleanup. [Read the skill](skills/rehearse-flag-rollback/SKILL.md) |

## Run the lab

Use Linux or macOS with Node.js 24, Python 3.10+, Docker with Compose v2, Make and OpenSSL. From the repository root:

```sh
make demo
```

This starts Flagsmith 2.292.0 and PostgreSQL on a local Docker network, creates six flags and exercises each workflow. Only the Flagsmith port is published, on loopback. The command verifies both the fresh visitor's assignment and the in-flight request, checks the final flag and handler state, and writes the results to `live-demo/.runtime/evidence.json`.

| In-flight request | Retire handler immediately | Let open work finish |
| --- | --- | --- |
| Pay for an open order | 410 | 201 |
| Finish a resumable upload | 409 | 200 |
| Confirm a booking hold | 409 | 201 |
| Download a queued report | 404 | 200 |
| Submit an onboarding draft | 422 | 200 |
| Accept a subscription quote | 412 | 202 |

These are HTTP outcomes from the synthetic application fixtures. Flagsmith supplies the real feature assignments. The planner replays the same captured session for both policies.

### Try the checkout yourself

Run `make web`, open [the local presenter](http://127.0.0.1:4197/presenter), and choose **Open live shop**. There is no login. All payments are synthetic.

1. Switch on `checkout_v2` and start an express order in the shop. Leave it open.
2. In the presenter, choose **Retire express checkout immediately** and switch the flag off. Return to the open order and press **Pay**.
3. Start another express order and repeat with **Let open orders finish**. The open order now gets a receipt while new shoppers use standard checkout.

The Node server writes to the Flagsmith Management API and reads the SDK endpoint to verify the assignment before updating the shop. An order keeps the assignment it received when checkout opened. The React dashboard also lets you replay each scenario and inspect or download the evidence. [Local API walkthrough](live-demo/public/demo.md)

## Run the agent skill

Install the official Flagsmith CLI once, then run the bundled queue example against the same local stack:

```sh
npm install --global @flagsmith/cli@2.0.0
make skill-demo
```

The example captures a versioned job, changes the Boolean flag in a cloned environment, and replays the job under two reader-retirement policies. Fresh jobs should succeed under both. Only the drain policy should deliver the original job exactly once, including a retry. The helper reports the observed violation as `verdict: "fail"`. The Make target succeeds only when it reproduces that exact comparison **and** verifies clone removal.

To use the skill with your own application, give the agent an isolated fixture, the two policies and the outcomes you need to preserve. The helper checks the management and SDK assignments before replay. Missing observations or unverified cleanup produce an inconclusive result. Applying a change to a shared environment requires a separate operator decision. [Probe contract and CLI invocation](skills/rehearse-flag-rollback/references/probe.md)

**Measured agent run.** On November 27, 2026, Codex CLI ran the queue rehearsal with `gpt-6.2-sol`. Both fresh-job checks passed. Only the drain policy passed the in-flight check, and cleanup was verified. The agent reported 108,625 input tokens across calls, including 80,640 cached, and 208 output tokens. Those counts include the agent harness and are from a separate run from the checkout video.

The bundled skill and its tests match commit `beadb786` proposed to the official CLI repository. [Upstream Flagsmith pull request #120](https://github.com/Flagsmith/flagsmith-cli/pull/120)

## Test and clean up

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
make test
```

`make test` runs the Python targeting, agent skill and Node fixture tests. See [AGENTS.md](AGENTS.md) for the frontend build, browser tests and source layout. The separate [Python targeting CLI](docs/python-cli.md) checks which saved personas receive a flag after a targeting change using the Flagsmith Python SDK. That tool predates the event. The rollback lab, paired shop and agent skill are this submission's contributions.

Stop the local containers after the demo:

```sh
docker compose --project-name "${COMPOSE_PROJECT_NAME:-flagsmith-rollback-lab}" --project-directory live-demo down
```

The [live-demo README](live-demo/README.md) credits the UI components and event artwork.
