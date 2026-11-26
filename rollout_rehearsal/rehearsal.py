from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from json import dumps
import re
from typing import Any, cast, get_args

from flag_engine.engine import get_evaluation_result
from flag_engine.segments.types import ConditionOperator, RuleType
from flagsmith.api.types import EnvironmentModel
from flagsmith.mappers import (
    map_context_and_identity_data_to_context,
    map_environment_document_to_context,
)
from flagsmith.models import Flags, SegmentOverridesIndex, build_segment_overrides_index
from flagsmith.types import SDKEvaluationContext


class RehearsalError(ValueError):
    """An input or evaluation problem that prevented a reliable verdict."""


@dataclass(frozen=True)
class RuleEdit:
    segment: str
    path: tuple[int, ...]
    segment_sha256: str
    previous_type: str
    proposed_type: str

    @property
    def description(self) -> str:
        positions = ".".join(str(index + 1) for index in self.path)
        return f"{self.segment}, rule {positions} · {self.previous_type} → {self.proposed_type}"


@dataclass(frozen=True)
class TestCase:
    name: str
    identifier: str
    traits: dict[str, Any]
    expectations: dict[str, dict[str, Any]]


RULE_TYPES = get_args(RuleType)
CONDITION_OPERATORS = get_args(ConditionOperator)
EXPECTATION_FIELDS = {"enabled", "value"}
REASON_CODES = {"DEFAULT", "STATIC", "TARGETING_MATCH", "SPLIT", "OTHER"}


def _reason_code(reason: str | None) -> str:
    code = (reason or "").partition(";")[0]
    return code if code in REASON_CODES else "OTHER"


def fingerprint(value: Any) -> str:
    encoded = dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return sha256(encoded.encode("utf-8")).hexdigest()


