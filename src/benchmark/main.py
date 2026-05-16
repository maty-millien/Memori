from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from benchmark.grader import ScenarioResult, grade
from benchmark.loader import load_scenarios
from core.engine import MemoryEngine


_SYMBOLS = {"passed": "PASS", "failed": "FAIL", "skipped": "SKIP"}
_RUNS_DIR = Path("runs")


def _load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _summarize(results: list[ScenarioResult]) -> tuple[int, int, int]:
    passed = sum(1 for r in results if r.status == "passed")
    failed = sum(1 for r in results if r.status == "failed")
    skipped = sum(1 for r in results if r.status == "skipped")
    return passed, failed, skipped


def main() -> None:
    _load_dotenv()
    _RUNS_DIR.mkdir(exist_ok=True)
    log_path = (
        _RUNS_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.log"
    )

    with log_path.open("w", encoding="utf-8") as log_file:

        def log(line: str = "") -> None:
            log_file.write(line + "\n")

        scenarios = load_scenarios()
        log(f"Memori benchmark run @ {datetime.now(timezone.utc).isoformat()}")
        log(f"Scenarios: {len(scenarios)}")
        log("")

        results: list[ScenarioResult] = [
            grade(sc, MemoryEngine(), log) for sc in scenarios
        ]

        passed, failed, skipped = _summarize(results)
        log("=" * 78)
        log("SUMMARY")
        log("=" * 78)
        for r in results:
            log(f"[{_SYMBOLS[r.status]}] {r.scenario_id} ({r.scenario_type})")
            for message in r.messages:
                log(f"       {message}")
        log("")
        log(f"{passed} passed, {failed} failed, {skipped} skipped (of {len(results)})")

    for r in results:
        print(f"[{_SYMBOLS[r.status]}] {r.scenario_id} ({r.scenario_type})")
        for message in r.messages:
            print(f"       {message}")
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped (of {len(results)})")
    print(f"\nFull log: {log_path}")


if __name__ == "__main__":
    main()
