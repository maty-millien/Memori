from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import chromadb
from dotenv import load_dotenv

from memori.benchmark.graders.common import ScenarioResult
from memori.benchmark.graders.registry import grade
from memori.benchmark.loader import load_scenarios
from memori.domain.engine import Engine


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
    log_path = _RUNS_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.md"

    with log_path.open("w", encoding="utf-8") as log_file:

        def log(line: str = "") -> None:
            log_file.write(line + "\n")

        scenarios = load_scenarios()
        log("# Memori benchmark run")
        log("")
        log(
            f"_{datetime.now(timezone.utc).isoformat()}_  ·  **Scenarios:** {len(scenarios)}"
        )
        log("")

        def _run(sc: dict) -> tuple[ScenarioResult, list[str]]:
            buf: list[str] = []
            print(f"  … {sc.get('id', '<unknown>')}", flush=True)
            result = grade(sc, Engine(), buf.append)
            print(
                f"[{_SYMBOLS[result.status]}] {result.scenario_id} ({result.scenario_type})",
                flush=True,
            )
            for message in result.messages:
                print(f"       {message}", flush=True)
            return result, buf

        # First-init of chromadb.Client() races on tenant validation when
        # called concurrently from threads; do it once on the main thread.
        chromadb.Client()
        print(f"Running {len(scenarios)} scenarios (concurrency=3)…", flush=True)
        with ThreadPoolExecutor(max_workers=3) as ex:
            pairs = list(ex.map(_run, scenarios))
        for _, buf in pairs:
            for line in buf:
                log(line)
        results: list[ScenarioResult] = [r for r, _ in pairs]

        passed, failed, skipped = _summarize(results)
        log("## Summary")
        log("")
        for r in results:
            log(f"- **{_SYMBOLS[r.status]}** `{r.scenario_id}` ({r.scenario_type})")
            for message in r.messages:
                log(f"  - {message}")
        log("")
        log(
            f"**{passed} passed, {failed} failed, {skipped} skipped (of {len(results)})**"
        )

    print(f"\n{passed} passed, {failed} failed, {skipped} skipped (of {len(results)})")
    print(f"Full log: {log_path}")


if __name__ == "__main__":
    main()
