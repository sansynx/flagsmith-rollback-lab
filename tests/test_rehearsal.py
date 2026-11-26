import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "examples" / "checkout.json"
SNAPSHOT = ROOT / "examples" / "environment.json"


def run_cli(*args, key=None, proxy=None, cwd=ROOT):
    env = os.environ.copy()
    env.pop("FLAGSMITH_SERVER_KEY", None)
    if key is not None:
        env["FLAGSMITH_SERVER_KEY"] = key
    if proxy is not None:
        env.update(HTTP_PROXY=proxy, http_proxy=proxy, NO_PROXY="", no_proxy="")
    return subprocess.run(
        [sys.executable, "-m", "rollout_rehearsal", *map(str, args)],
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        timeout=15,
    )


@contextmanager
def snapshot_server(status=200, redirect=None, payload=None, completed_downloads=None):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.command, self.path, self.headers.get("X-Environment-Key")))
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            if redirect:
                self.send_header("Location", redirect)
            self.end_headers()
            if status == 200 or payload is not None:
                try:
                    self.wfile.write(SNAPSHOT.read_bytes() if payload is None else payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                else:
                    if completed_downloads is not None:
                        completed_downloads.append(self.path)

        def log_message(self, *_args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", requests
        finally:
            server.shutdown()
            thread.join()


class RehearsalTests(unittest.TestCase):
    def run_plan(self, change, *options, snapshot_change=None):
        plan = json.loads(PLAN.read_bytes())
        change(plan)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            path.write_text(json.dumps(plan), encoding="utf-8")
            snapshot_path = SNAPSHOT
            if snapshot_change is not None:
                snapshot = json.loads(SNAPSHOT.read_bytes())
                snapshot_change(snapshot)
                snapshot_path = Path(directory) / "snapshot.json"
                snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")
            return run_cli(path, "--snapshot", snapshot_path, *options)

    def test_changed_segment_fails_for_two_unexpected_personas(self):
        result = run_cli(PLAN, "--snapshot", SNAPSHOT, "--json")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stderr, "")
        report = json.loads(result.stdout)
        self.assertEqual(report["environment"], "Local demo")
        rows = report["checks"]
        self.assertEqual(
            [(row["case"], row["before"]["enabled"], row["after"]["enabled"], row["passed"])
             for row in rows],
            [
                ("Paid US customer", True, True, True),
                ("Free US customer", False, True, False),
                ("Paid Canadian customer", False, True, False),
                ("Free Canadian customer", False, False, True),
            ],
        )
        self.assertIn("Paid US customers", rows[1]["after"]["reason"])
        self.assertNotIn("demo-environment", result.stdout)

    def test_baseline_recheck_passes_without_edits(self):
        result = self.run_plan(lambda plan: plan["edits"].clear())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("4 passed", result.stdout)
        self.assertIn("0 changed", result.stdout)

    def test_unchanged_but_wrong_remote_config_still_fails(self):
        def change(plan):
            plan["edits"].clear()
            plan["cases"][0]["expect"]["new_checkout"]["value"] = "different"

        result = self.run_plan(change, "--json")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stderr, "")
        row = json.loads(result.stdout)["checks"][0]
        self.assertFalse(row["passed"])
        self.assertFalse(row["changed"])

    def test_stale_rule_precondition_is_an_input_error(self):
        def change(plan):
            plan["edits"][0].update({"from": "NONE", "to": "ALL"})

        result = self.run_plan(change)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("is ALL, expected NONE", result.stderr)

    def test_reordered_same_type_rule_cannot_produce_false_green(self):
        def change_snapshot(snapshot):
            rules = snapshot["project"]["segments"][0]["rules"][0]["rules"]
            rules.insert(0, {"type": "ALL", "conditions": [
                {"property_": "irrelevant_trait", "operator": "IS_NOT_SET", "value": None}
            ]})

        result = self.run_plan(lambda plan: None, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("segment fingerprint", result.stderr)

    def test_recreated_segment_with_same_name_and_rules_is_rejected(self):
        def change_snapshot(snapshot):
            snapshot["project"]["segments"][0]["id"] = 999

        result = self.run_plan(lambda plan: None, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("segment fingerprint", result.stderr)

    def test_identical_segment_from_another_environment_is_rejected(self):
        def change_snapshot(snapshot):
            snapshot["api_key"] = "different-environment"

        result = self.run_plan(lambda plan: None, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("segment fingerprint", result.stderr)

    def test_uncovered_edited_flag_is_an_input_error(self):
        def change_plan(plan):
            for case in plan["cases"]:
                case["expect"] = {"unrelated": {"enabled": False}}

        def change_snapshot(snapshot):
            snapshot["feature_states"].append(dict(
                snapshot["feature_states"][0], django_id=35,
                feature={"id": 9, "name": "unrelated", "type": "STANDARD"},
            ))

        result = self.run_plan(change_plan, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("new_checkout", result.stderr)

    def test_flags_affected_indirectly_need_an_expectation(self):
        def change_snapshot(snapshot):
            flag = {"id": 9, "name": "receipt", "type": "STANDARD"}
            snapshot["feature_states"].append(dict(snapshot["feature_states"][0], django_id=35, feature=flag))
            snapshot["project"]["segments"].append({
                "id": 5, "name": "New checkout receipt", "rules": [{
                    "type": "ALL", "conditions": [{
                        "property_": "$.flags.new_checkout.enabled", "operator": "EQUAL", "value": "true",
                    }],
                }],
                "feature_states": [dict(
                    snapshot["feature_states"][0], django_id=36, feature=flag, enabled=True,
                    feature_segment={"priority": 0},
                )],
            })

        result = self.run_plan(lambda plan: None, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("receipt", result.stderr)
        self.assertIn("without an expectation", result.stderr)

    def test_reports_sdk_disagreement_and_supports_selecting_a_runtime(self):
        def change_plan(plan):
            plan["edits"] = []
            plan["cases"] = plan["cases"][:1]

        def change_snapshot(snapshot):
            snapshot["feature_states"].append(dict(
                snapshot["feature_states"][0], django_id=35, enabled=True,
                feature={"id": 9, "name": "base_flag", "type": "STANDARD"},
            ))
            rule = snapshot["project"]["segments"][0]["rules"][0]["rules"][0]
            rule["conditions"] = [{
                "property_": "$.flags.base_flag.enabled", "operator": "EQUAL", "value": "true",
            }]

        default = self.run_plan(change_plan, snapshot_change=change_snapshot)
        self.assertEqual(default.returncode, 2, default.stderr)
        self.assertIn("disagree", default.stderr)
        for mode, exit_code in (("bulk", 0), ("single", 1)):
            with self.subTest(mode=mode):
                result = self.run_plan(change_plan, "--evaluation", mode, snapshot_change=change_snapshot)
                self.assertEqual(result.returncode, exit_code, result.stderr)

    def test_inspect_reports_rule_paths_without_exposing_condition_values(self):
        result = run_cli("inspect", "--snapshot", SNAPSHOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        inspection = json.loads(result.stdout)
        self.assertRegex(inspection["baseline_sha256"], r"^[a-f0-9]{64}$")
        segment = inspection["segments"][0]
        self.assertEqual(segment["name"], "Paid US customers")
        self.assertRegex(segment["segment_sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(segment["rules"], [{"path": [0], "type": "ALL"}, {"path": [0, 0], "type": "ALL"}])
        self.assertNotIn("demo-environment", result.stdout)
        self.assertNotIn('"country"', result.stdout)

    def test_required_baseline_rejects_an_unrelated_config_change(self):
        def change_snapshot(snapshot):
            snapshot["feature_states"][0]["enabled"] = True

        inspection = run_cli("inspect", "--snapshot", SNAPSHOT)
        self.assertEqual(inspection.returncode, 0, inspection.stderr)
        digest = json.loads(inspection.stdout)["baseline_sha256"]
        result = self.run_plan(lambda plan: None, "--require-baseline", digest, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("Baseline fingerprint", result.stderr)

    def test_summary_counts_all_outcomes_without_persona_data(self):
        result = run_cli(PLAN, "--snapshot", SNAPSHOT, "--summary", "--json")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stderr, "")
        report = json.loads(result.stdout)
        self.assertEqual(report["summary"], {"passed": 2, "failed": 2, "changed": 2})
        self.assertNotIn("checks", report)
        self.assertNotIn("Free US customer", result.stdout)

    def test_nonexistent_flag_is_an_input_error(self):
        def change(plan):
            plan["cases"][0]["expect"] = {"typo": {"enabled": False}}

        result = self.run_plan(change)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("typo", result.stderr)

    def test_failing_run_writes_a_browser_report(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.html"
            result = self.run_plan(
                lambda plan: plan["cases"][1].update(name="<script>untrusted</script>"),
                "--html", path,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(result.stderr, "")
            report = path.read_text(encoding="utf-8")
            self.assertIn("&lt;script&gt;untrusted&lt;/script&gt;", report)
            self.assertNotIn("<script>untrusted</script>", report)
            self.assertIn("Paid Canadian customer", report)


    def test_rejects_admin_api_condition_fields_in_sdk_snapshot(self):
        def change_plan(plan):
            for case in plan["cases"]:
                case["expect"]["new_checkout"] = {"enabled": False}

        def change_snapshot(snapshot):
            rule = snapshot["project"]["segments"][0]["rules"][0]["rules"][0]
            for condition in rule["conditions"]:
                condition["property"] = condition.pop("property_")

        result = self.run_plan(change_plan, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("property_", result.stderr)

    def test_report_replacement_preserves_hardlinked_input(self):
        with tempfile.TemporaryDirectory() as directory:
            plan_path = Path(directory) / "plan.json"
            plan_path.write_bytes(PLAN.read_bytes())
            report_path = Path(directory) / "report.html"
            report_path.hardlink_to(plan_path)

            result = run_cli(plan_path, "--snapshot", SNAPSHOT, "--html", report_path)

            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(plan_path.read_bytes(), PLAN.read_bytes())
            self.assertIn("<html", report_path.read_text(encoding="utf-8"))

    def test_named_sdk_identity_override_cannot_be_edited_as_a_segment(self):
        def change_plan(plan):
            plan["edits"] = [
                {"segment": "identity_overrides", "rule_path": [0], "segment_sha256": "0" * 64,
                 "from": "ALL", "to": "NONE"}
            ]

        def change_snapshot(snapshot):
            snapshot["identity_overrides"] = [{
                "identifier": "test-free-us",
                "identity_features": [snapshot["feature_states"][0]],
            }]

        result = self.run_plan(change_plan, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("found 0", result.stderr)

    def test_cycle_is_an_evaluation_error_even_if_fallback_matches(self):
        def change_plan(plan):
            plan["edits"] = []
            for case in plan["cases"]:
                case["expect"]["new_checkout"] = {"enabled": False}

        def change_snapshot(snapshot):
            rule = snapshot["project"]["segments"][0]["rules"][0]["rules"][0]
            rule["conditions"] = [{
                "property_": "$.flags.new_checkout.enabled",
                "operator": "EQUAL",
                "value": "false",
            }]

        result = self.run_plan(change_plan, snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("CIRCULAR_DEPENDENCY", result.stderr)

    def test_invalid_regex_in_snapshot_cannot_return_a_test_verdict(self):
        def change_snapshot(snapshot):
            rule = snapshot["project"]["segments"][0]["rules"][0]["rules"][0]
            rule["conditions"][0].update(operator="REGEX", value="[")

        result = self.run_plan(lambda plan: plan["edits"].clear(), snapshot_change=change_snapshot)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("baseline", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


class LiveSnapshotTests(unittest.TestCase):
    def test_reads_one_environment_document_with_a_server_key(self):
        with snapshot_server() as (url, requests):
            result = run_cli(PLAN, "--url", url, "--json", key="ser.test-key")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(len(json.loads(result.stdout)["checks"]), 4)
        self.assertEqual(
            requests, [("GET", "/api/v1/environment-document/", "ser.test-key")]
        )
        self.assertNotIn("ser.test-key", result.stdout)

    def test_refuses_redirects_without_forwarding_the_key(self):
        with snapshot_server() as (destination, received):
            with snapshot_server(302, redirect=destination) as (source, sent):
                result = run_cli(PLAN, "--url", source, key="ser.test-key")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(len(sent), 1)
        self.assertEqual(received, [])
        self.assertIn("302", result.stderr)
        self.assertNotIn("ser.test-key", result.stderr)

    def test_stops_reading_an_oversized_response(self):
        with snapshot_server(payload=SNAPSHOT.read_bytes() + b" " * (1024 * 1024)) as (url, _):
            result = run_cli(PLAN, "--url", url, "--max-input-mib", 1, key="ser.test-key")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("1 MiB", result.stderr)

    def test_refuses_redirects_before_downloading_their_body(self):
        downloads = []
        with snapshot_server(302, redirect="/other", payload=b" " * (16 * 1024 * 1024),
                             completed_downloads=downloads) as (url, requests):
            result = run_cli(PLAN, "--url", url, "--max-input-mib", 1, key="ser.test-key")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("302", result.stderr)
        self.assertEqual(len(requests), 1)
        self.assertEqual(downloads, [])

    def test_does_not_send_key_to_plain_http_on_a_network_host(self):
        with snapshot_server() as (proxy, requests):
            result = run_cli(PLAN, "--url", "http://flagsmith.invalid", key="ser.test-key", proxy=proxy)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("HTTPS", result.stderr)
        self.assertEqual(requests, [])


if __name__ == "__main__":
    unittest.main()
