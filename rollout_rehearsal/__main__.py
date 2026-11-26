from argparse import ArgumentParser, ArgumentTypeError, Namespace
from ipaddress import ip_address
import json
import os
from pathlib import Path
import sys
from time import monotonic_ns
from urllib.parse import urlsplit, urlunsplit

import requests

from .dashboard import dashboard_html
from .files import decode_json, save_report
from .history import MAX_DASHBOARD_RUNS, guard_receipt_output, read_history, record_run
from .rehearsal import RehearsalError, inspect_snapshot, parse_plan, rehearse, validate_fingerprint
from .report import html_report, text_report


BYTES_PER_MIB = 1024 * 1024
COMMAND_ERRORS = (OSError, ValueError, RecursionError)


def read_json(path: Path, limit_mib: int):
    limit = limit_mib * BYTES_PER_MIB
    with path.open("rb") as source:
        contents = source.read(limit + 1)
    if len(contents) > limit:
        raise RehearsalError(f"Input file exceeds {limit_mib} MiB: {path}")
    return decode_json(contents, f"{path} does not contain valid JSON")


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def reject_unsuccessful_snapshot(response: requests.Response, **_options) -> None:
    if response.status_code != 200:
        response.close()
        raise RehearsalError(f"Flagsmith environment document request returned HTTP {response.status_code}")


def fetch_snapshot(url: str, limit_mib: int):
    server_key = os.getenv("FLAGSMITH_SERVER_KEY", "").strip()
    if not server_key.startswith("ser."):
        raise RehearsalError("Set FLAGSMITH_SERVER_KEY to a Flagsmith server-side SDK key")

    parts = urlsplit(url)
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username is not None
        or parts.query
        or parts.fragment
    ):
        raise RehearsalError("Provide the HTTP(S) URL of your Flagsmith instance without credentials, query or fragment")
    loopback = is_loopback(parts.hostname)
    if parts.scheme == "http" and not loopback:
        raise RehearsalError("Use HTTPS for Flagsmith instances outside localhost")
    path = parts.path.rstrip("/")
    if not path.endswith("/api/v1"):
        path += "/api/v1"
    endpoint = urlunsplit(parts._replace(path=f"{path}/environment-document/"))
    limit = limit_mib * BYTES_PER_MIB

    try:
        with requests.Session() as session:
            if loopback:
                session.trust_env = False
            with session.get(
                endpoint,
                headers={"X-Environment-Key": server_key, "Accept": "application/json"},
                allow_redirects=False,
                stream=True,
                timeout=(5, 20),
                # Requests can consume a redirect body while constructing Response.next.
                hooks={"response": reject_unsuccessful_snapshot},
            ) as response:
                if "next" in response.links:
                    raise RehearsalError("The snapshot is paginated. Use a complete snapshot file")
                document = bytearray()
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if len(document) + len(chunk) > limit:
                        raise RehearsalError(f"Flagsmith environment document exceeds {limit_mib} MiB")
                    document.extend(chunk)
                return decode_json(document, "Flagsmith returned an invalid environment document")
    except requests.RequestException as error:
        raise RehearsalError("Could not fetch the environment document from Flagsmith") from error


def input_limit(value: str) -> int:
    try:
        amount = int(value)
    except ValueError as error:
        raise ArgumentTypeError("provide a whole number of MiB") from error
    if not 1 <= amount <= 1024:
        raise ArgumentTypeError("provide a value between 1 and 1024 MiB")
    return amount


def add_source_arguments(parser: ArgumentParser) -> None:
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--snapshot", type=Path, help="Read a complete SDK environment document from disk")
    source.add_argument("--url", help="Fetch an SDK environment document from a self-hosted Flagsmith URL")
    parser.add_argument(
        "--max-input-mib", type=input_limit, default=64, metavar="MIB",
        help="Maximum size per input file or snapshot response (default 64 MiB)",
    )


def load_snapshot(args: Namespace):
    if args.snapshot is not None:
        return read_json(args.snapshot, args.max_input_mib)
    return fetch_snapshot(args.url, args.max_input_mib)


def run_inspect(argv: list[str]) -> None:
    parser = ArgumentParser(
        prog="flagsmith-rehearsal inspect",
        description="List rule paths and fingerprints for a Flagsmith environment.",
    )
    add_source_arguments(parser)
    args = parser.parse_args(argv)
    print(json.dumps(inspect_snapshot(load_snapshot(args)), indent=2))