def validate_fingerprint(value: Any, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise RehearsalError(f"{label} must be a lowercase SHA-256 digest from inspect")
    return value


def _segment_fingerprint(environment_key: str, segment: dict[str, Any]) -> str:
    return fingerprint({
        "environment_key": environment_key,
        "segment_id": segment["key"],
        "segment_name": segment["name"],
        "rules": segment["rules"],
    })


def _validate_fields(value: Any, fields: set[str], label: str) -> None:
    if not isinstance(value, dict) or value.keys() != fields:
        names = ", ".join(sorted(fields))
        raise RehearsalError(f"{label} must contain these fields: {names}")


def _nonempty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RehearsalError(f"{label} must be a nonempty string")
    return value


def parse_plan(plan: Any) -> tuple[list[RuleEdit], list[TestCase]]:
    _validate_fields(plan, {"edits", "cases"}, "Plan")
    if not isinstance(plan["edits"], list):
        raise RehearsalError("Plan edits must be an array")
    if not isinstance(plan["cases"], list) or not plan["cases"]:
        raise RehearsalError("Plan cases must be a nonempty array")

    edits = []
    rule_targets = set()
    for index, edit in enumerate(plan["edits"], start=1):
        label = f"Edit {index}"
        _validate_fields(edit, {"segment", "rule_path", "segment_sha256", "from", "to"}, label)
        segment = _nonempty_string(edit["segment"], f"{label} segment")
        path = edit["rule_path"]
        if (
            not isinstance(path, list)
            or not path
            or any(type(item) is not int or item < 0 for item in path)
        ):
            raise RehearsalError(f"{label} rule_path must contain zero-based indexes")
        previous_type = _nonempty_string(edit["from"], f"{label} from")
        proposed_type = _nonempty_string(edit["to"], f"{label} to")
        if previous_type not in RULE_TYPES or proposed_type not in RULE_TYPES or previous_type == proposed_type:
            raise RehearsalError(f"{label} must change between two rule types: ALL, ANY, NONE")
        target = segment, tuple(path)
        if target in rule_targets:
            raise RehearsalError(f"Duplicate edit for segment {segment!r} and rule path {path}")
        rule_targets.add(target)
        digest = validate_fingerprint(edit["segment_sha256"], f"{label} segment_sha256")
        edits.append(RuleEdit(segment, tuple(path), digest, previous_type, proposed_type))

    cases = []
    seen_names = set()
    for index, case in enumerate(plan["cases"], start=1):
        label = f"Case {index}"
        _validate_fields(case, {"name", "identifier", "traits", "expect"}, label)
        name = _nonempty_string(case["name"], f"{label} name")
        if name in seen_names:
            raise RehearsalError(f"Duplicate case name: {name!r}")
        seen_names.add(name)
        identifier = _nonempty_string(case["identifier"], f"{label} identifier")
        traits = case["traits"]
        if not isinstance(traits, dict) or any(
            value is not None and type(value) not in (str, int, float, bool)
            for value in traits.values()
        ):
            raise RehearsalError(f"{label} traits must be an object with scalar values")
        expectations = case["expect"]
        if not isinstance(expectations, dict) or not expectations:
            raise RehearsalError(f"{label} expect must be a nonempty object")
        for flag, expected in expectations.items():
            _nonempty_string(flag, f"{label} flag name")
            if not isinstance(expected, dict) or not expected or not expected.keys() <= EXPECTATION_FIELDS:
                raise RehearsalError(f"{label} expectation for {flag!r} needs enabled, value, or both")
            if "enabled" in expected and type(expected["enabled"]) is not bool:
                raise RehearsalError(f"{label} expected enabled state for {flag!r} must be true or false")
        cases.append(TestCase(name, identifier, traits, expectations))
    return edits, cases


def _validate_rules(rules: Any, segment: str) -> None:
    if not isinstance(rules, list):
        raise RehearsalError(f"SDK snapshot rules for {segment!r} must be an array")
    for rule in rules:
        if not isinstance(rule, dict) or rule.get("type") not in RULE_TYPES:
            raise RehearsalError(f"Invalid rule type in SDK snapshot for {segment!r}")
        conditions = rule.get("conditions", [])
        if not isinstance(conditions, list):
            raise RehearsalError(f"SDK snapshot conditions for {segment!r} must be an array")
        for condition in conditions:
            if (
                not isinstance(condition, dict)
                or not {"property_", "operator", "value"} <= condition.keys()
                or condition["operator"] not in CONDITION_OPERATORS
                or (condition["property_"] is not None and not isinstance(condition["property_"], str))
                or (condition["value"] is not None and not isinstance(condition["value"], str))
            ):
                raise RehearsalError(
                    f"Invalid condition in SDK snapshot for {segment!r}. Expected property_, operator and value"
                )
        _validate_rules(rule.get("rules", []), segment)


def _validate_snapshot(document: Any) -> None:
    if not isinstance(document, dict):
        raise RehearsalError("Snapshot must be a Flagsmith SDK environment document")
    _nonempty_string(document.get("api_key"), "SDK snapshot environment key")
    if "name" not in document or (document["name"] is not None and not isinstance(document["name"], str)):
        raise RehearsalError("Invalid environment name in SDK snapshot")
    project = document.get("project")
    if not isinstance(project, dict) or not isinstance(project.get("segments"), list):
        raise RehearsalError("SDK snapshot project must contain a segments array")
    segment_ids = set()
    for segment in project["segments"]:
        if not isinstance(segment, dict) or type(segment.get("id")) is not int:
            raise RehearsalError("Invalid segment ID in SDK snapshot")
        if segment["id"] in segment_ids:
            raise RehearsalError(f'Duplicate segment ID in SDK snapshot: {segment["id"]}')
        segment_ids.add(segment["id"])
        name = _nonempty_string(segment.get("name"), "SDK snapshot segment name")
        _validate_rules(segment.get("rules"), name)


def _apply_rule_edit(
    baseline: SDKEvaluationContext, candidate: SDKEvaluationContext, edit: RuleEdit,
) -> set[str]:
    matching = [
        (key, segment) for key, segment in baseline["segments"].items()
        if segment["name"] == edit.segment and segment["metadata"]["source"] == "api"
    ]
    if len(matching) != 1:
        raise RehearsalError(f"Expected one segment named {edit.segment!r}, found {len(matching)}")
    key, segment = matching[0]
    parent = candidate["segments"][key]
    try:
        for index in edit.path:
            parent = parent["rules"][index]
    except (IndexError, KeyError) as error:
        raise RehearsalError(f"Rule path {list(edit.path)} does not exist in {edit.segment!r}") from error

    actual_type = parent["type"]
    if actual_type != edit.previous_type:
        raise RehearsalError(
            f"Rule {list(edit.path)} in {edit.segment!r} is {actual_type}, expected {edit.previous_type}"
        )
    if _segment_fingerprint(baseline["environment"]["key"], segment) != edit.segment_sha256:
        raise RehearsalError(
            f"The segment fingerprint for {edit.segment!r} changed. Inspect the baseline and review the plan"
        )
    parent["type"] = edit.proposed_type
    return {override["name"] for override in segment["overrides"]}


def _flag_result(flags: dict[str, Any], flag: str, case: str) -> dict[str, Any]:
    if flag not in flags:
        raise RehearsalError(f"Flag {flag!r} could not be evaluated for {case!r}")
    result = flags[flag]
    if result["reason"].startswith("ERROR"):
        raise RehearsalError(f'Flag {flag!r} could not be evaluated for {case!r}: {result["reason"]}')
    return {field: result[field] for field in ("enabled", "value", "variant", "reason")}


def _same_value(left: Any, right: Any) -> bool:
    # Python considers True and 1 equal, but they are different JSON values.
    if type(left) is not type(right):
        return False
    if isinstance(left, (dict, list)):
        return dumps(left, sort_keys=True) == dumps(right, sort_keys=True)
    return left == right


def _same_outcome(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return all(_same_value(left[field], right[field]) for field in ("enabled", "value", "variant"))


def _snapshot_context(document: Any) -> SDKEvaluationContext:
    _validate_snapshot(document)
    try:
        context = map_environment_document_to_context(cast(EnvironmentModel, document))
        if len(context["features"]) != len(document["feature_states"]):
            raise RehearsalError("Duplicate flag names in SDK snapshot")
    except RehearsalError:
        raise
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise RehearsalError("Snapshot does not match the Flagsmith SDK environment document format") from error
    return context


def _baseline_fingerprint(document: dict[str, Any]) -> str:
    # Use the raw identity overrides. The SDK's derived keys include Python's
    # process-specific hash salts and cannot fingerprint a snapshot across runs.
    return fingerprint({
        "environment": {
            key: document.get(key) for key in (
                "api_key", "name", "hide_disabled_flags", "use_identity_composite_key_for_hashing",
                "use_identity_overrides_in_local_eval",
            )
        },
        "features": document["feature_states"],
        "segments": document["project"]["segments"],
        "identity_overrides": document.get("identity_overrides") or [],
        "project_hides_disabled_flags": document["project"].get("hide_disabled_flags"),
    })


def _list_rule_paths(rules: list[Any], prefix: tuple[int, ...] = ()):
    for index, rule in enumerate(rules):
        path = (*prefix, index)
        yield {"path": list(path), "type": rule["type"]}
        yield from _list_rule_paths(rule["rules"], path)


def inspect_snapshot(document: Any) -> dict[str, Any]:
    context = _snapshot_context(document)
    return {
        "environment": context["environment"]["name"] or "Unnamed environment",
        "baseline_sha256": _baseline_fingerprint(document),
        "segments": [
            {
                "name": segment["name"],
                "segment_sha256": _segment_fingerprint(context["environment"]["key"], segment),
                "rules": list(_list_rule_paths(segment["rules"])),
                "flags": sorted(override["name"] for override in segment["overrides"]),
            }
            for segment in context["segments"].values()
            if segment["metadata"]["source"] == "api"
        ],
    }


def _evaluate_case(
    context: SDKEvaluationContext,
    index: SegmentOverridesIndex,
    case: TestCase,
    tracked_flags: set[str],
    evaluation: str,
    stage: str,
) -> dict[str, Any]:
    identity_context = map_context_and_identity_data_to_context(context, case.identifier, case.traits)
    try:
        results = {}
        if evaluation != "single":
            results = get_evaluation_result(identity_context)["flags"]
            for name in tracked_flags:
                _flag_result(results, name, case.name)
        if evaluation != "bulk":
            flags = Flags.from_evaluation_context(identity_context, index, None, None)
            for name in tracked_flags:
                flag = flags.get_flag(name)
                single = {
                    "enabled": flag.enabled, "value": flag.value,
                    "variant": flag.variant, "reason": flag.reason,
                }
                if flag.reason and flag.reason.startswith("ERROR"):
                    raise RehearsalError(f"Flag {name!r} could not be evaluated for {case.name!r}: {flag.reason}")
                if evaluation == "both" and not _same_outcome(results[name], single):
                    raise RehearsalError(
                        f"Python SDK bulk and single-flag evaluation disagree on {name!r} "
                        f"for {case.name!r} in the {stage}. Select the evaluation path your app uses"
                    )
                if evaluation == "single":
                    results[name] = single
        return results
    except RehearsalError:
        raise
    except (ArithmeticError, AttributeError, KeyError, TypeError, ValueError, re.error) as error:
        raise RehearsalError(f"The Flagsmith engine could not evaluate case {case.name!r} in the {stage}") from error


def rehearse(
    document: Any,
    edits: list[RuleEdit],
    cases: list[TestCase],
    *,
    evaluation: str = "both",
    required_baseline: str | None = None,
    summary_only: bool = False,
    transitions: dict[tuple[str, str], int] | None = None,
) -> dict[str, Any]:
    baseline = _snapshot_context(document)
    digest = _baseline_fingerprint(document)
    if required_baseline is not None and digest != required_baseline:
        raise RehearsalError("Baseline fingerprint changed. Inspect the current snapshot and review the plan")

    checked_flags = {flag for case in cases for flag in case.expectations}
    if missing := checked_flags - baseline["features"].keys():
        raise RehearsalError(f"Flags missing from the SDK snapshot: {', '.join(sorted(missing))}")
    proposed = deepcopy(baseline) if edits else baseline
    affected_flags = set()
    for edit in edits:
        affected = _apply_rule_edit(baseline, proposed, edit)
        if not affected:
            raise RehearsalError(f"The edited segment {edit.segment!r} has no flag overrides")
        if uncovered := affected - checked_flags:
            raise RehearsalError(f"Missing expectations for flags on {edit.segment!r}: {', '.join(sorted(uncovered))}")
        affected_flags.update(affected)

    before_index = build_segment_overrides_index(baseline) if evaluation != "bulk" else {}
    after_index = build_segment_overrides_index(proposed) if edits and evaluation != "bulk" else before_index
    summary = {"passed": 0, "failed": 0, "changed": 0}
    checks = []
    for case in cases:
        tracked_flags = case.expectations.keys() | affected_flags
        before_flags = _evaluate_case(baseline, before_index, case, tracked_flags, evaluation, "baseline")
        after_flags = before_flags
        if edits:
            after_flags = _evaluate_case(proposed, after_index, case, tracked_flags, evaluation, "candidate")
            for flag in sorted(after_flags.keys() - case.expectations.keys()):
                if not _same_outcome(before_flags[flag], after_flags[flag]):
                    raise RehearsalError(f"Flag {flag!r} changed for {case.name!r} without an expectation")
        for flag, expected in case.expectations.items():
            before, after = before_flags[flag], after_flags[flag]
            changed = not _same_outcome(before, after)
            passed = all(_same_value(after[field], value) for field, value in expected.items())
            summary["passed" if passed else "failed"] += 1
            summary["changed"] += changed
            if changed and transitions is not None:
                pair = _reason_code(before["reason"]), _reason_code(after["reason"])
                transitions[pair] = transitions.get(pair, 0) + 1
            if not summary_only:
                checks.append({
                    "case": case.name, "flag": flag, "expected": expected,
                    "before": _flag_result(before_flags, flag, case.name),
                    "after": _flag_result(after_flags, flag, case.name),
                    "changed": changed, "passed": passed,
                })

    report = {
        "environment": baseline["environment"]["name"] or "Unnamed environment",
        "baseline_sha256": digest,
        "evaluation": evaluation,
        "edits": [edit.description for edit in edits],
        "summary": summary,
    }
    if not summary_only:
        report["checks"] = checks
    return report
