from html import escape
from json import dumps
from typing import Any

EVALUATION_LABELS = {
    "both": "Both Python SDK local paths",
    "bulk": "Python SDK bulk local evaluation",
    "single": "Python SDK single-flag local evaluation",
}


def _summary(totals: dict[str, int]) -> str:
    return f'{totals["passed"]} passed · {totals["failed"]} failed · {totals["changed"]} changed'


def _state(state: dict[str, Any]) -> str:
    parts = []
    if "enabled" in state:
        parts.append("On" if state["enabled"] else "Off")
    if "value" in state:
        parts.append(dumps(state["value"], ensure_ascii=False, sort_keys=True))
    if state.get("variant") is not None:
        parts.append(f'variant {state["variant"]}')
    return " · ".join(parts)


def text_report(report: dict[str, Any]) -> str:
    checks = report.get("checks", [])
    lines = [
        f'Rollout rehearsal for {report["environment"]}',
        _summary(report["summary"]),
        EVALUATION_LABELS[report["evaluation"]],
        f'Baseline SHA-256 {report["baseline_sha256"]}',
    ]
    lines.extend(report["edits"])
    lines.append("")
    for row in checks:
        verdict = "PASS" if row["passed"] else "FAIL"
        lines.append(
            f'{verdict}  {row["case"]} · {row["flag"]}  '
            f'{_state(row["before"])} → {_state(row["after"])}  '
            f'(expected {_state(row["expected"])})'
        )
        if not row["passed"]:
            lines.append(f'      {row["after"]["reason"]}')
    return "\n".join(lines)


def html_report(report: dict[str, Any]) -> str:
    environment = escape(report["environment"])
    checks = report["checks"]
    summary = escape(_summary(report["summary"]))
    edits = "".join(f"<li>{escape(edit)}</li>" for edit in report["edits"])
    changes = f"<h2>Proposed edits</h2><ul>{edits}</ul>" if edits else ""
    rows = []
    for row in checks:
        verdict = "Pass" if row["passed"] else "Fail"
        reason = escape(row["after"]["reason"])
        rows.append(f"""
        <tr class="{verdict.lower()}">
          <th scope="row">{escape(row["case"])}<code>{escape(row["flag"])}</code></th>
          <td>{escape(_state(row["before"]))}</td>
          <td>{escape(_state(row["after"]))}<small>{reason}</small></td>
          <td>{escape(_state(row["expected"]))}</td>
          <td><strong>{verdict}</strong></td>
        </tr>""")

    return f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rollout rehearsal · {environment}</title>
<style>
  * {{ box-sizing: border-box }}
  body {{
    margin: 0; padding: clamp(1rem, 6vw, 5rem) 1rem;
    background: #f4f5fa; color: #181b2f;
    font: 1rem/1.55 system-ui, sans-serif;
  }}
  main {{ max-width: 66rem; margin: auto }}
  header {{
    background: #211d43; color: #fff; padding: clamp(1.25rem, 4vw, 2.75rem);
    border-radius: 1rem; margin-bottom: 2rem;
  }}
  h1 {{ margin: 0; font-size: clamp(1.8rem, 5vw, 3rem); line-height: 1.12 }}
  header p {{ margin: .75rem 0 0; color: #dfdcfa }}
  header code {{ color: #dfdcfa; overflow-wrap: anywhere }}
  h2 {{ font-size: 1.15rem; margin: 1.5rem 0 .5rem }}
  ul {{ margin: .25rem 0 1.5rem; padding-left: 1.4rem }}
  .table {{ overflow-x: auto; background: #fff; border: 1px solid #d9dcec; border-radius: .8rem }}
  table {{ width: 100%; min-width: 43rem; border-collapse: collapse; text-align: left }}
  th, td {{ padding: .85rem 1rem; vertical-align: top; border-bottom: 1px solid #e7e8f0 }}
  thead {{ background: #ececf7 }}
  tbody tr:last-child > * {{ border-bottom: 0 }}
  code, small {{ display: block; color: #50536b; margin-top: .2rem }}
  .fail {{ background: #fff2f0 }}
  .fail strong {{ color: #9b2823 }}
  .pass strong {{ color: #176044 }}
</style>
<main>
  <header>
    <h1>Rollout rehearsal</h1>
    <p>{environment} · {summary}</p>
    <p>{escape(EVALUATION_LABELS[report["evaluation"]])} · Baseline SHA-256 <code>{escape(report["baseline_sha256"])}</code></p>
  </header>
  {changes}
  <h2 id="checks">Persona checks</h2>
  <div class="table" role="region" aria-labelledby="checks" tabindex="0">
    <table aria-labelledby="checks">
      <thead><tr><th scope="col">Persona</th><th scope="col">Before</th><th scope="col">Proposed</th><th scope="col">Expected</th><th scope="col">Result</th></tr></thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
  </div>
</main>
</html>
"""
