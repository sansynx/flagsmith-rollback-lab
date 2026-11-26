import json
import math
from pathlib import Path
from tempfile import NamedTemporaryFile

from .rehearsal import RehearsalError


def reject_non_json_number(value: str) -> None:
    raise RehearsalError(f"{value} is not a valid JSON number")


def finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise RehearsalError("JSON number is outside the supported range")
    return number


def unique_fields(pairs: list[tuple[str, object]]) -> dict[str, object]:
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise RehearsalError("Input JSON contains a repeated field name")
    return fields


def decode_json(contents: bytes | bytearray, error_message: str):
    try:
        return json.loads(
            contents,
            parse_constant=reject_non_json_number,
            parse_float=finite_float,
            object_pairs_hook=unique_fields,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RehearsalError(error_message) from error


def save_report(path: Path, contents: str) -> None:
    output = NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", delete=False)
    temporary_path = Path(output.name)
    try:
        with output:
            output.write(contents)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)
