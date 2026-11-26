"""Exercise a reviewed release against an isolated self-hosted Flagsmith instance."""

import argparse
import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

from flagsmith import Flagsmith
from rollout_rehearsal.rehearsal import fingerprint


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def run_reference(sudo_docker: bool) -> None:
    if not __debug__:
        raise RuntimeError("Reference verification requires Python assertions")
    namespace = "flagsmith-reference-" + secrets.token_hex(4)
    compose = ["sudo", "-n", "--preserve-env=REFERENCE_DB_PASSWORD"] if sudo_docker else []
    compose += ["docker", "compose", "-p", namespace, "-f", str(HERE / "compose.yaml")]
    environment = os.environ.copy()
    environment["REFERENCE_DB_PASSWORD"] = secrets.token_hex(20)
    fixture_source = (HERE / "fixture.py").read_text(encoding="utf-8")

    def docker(*args, **options):
        return subprocess.run([*compose, *args], env=environment, text=True, timeout=180, **options)

    def fixture(action, **fields):
        request = json.dumps({"action": action, **fields}).encode()
        encoded = base64.b64encode(request).decode()
        result = docker(
            "exec", "-T", "flagsmith", "flagsmith", "shell",
            input=f"REFERENCE_REQUEST = {encoded!r}\n{fixture_source}",
            capture_output=True,
        )
        if result.returncode:
            tail = "\n".join(result.stderr.splitlines()[-18:])
            raise RuntimeError(f"Flagsmith fixture {action!r} failed ({result.returncode})\n{tail}")
        for line in result.stdout.splitlines():
            if line.startswith("REFERENCE_RESULT="):
                return json.loads(line.removeprefix("REFERENCE_RESULT="))
        tail = "\n".join(result.stderr.splitlines()[-10:])
        raise RuntimeError(f"Flagsmith test fixture returned no result for {action!r}\n{tail}")

    try:
        started = docker("up", "-d", "--wait", "--wait-timeout", "125")
        if started.returncode:
            docker("logs", "--tail", "25", "flagsmith")
            started.check_returncode()
        address = docker("port", "flagsmith", "8000", capture_output=True, check=True).stdout.strip()
        base_url = f"http://{address}"
        seeded = fixture("seed")
        sdk_key = seeded["server_key"]
        environment_id = seeded["environment_id"]
        cli_environment = {**os.environ, "FLAGSMITH_SERVER_KEY": sdk_key}
        plan = json.loads((ROOT / "examples" / "checkout.json").read_text(encoding="utf-8"))

        def cli(*args):
            return subprocess.run(
                [sys.executable, "-m", "rollout_rehearsal", *map(str, args)],
                cwd=ROOT, env=cli_environment, capture_output=True, text=True, timeout=25,
            )

        def inspect():
            result = cli("inspect", "--url", base_url)
            assert result.returncode == 0, result.stderr
            return json.loads(result.stdout)

        def probe(expected):
            for local in (False, True):
                sdk = Flagsmith(
                    environment_key=sdk_key, api_url=f"{base_url}/api/v1/",
                    enable_local_evaluation=local, request_timeout_seconds=5,
                )
                for case, outcome in zip(plan["cases"], expected, strict=True):
                    flags = sdk.get_identity_flags(case["identifier"], case["traits"], transient=True)
                    assert (flags._context is not None) == local, ("Unexpected SDK path", local, case["name"])
                    flag = flags.get_flag("new_checkout")
                    assert (flag.enabled, flag.value) == outcome, (local, case["name"])
                    if local:
                        fresh = sdk.get_identity_flags(case["identifier"], case["traits"], transient=True)
                        assert fresh._context is not None, ("Unexpected SDK fallback", case["name"])
                        bulk_flag = next(item for item in fresh.all_flags() if item.feature_name == "new_checkout")
                        assert (bulk_flag.enabled, bulk_flag.value) == outcome, case["name"]

        before = [(True, "redesigned"), (False, None), (False, None), (False, None)]
        after = [(True, "redesigned"), (True, "redesigned"), (True, "redesigned"), (False, None)]
        probe(before)
        baseline = inspect()
        plan["edits"][0]["segment_sha256"] = next(
            entry["segment_sha256"] for entry in baseline["segments"] if entry["name"] == "Paid US customers"
        )

        with tempfile.TemporaryDirectory(prefix="checkout-reference-") as temp:
            plan_path = Path(temp) / "release.json"
            receipts = Path(temp) / "runs"

            def preflight(digest, proposal):
                plan_path.write_text(json.dumps(proposal), encoding="utf-8")
                return cli(
                    plan_path, "--url", base_url, "--require-baseline", digest, "--summary", "--json",
                    "--save-receipts", receipts,
                )

            unexpected = preflight(baseline["baseline_sha256"], plan)
            assert unexpected.returncode == 1, unexpected.stderr
            assert json.loads(unexpected.stdout)["summary"]["failed"] == 2
            refused = fixture("publish", environment_id=environment_id, plan=plan,
                              baseline_sha256=baseline["baseline_sha256"], plan_sha256=fingerprint(plan))
            assert refused == {"status": "blocked", "message": "Flag assertions failed"}, refused

            for case, (enabled, value) in zip(plan["cases"], after, strict=True):
                case["expect"]["new_checkout"] = {"enabled": enabled, "value": value}
            approved = preflight(baseline["baseline_sha256"], plan)
            assert approved.returncode == 0, approved.stderr
            approved_plan = fingerprint(plan)
            replacement = deepcopy(plan)
            replacement["edits"][0]["to"] = "NONE"
            for index, case in enumerate(replacement["cases"]):
                case["expect"]["new_checkout"] = {
                    "enabled": index == 3, "value": "redesigned" if index == 3 else None,
                }
            replacement_result = preflight(baseline["baseline_sha256"], replacement)
            assert replacement_result.returncode == 0, replacement_result.stderr
            swapped = fixture("publish", environment_id=environment_id, plan=replacement,
                              baseline_sha256=baseline["baseline_sha256"], plan_sha256=approved_plan)
            assert swapped == {"status": "blocked", "message": "Reviewed plan fingerprint changed"}, swapped

            fixture("drift", environment_id=environment_id)
            stale_run = preflight(baseline["baseline_sha256"], plan)
            assert stale_run.returncode == 2 and "Baseline fingerprint changed" in stale_run.stderr, stale_run.stderr
            stale = fixture("publish", environment_id=environment_id, plan=plan,
                            baseline_sha256=baseline["baseline_sha256"], plan_sha256=approved_plan)
            assert stale["status"] == "blocked" and "Baseline fingerprint changed" in stale["message"], stale
            probe(before)

            reviewed = inspect()["baseline_sha256"]
            assert reviewed != baseline["baseline_sha256"]
            approved = preflight(reviewed, plan)
            assert approved.returncode == 0, approved.stderr
            published = fixture("publish", environment_id=environment_id, plan=plan,
                                baseline_sha256=reviewed, plan_sha256=approved_plan)
            assert published == {
                "status": "published", "baseline_sha256": reviewed, "plan_sha256": approved_plan,
            }, published
            probe(after)
            assert inspect()["baseline_sha256"] != reviewed

            receipt_files = list(receipts.glob("run-*.json"))
            recorded = [json.loads(path.read_text(encoding="utf-8")) for path in receipt_files]
            assert sorted(run["status"] for run in recorded) == ["blocked", "failed", "passed", "passed", "passed"]
            failed = next(run for run in recorded if run["status"] == "failed")
            assert failed["baseline_sha256"] == baseline["baseline_sha256"]
            assert failed["transitions"] == [{"before": "DEFAULT", "after": "TARGETING_MATCH", "count": 2}]
            assert all(sdk_key not in path.read_text(encoding="utf-8") for path in receipt_files)
            dashboard = Path(temp) / "history.html"
            rendered = cli("dashboard", "--receipt-dir", receipts, "--output", dashboard)
            assert rendered.returncode == 0, rendered.stderr
            embedded = dashboard.read_text(encoding="utf-8").split(
                '<script id="rehearsal-data" type="application/json">', 1
            )[1].split("</script>", 1)[0]
            summaries = [run["summary"] for run in json.loads(embedded) if "summary" in run]
            assert sum(int(summary["passed"]) for summary in summaries) == 14
            assert sum(int(summary["failed"]) for summary in summaries) == 2

        print("Reference Flagsmith 2.292.0 matched the Python SDK in remote and local mode before and after publication.")
        print("The fixture rejected an unsafe plan, swapped proposal and stale baseline, then published the reviewed revision.")
        print("Run receipts and dashboard totals matched the live Flagsmith rehearsal verdicts.")
    finally:
        failed = sys.exc_info()[0] is not None
        try:
            docker("down", "-v", check=True)
        except subprocess.SubprocessError:
            if not failed:
                raise
            print(f"Cleanup also failed for the disposable Compose project {namespace}.", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sudo-docker", action="store_true", help="Run Docker using existing passwordless sudo")
    run_reference(parser.parse_args().sudo_docker)
