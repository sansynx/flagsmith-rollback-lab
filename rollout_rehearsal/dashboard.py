from html import escape
from importlib.resources import files
import json
from typing import Any


def _browser_run(run: dict[str, Any]) -> dict[str, Any]:
    item = {
        "status": run["status"],
        "evaluation": run["evaluation"],
        "finished_at": run["finished_at"].isoformat(timespec="milliseconds"),
        "duration_ms": str(run["duration_ms"]),
    }
    if "summary" in run:
        item.update(
            baseline_sha256=run["baseline_sha256"],
            summary={key: str(count) for key, count in run["summary"].items()},
            transitions=[{**row, "count": str(row["count"])} for row in run["transitions"]],
        )
    return item


def dashboard_html(history: list[dict[str, Any]]) -> str:
    assets = files("rollout_rehearsal").joinpath("dashboard_assets")
    css = assets.joinpath("dashboard.css").read_text(encoding="utf-8")
    script = assets.joinpath("dashboard.js").read_text(encoding="utf-8")
    licenses = "\n\n".join(
        assets.joinpath(name).read_text(encoding="utf-8")
        for name in ("dashboard.LICENSE.md", "SHADCN-LICENSE.md", "IBM-PLEX-LICENSE.md")
    )
    data = json.dumps([_browser_run(run) for run in history], separators=(",", ":")).replace("<", r"\u003c")
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">
  <title>Rollout history · Flagsmith Rehearsal</title>
  <style>{css}</style>
</head>
<body>
  <div id="dashboard-root"></div>
  <noscript>Enable JavaScript in your browser to view the offline rehearsal dashboard.</noscript>
  <template id="dashboard-licenses"><pre>{escape(licenses)}</pre></template>
  <script id="rehearsal-data" type="application/json">{data}</script>
  <script>{script}</script>
</body>
</html>
"""
