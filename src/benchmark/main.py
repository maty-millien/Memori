from __future__ import annotations

import os
from pathlib import Path

from benchmark.grader import ScenarioResult, grade
from benchmark.loader import load_scenarios
from core.engine import MemoryEngine


_SYMBOLS = {"passed": "PASS", "failed": "FAIL", "skipped": "SKIP"}


def _load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    _load_dotenv()
    scenarios = load_scenarios()
    results: list[ScenarioResult] = [grade(sc, MemoryEngine()) for sc in scenarios]

    for result in results:
        print(
            f"[{_SYMBOLS[result.status]}] {result.scenario_id} ({result.scenario_type})"
        )
        for message in result.messages:
            print(f"       {message}")

    passed = sum(1 for r in results if r.status == "passed")
    failed = sum(1 for r in results if r.status == "failed")
    skipped = sum(1 for r in results if r.status == "skipped")
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped (of {len(results)})")


if __name__ == "__main__":
    main()
