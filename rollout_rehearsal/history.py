from datetime import datetime, timezone
from heapq import nlargest
import json
import os
from pathlib import Path
import re
from stat import S_ISREG
from typing import Any
from uuid import uuid4

from .files import decode_json, save_report
from .rehearsal import REASON_CODES, RehearsalError, validate_fingerprint


RECEIPT_VERSION = 1
RECEIPT_PATTERN = re.compile(r"run-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{32}\.json")
STAMP_FORMAT = "%Y%m%dT%H%M%S%fZ"
MAX_RECEIPT_BYTES = 16 * 1024
MAX_DASHBOARD_RUNS = 1000
BASE_FIELDS = {"version", "status", "evaluation", "duration_ms"}
RESULT_FIELDS = {"baseline_sha256", "summary", "transitions"}


def record_run(
    directory: Path,
    evaluation: str,
    duration_ms: int,
    report: dict[str, Any] | None,
    transitions: dict[tuple[str, str], int],
) -> None:
    receipt = {
        "version": RECEIPT_VERSION,
        "status": "blocked",
        "evaluation": evaluation,
        "duration_ms": duration_ms,
    }
    if report is not None:
        summary = report["summary"]
        receipt.update(
            status="failed" if summary["failed"] else "passed",
            baseline_sha256=report["baseline_sha256"],
            summary=summary,
            transitions=[
                {"before": before, "after": after, "count": count}
                for (before, after), count in sorted(transitions.items())
            ],
        )
    timestamp = datetime.now(timezone.utc).strftime(STAMP_FORMAT)
    path = directory / f"run-{timestamp}-{uuid4().hex}.json"
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        save_report(path, json.dumps(receipt, separators=(",", ":")) + "\n")
    except OSError as error:
        raise RehearsalError(f"Could not write rehearsal receipt: {error}") from error


def guard_receipt_output(directory: Path, output: Path) -> None:
    if not re.fullmatch(RECEIPT_PATTERN.pattern, output.name, flags=re.IGNORECASE):
        return
    try:
        same_directory = output.parent.samefile(directory)
    except FileNotFoundError:
        return
    if same_directory:
        raise RehearsalError("An HTML report cannot overwrite a rehearsal receipt")


def _is_count(value: Any) -> bool:
    return type(value) is int and 0 <= value < 2**63


def _validate_receipt(receipt: Any) -> None:
    if not isinstance(receipt, dict):
        raise ValueError("expected a receipt object")
    version = receipt.get("version")
    if type(version) is not int or version != RECEIPT_VERSION:
        raise ValueError("unsupported receipt version")
    if receipt.get("evaluation") not in ("both", "bulk", "single") or not _is_count(receipt.get("duration_ms")):
        raise ValueError("invalid evaluation mode or duration")

    status = receipt.get("status")
    if status == "blocked" and receipt.keys() == BASE_FIELDS:
        return
    if status not in ("passed", "failed") or receipt.keys() != BASE_FIELDS | RESULT_FIELDS:
        raise ValueError("invalid receipt fields or status")
    validate_fingerprint(receipt["baseline_sha256"], "Recorded baseline")

    summary = receipt["summary"]
    if (
        not isinstance(summary, dict)
        or summary.keys() != {"passed", "failed", "changed"}
        or not all(_is_count(value) for value in summary.values())
    ):
        raise ValueError("invalid expectation totals")
    total = summary["passed"] + summary["failed"]
    if not total or summary["changed"] > total or (summary["failed"] > 0) != (status == "failed"):
        raise ValueError("inconsistent expectation totals")

    transitions = receipt["transitions"]
    if not isinstance(transitions, list):
        raise ValueError("invalid evaluation reasons")
    seen = set()
    counted = 0
    for item in transitions:
        if (
            not isinstance(item, dict)
            or item.keys() != {"before", "after", "count"}
            or not all(isinstance(item[key], str) and item[key] in REASON_CODES for key in ("before", "after"))
            or not _is_count(item["count"])
            or item["count"] == 0
        ):
            raise ValueError("invalid evaluation reason transition")
        pair = item["before"], item["after"]
        if pair in seen:
            raise ValueError("repeated evaluation reason transition")
        seen.add(pair)
        counted += item["count"]
    if counted != summary["changed"]:
        raise ValueError("evaluation reasons do not match the number of changed outcomes")


def _open_receipt(path: str, flags: int) -> int:
    return os.open(path, flags | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))


def read_history(directory: Path, limit: int) -> list[dict[str, Any]]:
    with os.scandir(directory) as entries:
        newest = nlargest(limit, (entry.name for entry in entries if RECEIPT_PATTERN.fullmatch(entry.name)))

    history = []
    for name in newest:
        path = directory / name
        try:
            if path.is_symlink():
                raise ValueError("expected a regular file")
            with open(path, "rb", opener=_open_receipt) as source:
                if not S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise ValueError("expected a regular file")
                contents = source.read(MAX_RECEIPT_BYTES + 1)
            if len(contents) > MAX_RECEIPT_BYTES:
                raise ValueError("receipt exceeds 16 KiB")
            receipt = decode_json(contents, "invalid JSON")
            _validate_receipt(receipt)
            _, timestamp, _ = name.split("-", 2)
            receipt["finished_at"] = datetime.strptime(timestamp, STAMP_FORMAT).replace(tzinfo=timezone.utc)
        except (OSError, ValueError, RecursionError) as error:
            raise RehearsalError(f"Invalid rehearsal receipt {name}: {error}") from error
        history.append(receipt)
    return history
