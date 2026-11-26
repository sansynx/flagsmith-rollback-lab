from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import tempfile
import unittest

from test_rehearsal import PLAN, SNAPSHOT, run_cli


def dashboard_runs(path):
    data = re.search(r'<script id="rehearsal-data" type="application/json">([^<]*)</script>', path.read_text())
    if data is None:
        raise AssertionError("dashboard is missing its embedded run data")
    return json.loads(data[1])


class HistoryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.receipts = self.root / "runs"
        self.output = self.root / "history.html"

    def rehearse(self, *options, plan=PLAN):
        return run_cli(plan, "--snapshot", SNAPSHOT, "--save-receipts", self.receipts, *options)

    def dashboard(self, *options):
        return run_cli(
            "dashboard", "--receipt-dir", self.receipts, "--output", self.output, *options
        )

    def only_receipt(self):
        receipt, = self.receipts.glob("run-*.json")
        return receipt

    def test_failed_summary_run_saves_redacted_reason_counts(self):
        result = self.rehearse("--summary", "--json")
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertNotIn("checks", report)
        receipt_text = self.only_receipt().read_text()
        receipt = json.loads(receipt_text)
        self.assertEqual(
            receipt,
            {
                "version": 1,
                "status": "failed",
                "evaluation": "both",
                "duration_ms": receipt["duration_ms"],
                "baseline_sha256": report["baseline_sha256"],
                "summary": {"passed": 2, "failed": 2, "changed": 2},
                "transitions": [{"before": "DEFAULT", "after": "TARGETING_MATCH", "count": 2}],
            },
        )
        self.assertGreaterEqual(receipt["duration_ms"], 0)
        for private_text in ("new_checkout", "Paid US customers", "test-free-us", "redesigned", "Local demo"):
            self.assertNotIn(private_text, receipt_text)

    def test_blocked_run_records_error_without_a_verdict_or_exception_text(self):
        result = self.rehearse("--require-baseline", "0" * 64, "--evaluation", "single")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("Baseline fingerprint changed", result.stderr)
        receipt = json.loads(self.only_receipt().read_text())
        self.assertEqual(
            receipt,
            {"version": 1, "status": "blocked", "evaluation": "single", "duration_ms": receipt["duration_ms"]},
        )

    def test_resolution_reason_alone_does_not_count_as_changed_flag_behavior(self):
        document = json.loads(SNAPSHOT.read_bytes())
        segment_flag = document["project"]["segments"][0]["feature_states"][0]
        segment_flag.update(enabled=False, feature_state_value=None)
        snapshot = self.root / "snapshot.json"
        snapshot.write_text(json.dumps(document))
        plan = json.loads(PLAN.read_bytes())
        plan["cases"][0]["expect"]["new_checkout"] = {"enabled": False}
        plan_path = self.root / "plan.json"
        plan_path.write_text(json.dumps(plan))

        result = run_cli(plan_path, "--snapshot", snapshot, "--save-receipts", self.receipts, "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        free_case = json.loads(result.stdout)["checks"][1]
        self.assertEqual(free_case["before"]["reason"], "DEFAULT")
        self.assertTrue(free_case["after"]["reason"].startswith("TARGETING_MATCH"))
        receipt = json.loads(self.only_receipt().read_text())
        self.assertEqual(receipt["summary"]["changed"], 0)
        self.assertEqual(receipt["transitions"], [])

    def test_concurrent_runs_each_leave_a_complete_receipt(self):
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _: self.rehearse("--summary"), range(8)))
        self.assertEqual([result.returncode for result in results], [1] * 8)
        self.assertEqual(len(list(self.receipts.iterdir())), 8)
        self.assertTrue(all(json.loads(path.read_text())["status"] == "failed" for path in self.receipts.iterdir()))

    def test_receipt_write_failure_returns_two_even_when_expectations_pass(self):
        plan = json.loads(PLAN.read_bytes())
        plan["edits"] = []
        passing_plan = self.root / "passing.json"
        passing_plan.write_text(json.dumps(plan))
        self.receipts.touch()
        result = self.rehearse("--summary", "--json", plan=passing_plan)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("Could not write rehearsal receipt", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_block_reason_is_visible_when_receipt_also_fails(self):
        self.receipts.touch()
        result = self.rehearse("--require-baseline", "0" * 64)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("Baseline fingerprint changed", result.stderr)
        self.assertIn("Could not write rehearsal receipt", result.stderr)

    def test_dashboard_remains_a_valid_relative_plan_path(self):
        plan = self.root / "dashboard"
        plan.write_bytes(PLAN.read_bytes())
        result = run_cli(plan.name, "--sn", SNAPSHOT, "--re", "0" * 64, cwd=self.root)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("Baseline fingerprint changed", result.stderr)

    def test_dashboard_totals_distinguish_blocked_runs_from_failed_expectations(self):
        passing_plan = self.root / "passing.json"
        plan = json.loads(PLAN.read_bytes())
        plan["edits"] = []
        passing_plan.write_text(json.dumps(plan))
        calls = (
            self.rehearse("--summary"),
            self.rehearse("--require-baseline", "0" * 64),
            self.rehearse(plan=passing_plan),
        )
        self.assertEqual([result.returncode for result in calls], [1, 2, 0])
        result = self.dashboard()
        self.assertEqual(result.returncode, 0, result.stderr)
        runs = dashboard_runs(self.output)
        self.assertEqual([run["status"] for run in runs], ["passed", "blocked", "failed"])
        self.assertNotIn("summary", runs[1])
        self.assertEqual(runs[2]["summary"], {"passed": "2", "failed": "2", "changed": "2"})
        self.assertEqual(runs[2]["transitions"], [{"before": "DEFAULT", "after": "TARGETING_MATCH", "count": "2"}])

        limited = self.dashboard("--limit", 1)
        self.assertEqual(limited.returncode, 0, limited.stderr)
        self.assertEqual(dashboard_runs(self.output), runs[:1])

    def test_dashboard_empty_state_does_not_report_a_verdict(self):
        self.receipts.mkdir()
        result = self.dashboard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(dashboard_runs(self.output), [])

    def test_dashboard_keeps_large_counts_exact_for_the_browser(self):
        failed = self.rehearse("--summary")
        self.assertEqual(failed.returncode, 1, failed.stderr)
        path = self.only_receipt()
        receipt = json.loads(path.read_text())
        receipt["summary"]["passed"] = 2**63 - 1
        path.write_text(json.dumps(receipt))
        result = self.dashboard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(dashboard_runs(self.output)[0]["summary"]["passed"], "9223372036854775807")

    def test_corrupt_receipt_leaves_previous_dashboard_intact(self):
        failed = self.rehearse("--summary")
        self.assertEqual(failed.returncode, 1, failed.stderr)
        self.output.write_text("Previous dashboard")
        receipt = self.only_receipt()
        payload = json.loads(receipt.read_text())
        payload["summary"]["failed"] = 0
        receipt.write_text(json.dumps(payload))
        result = self.dashboard()
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn(receipt.name, result.stderr)
        self.assertEqual(self.output.read_text(), "Previous dashboard")

    def test_dashboard_does_not_overwrite_a_receipt(self):
        failed = self.rehearse()
        self.assertEqual(failed.returncode, 1, failed.stderr)
        receipt = self.only_receipt()
        previous = receipt.read_bytes()
        for name in (receipt.name, receipt.name.upper()):
            with self.subTest(output=name):
                self.output = receipt.with_name(name)
                result = self.dashboard()
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("cannot overwrite a rehearsal receipt", result.stderr)
                self.assertEqual(receipt.read_bytes(), previous)

    @unittest.skipUnless(os.name == "posix", "requires symlink creation")
    def test_detailed_report_cannot_replace_a_receipt_shaped_symlink(self):
        failed = self.rehearse()
        self.assertEqual(failed.returncode, 1, failed.stderr)
        receipt = self.only_receipt()
        receipt.unlink()
        receipt.symlink_to(self.output)
        result = self.rehearse("--html", receipt)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("cannot overwrite a rehearsal receipt", result.stderr)
        self.assertTrue(receipt.is_symlink())

    def test_dashboard_does_not_read_an_oversized_receipt(self):
        failed = self.rehearse()
        self.assertEqual(failed.returncode, 1, failed.stderr)
        receipt = self.only_receipt()
        with receipt.open("ab") as target:
            target.write(b" " * (16 * 1024))
        result = self.dashboard()
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("receipt exceeds", result.stderr)

    @unittest.skipUnless(os.name == "posix", "requires symlink creation")
    def test_symlink_loop_in_receipt_directory_exits_two(self):
        self.receipts.symlink_to(self.receipts)
        receipt_name = "run-20260101T000000000000Z-" + "0" * 32 + ".json"
        for name in ("history.html", receipt_name):
            with self.subTest(output=name):
                self.output = self.root / name
                result = self.dashboard()
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("Rehearsal error", result.stderr)
                self.assertNotIn("Traceback", result.stderr)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "requires named pipes")
    def test_dashboard_rejects_a_named_pipe_without_waiting_for_a_writer(self):
        failed = self.rehearse()
        self.assertEqual(failed.returncode, 1, failed.stderr)
        receipt = self.only_receipt()
        receipt.unlink()
        os.mkfifo(receipt)
        result = self.dashboard()
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("expected a regular file", result.stderr)
