from __future__ import annotations

from pathlib import Path

import yaml

from bench.models import ScenarioSpec


DEFAULT_BENCH_DIR = Path("tools") / "bench" / "scenarios"


def load_scenarios(bench_dir: Path = DEFAULT_BENCH_DIR) -> list[ScenarioSpec]:
    if not bench_dir.is_dir():
        raise NotADirectoryError(f"Bench directory does not exist: {bench_dir}")

    scenarios: list[ScenarioSpec] = []
    for path in sorted(bench_dir.glob("*.yaml")):
        with path.open(encoding="utf-8") as file:
            raw = yaml.safe_load(file)
        scenarios.append(ScenarioSpec.model_validate(raw))
    return scenarios