def dashboard_limit(value: str) -> int:
    try:
        limit = int(value)
    except ValueError as error:
        raise ArgumentTypeError("provide a whole number of runs") from error
    if not 1 <= limit <= MAX_DASHBOARD_RUNS:
        raise ArgumentTypeError(f"provide a run limit between 1 and {MAX_DASHBOARD_RUNS}")
    return limit


def run_dashboard(argv: list[str]) -> None:
    parser = ArgumentParser(
        prog="flagsmith-rehearsal dashboard",
        description="Build an offline dashboard from rehearsal receipts.",
    )
    parser.add_argument("--receipt-dir", type=Path, required=True, help="Directory containing rehearsal receipts")
    parser.add_argument("--output", type=Path, required=True, help="Path for the standalone dashboard HTML")
    parser.add_argument("--limit", type=dashboard_limit, default=100, help="Newest runs to include (default 100)")
    args = parser.parse_args(argv)
    guard_receipt_output(args.receipt_dir, args.output)
    save_report(args.output, dashboard_html(read_history(args.receipt_dir, args.limit)))
    print(f"Saved rehearsal dashboard to {args.output}")


def evaluate_plan(args: Namespace, transitions: dict[tuple[str, str], int] | None):
    if args.html:
        if args.receipt_dir is not None:
            guard_receipt_output(args.receipt_dir, args.html)
        if any(path and args.html.resolve() == path.resolve() for path in (args.plan, args.snapshot)):
            raise RehearsalError("The report path must be different from the input files")
    required_baseline = args.require_baseline
    if required_baseline is not None:
        required_baseline = validate_fingerprint(required_baseline, "Required baseline")
    edits, cases = parse_plan(read_json(args.plan, args.max_input_mib))
    report = rehearse(
        load_snapshot(args), edits, cases, evaluation=args.evaluation,
        required_baseline=required_baseline, summary_only=args.summary, transitions=transitions,
    )
    if args.html:
        save_report(args.html, html_report(report))
    return report


def run_rehearsal(argv: list[str]) -> int:
    parser = ArgumentParser(
        description="Test a proposed Flagsmith targeting change against saved personas.",
        epilog="See also: flagsmith-rehearsal inspect --help and flagsmith-rehearsal dashboard --help.",
    )
    parser.add_argument("plan", type=Path, help="JSON plan with edits and expected flag values")
    add_source_arguments(parser)
    parser.add_argument(
        "--evaluation", choices=("both", "bulk", "single"), default="both",
        help="Python SDK local evaluation path (default requires bulk and single-flag results to agree)",
    )
    parser.add_argument("--require-baseline", metavar="SHA256", help="Reject a snapshot if its fingerprint changed")
    parser.add_argument(
        "--save-receipts", dest="receipt_dir", type=Path, metavar="DIRECTORY",
        help="Save a redacted run receipt for the history dashboard",
    )
    parser.add_argument("--json", action="store_true", help="Write structured results to stdout")
    detail = parser.add_mutually_exclusive_group()
    detail.add_argument("--html", type=Path, help="Also save a standalone browser report")
    detail.add_argument("--summary", action="store_true", help="Calculate totals without keeping per-persona results")
    args = parser.parse_args(argv)

    if args.receipt_dir is None:
        report = evaluate_plan(args, None)
    else:
        started = monotonic_ns()
        transitions: dict[tuple[str, str], int] = {}
        try:
            report = evaluate_plan(args, transitions)
        except COMMAND_ERRORS as error:
            duration_ms = (monotonic_ns() - started) // 1_000_000
            try:
                record_run(args.receipt_dir, args.evaluation, duration_ms, None, transitions)
            except RehearsalError as receipt_error:
                raise RehearsalError(f"{error}\n{receipt_error}") from receipt_error
            raise
        duration_ms = (monotonic_ns() - started) // 1_000_000
        record_run(args.receipt_dir, args.evaluation, duration_ms, report, transitions)

    print(json.dumps(report, indent=2) if args.json else text_report(report))
    return int(report["summary"]["failed"] > 0)


def main() -> int:
    argv = sys.argv[1:]
    try:
        if argv and argv[0] == "inspect":
            run_inspect(argv[1:])
            return 0
        # Snapshot options (including argparse abbreviations) still allow a plan named "dashboard".
        if argv and argv[0] == "dashboard" and not any(arg.startswith(("--sn", "--u")) for arg in argv[1:]):
            run_dashboard(argv[1:])
            return 0
        return run_rehearsal(argv)
    except COMMAND_ERRORS as error:
        print(f"Rehearsal error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
