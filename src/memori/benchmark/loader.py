from __future__ import annotations

from pathlib import Path

import yaml

from memori.benchmark.schema import ScenarioSpec


DEFAULT_BENCHMARK_DIR = Path("benchmarks")


def load_scenarios(benchmark_dir: Path = DEFAULT_BENCHMARK_DIR) -> list[ScenarioSpec]:
    if not benchmark_dir.is_dir():
        raise NotADirectoryError(f"Benchmark directory does not exist: {benchmark_dir}")

    scenarios: list[ScenarioSpec] = []
    for path in sorted(benchmark_dir.glob("*.yaml")):
        with path.open(encoding="utf-8") as file:
            raw = yaml.safe_load(file)
        scenarios.append(ScenarioSpec.model_validate(raw))
    return scenarios
