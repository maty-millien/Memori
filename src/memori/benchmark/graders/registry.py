from __future__ import annotations

from typing import Any, Callable

from memori.benchmark.graders.common import ScenarioResult
from memori.benchmark.graders.full_loop import grade_full_loop
from memori.benchmark.graders.retrieval import grade_retrieval_injection
from memori.benchmark.graders.tool_call import grade_memory_tool_call
from memori.benchmark.report import LogFn, noop
from memori.domain.engine import Engine


GRADERS: dict[str, Callable[[dict[str, Any], Engine, LogFn], ScenarioResult]] = {
    "retrieval_injection": grade_retrieval_injection,
    "memory_tool_call": grade_memory_tool_call,
    "full_loop": grade_full_loop,
}


def grade(
    scenario: dict[str, Any], engine: Engine, log: LogFn = noop
) -> ScenarioResult:
    scenario_type = scenario.get("type", "")
    grader = GRADERS.get(scenario_type)
    if grader is None:
        log("---")
        log("")
        log(f"## `{scenario.get('id', '<unknown>')}` — `{scenario_type}` _(skipped)_")
        log("")
        log(f"- no grader implemented for type '{scenario_type}'")
        log("")
        return ScenarioResult(
            scenario_id=scenario.get("id", "<unknown>"),
            scenario_type=scenario_type,
            status="skipped",
            messages=[f"no grader implemented for type '{scenario_type}'"],
        )
    return grader(scenario, engine, log)
