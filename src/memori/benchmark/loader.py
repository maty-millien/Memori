from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT_DIR = Path(__file__).resolve().parents[3]
DEFAULT_BENCHMARK_DIR = ROOT_DIR / "benchmarks"


def load_scenarios(benchmark_dir: Path = DEFAULT_BENCHMARK_DIR) -> list[dict[str, Any]]:
    if not benchmark_dir.is_dir():
        raise NotADirectoryError(f"Benchmark directory does not exist: {benchmark_dir}")

    scenarios: list[dict[str, Any]] = []
    for path in sorted(benchmark_dir.glob("*.yaml")):
        with path.open(encoding="utf-8") as file:
            scenario = yaml.safe_load(file)
        if not isinstance(scenario, dict):
            raise ValueError(f"Scenario file must contain an object: {path}")
        scenarios.append(scenario)

    return scenarios
