from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from memori.benchmark.loader import load_scenarios
from memori.benchmark.runner import run_suite


RUNS_DIR = Path("runs")


def main() -> None:
    load_dotenv()
    RUNS_DIR.mkdir(exist_ok=True)

    scenarios = load_scenarios()
    print(f"Running {len(scenarios)} benchmark scenarios (synchronous)")
    result = run_suite(scenarios, progress=lambda line: print(line, flush=True))

    path = RUNS_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    with path.open("w", encoding="utf-8") as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
        file.write("\n")

    totals = result["totals"]
    print(
        f"{totals['passed']} passed, {totals['failed']} failed, "
        f"{totals['error']} errors (of {totals['total']})"
    )
    print(f"JSON artifact: {path}")
    if totals["failed"] or totals["error"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
