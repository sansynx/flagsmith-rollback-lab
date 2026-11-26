# Flagsmith rollout rehearsal

Check who would see a feature after a proposed Flagsmith targeting change. The CLI runs saved personas against the current and proposed rules using the actual Python SDK evaluator, then fails if an observed result differs from the plan.

## Run the checkout demo

Requires Python 3.10 or later.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
flagsmith-rehearsal examples/checkout.json \
  --snapshot examples/environment.json \
  --html checkout-report.html
```

The checkout should be on only for paid US customers. The proposed edit changes the segment from matching **all** conditions to matching **any** condition. The report shows two unexpected exposures and the command exits with status 1. Open `checkout-report.html` in a browser or add `--json` for structured output. To run a passing check against the current targeting, copy the plan and set `"edits": []`.

## Use your self-hosted instance

1. Start [Flagsmith with Docker Compose](https://docs.flagsmith.com/deployment/docker). To reproduce the checkout example, create a flag named `new_checkout` with its default disabled and its value unset. In the segment `Paid US customers`, add an `ALL` subgroup under the root group and give it two conditions, `plan = paid` and `country = US`. Add a segment override that enables the flag with value `redesigned`.
2. Create a **server-side environment SDK key** for the environment. Make it available as `FLAGSMITH_SERVER_KEY` in your shell or CI secret store.
3. Inspect your environment and copy the segment's `segment_sha256` and the intended rule path into your plan. The example plan's fingerprint is specific to its offline snapshot.
4. Run the plan against the instance URL.

```sh
flagsmith-rehearsal inspect --url http://localhost:8000
flagsmith-rehearsal checkout-plan.json --url http://localhost:8000 --html checkout-report.html
```

Each command makes one GET request to `/api/v1/environment-document/`. Use HTTPS for a network host or HTTP on loopback. Both commands also accept a complete SDK environment document through `--snapshot`. The default input cap is 64 MiB per file or response. Set `--max-input-mib` to change it. Keep live snapshots and detailed reports in restricted storage because they can contain internal targeting rules, feature values, or identity data. The example data is synthetic.

## Write a plan

- **Edits** identify an existing segment by its exact name, `segment_sha256` from `inspect`, and a zero-based `rule_path`. For example, `[0, 0]` selects the first subgroup under the first root group. Set `from` to its current type and `to` to the proposed type. Supported group types are `ALL`, `ANY`, and `NONE`. The fingerprint binds the edit to the environment, segment ID, and full rule tree, so an edit with a stale path fails even if the rule now at that path has the same type.
- **Cases** give each persona a name, a stable identifier, a dictionary of scalar traits, and the expected results keyed by flag name. Each expectation can check `enabled`, `value`, or both. Use `null` to check for an empty flag value.
- **Reports** record the baseline fingerprint, evaluation mode, and outcomes. An assertion fails when the proposed outcome differs from its expectation, including when a flag was already wrong. The tool also rejects a plan if it omits a flag directly overridden by an edited segment or a flag whose outcome changes for a persona without an expectation.

## Evaluation modes

The default `--evaluation both` checks that the pinned Python SDK's bulk local evaluation (`all_flags()` on a fresh result) and single-flag local evaluation (`get_flag()`) agree for the asserted flags and flags directly overridden by edited segments. Bulk evaluation also checks for changes to dependent flags. If the two SDK paths disagree, use `--evaluation bulk` or `--evaluation single` only when that matches the application. Single-flag mode evaluates the asserted flags and the flags directly overridden by edited segments.

Each run covers the snapshot and persona traits supplied to it. Remote evaluation can also use stored or system traits, and other SDKs may evaluate differently. To use a result as a release check for those applications, verify the same personas against the application in staging.

## Run in CI

Run the CLI as a CI step using a reviewed plan. It exits **0** when every expectation passes, **1** on a failed expectation, and **2** when it cannot produce a reliable verdict. Use `--json` for structured output, `--html` for a browser report, or `--summary --json` to compute totals without retaining per-persona results in the report. Summary mode still loads the input plan into memory.

For a release that needs to match a reviewed snapshot, record its `baseline_sha256` from `inspect` or the report and pass it back in the final check. The CLI verifies that fingerprint at read time and has no publishing permissions. Keep the preflight and publish steps tied to the same revision in the release system.

```sh
flagsmith-rehearsal checkout-plan.json --url "$FLAGSMITH_URL" \
  --require-baseline "$REVIEWED_BASELINE_SHA256" --summary --json
```

## Track rehearsal history

One report tells you what happened on one run. The history dashboard shows how many rehearsals passed, failed expectations, or were blocked, and which evaluation reasons recur when a proposed edit changes a flag outcome. In the checkout example, two test personas move from the default result to a targeting match. Both changes violate the plan.

```sh
flagsmith-rehearsal examples/checkout.json --snapshot examples/environment.json \
  --summary --save-receipts behind.local/checkout-runs
# The example exits 1 because two expectations fail. Then build the dashboard:
flagsmith-rehearsal dashboard --receipt-dir behind.local/checkout-runs \
  --output behind.local/checkout-history.html
```

Open the HTML file in a browser. Select a bar or diamond in **Checks by run** to inspect one of the eight most recent rehearsals. Filter the full history by verdict and open a run to see its SDK mode, baseline fingerprint, and reason changes. The dashboard includes the newest 100 runs by default. Set `--limit` to a value between 1 and 1,000. Counts combine the recorded test expectations, so repeating a plan counts each run again. They describe saved personas and do not estimate production exposure. When running in both SDK modes, reason counts use the bulk result after the verdict has passed the outcome agreement checks.

Receipt collection is opt-in and works with `--summary`. Each run writes a separate JSON file with its verdict, evaluation mode, duration, and, for completed runs, the snapshot fingerprint, aggregate counts, and reason codes. Receipts omit flag and segment names, identities, traits, flag values, and raw error messages. For a blocked run, keep the CLI log to diagnose what happened. If the requested receipt cannot be saved, the CLI exits 2.

Use a dedicated directory per environment or pipeline and restrict write access to the jobs recording runs. In CI, retain the receipt files even when the rehearsal step exits nonzero. Keep their filenames when collecting artifacts, since the filenames carry the end time used to sort runs. The dashboard reads local files and includes no external scripts or assets.

The dashboard is built with React and shadcn/ui. Use Node.js 22.12 or later to change the interface. Run `npm ci --prefix dashboard-ui` and `npm run build --prefix dashboard-ui` to regenerate the bundled assets in `rollout_rehearsal/dashboard_assets`. The installed Python CLI embeds these assets into the report. You can open the report offline without a Node.js installation.

For browser regression tests, install Chromium with `npx --prefix dashboard-ui playwright install chromium` and run `npm run test:browser --prefix dashboard-ui` with the package installed in your active Python environment.

## Tests

```sh
python -m unittest discover -s tests -v
```

## Verify a reference release

Run the same review and release sequence against a disposable Flagsmith 2.292.0 instance using Docker Compose.

```sh
python tests/reference/run.py
```

The verifier checks both live Python SDK modes before and after a targeting change. It rejects a release with unmet assertions, a different proposal on the same baseline, and a stale baseline after a separate configuration edit. It rehearses the exact approved plan again inside the reference publisher's transaction before applying it. The test owns all writers in its sandbox and removes its containers and database when it finishes.

It also verifies that the live rehearsal verdicts and evaluation reasons carry through to the local history dashboard.

The publisher is a test fixture for that isolated setup. A real release workflow needs a revision guard shared by its configuration writers and a staging check using the application's SDK and evaluation mode.
