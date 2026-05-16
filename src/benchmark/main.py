from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import chromadb
from dotenv import load_dotenv

from benchmark.grader import ScenarioResult, grade
from benchmark.loader import load_scenarios
from core.engine import MemoryEngine


_SYMBOLS = {"passed": "PASS", "failed": "FAIL", "skipped": "SKIP"}
_RUNS_DIR = Path("runs")


def _summarize(results: list[ScenarioResult]) -> tuple[int, int, int]:
    passed = sum(1 for r in results if r.status == "passed")
    failed = sum(1 for r in results if r.status == "failed")
    skipped = sum(1 for r in results if r.status == "skipped")
    return passed, failed, skipped


def main() -> None:
    load_dotenv()
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

        def _run(sc: dict) -> tuple[ScenarioResult, list[str]]:
            buf: list[str] = []
            return grade(sc, MemoryEngine(), buf.append), buf

        # First-init of chromadb.Client() races on tenant validation when
        # called concurrently from threads; do it once on the main thread.
        chromadb.Client()
        with ThreadPoolExecutor() as ex:
            pairs = list(ex.map(_run, scenarios))
        for _, buf in pairs:
            for line in buf:
                log(line)
        results: list[ScenarioResult] = [r for r, _ in pairs]

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
