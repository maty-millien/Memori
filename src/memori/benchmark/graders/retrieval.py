from __future__ import annotations

import re
from typing import Any

from memori.benchmark.graders.common import (
    ScenarioResult,
    memory_from_dict,
)
from memori.benchmark.report import (
    LogFn,
    Status,
    log_header,
    log_initial_memories,
    log_result,
    log_retrieved,
    log_text,
    noop,
)
from memori.domain.engine import Engine


def grade_retrieval_injection(
    scenario: dict[str, Any], engine: Engine, log: LogFn = noop
) -> ScenarioResult:
    log_header(log, scenario)
    initial_raw = scenario.get("initial_memories", []) or []
    log_initial_memories(log, [memory_from_dict(m) for m in initial_raw])
    engine.reset([memory_from_dict(m) for m in initial_raw])

    user_turns = [t for t in scenario.get("turns", []) if t.get("role") == "user"]
    query = user_turns[-1]["content"] if user_turns else ""
    log_text(log, "User turn", query)

    expected = scenario.get("expected", {}) or {}
    ids_spec = expected.get("injected_memory_ids", {}) or {}
    max_count = ids_spec.get("max_count", 10)

    retrieved = engine.retrieve_memories(query)
    retrieved_ids = [r.memory.id for r in retrieved]
    log_retrieved(log, retrieved)

    failures: list[str] = []
    for required in ids_spec.get("include", []) or []:
        if required not in retrieved_ids:
            failures.append(
                f"expected memory '{required}' to be retrieved (got {retrieved_ids})"
            )
    for forbidden in ids_spec.get("exclude", []) or []:
        if forbidden in retrieved_ids:
            failures.append(
                f"expected memory '{forbidden}' to be excluded (got {retrieved_ids})"
            )
    if len(retrieved_ids) > max_count:
        failures.append(
            f"retrieved {len(retrieved_ids)} memories, exceeds max_count {max_count}"
        )

    content_spec = expected.get("injected_memory_content", {}) or {}
    concatenated = " ".join(r.memory.content for r in retrieved)
    for matcher in content_spec.get("should_match", []) or []:
        pattern = matcher["regex"]
        if not re.search(pattern, concatenated):
            failures.append(f"injected content did not match regex {pattern!r}")
    for matcher in content_spec.get("should_not_match", []) or []:
        pattern = matcher["regex"]
        if re.search(pattern, concatenated):
            failures.append(f"injected content unexpectedly matched regex {pattern!r}")

    status: Status = "failed" if failures else "passed"
    log_result(log, status, failures)
    return ScenarioResult(
        scenario_id=scenario["id"],
        scenario_type=scenario["type"],
        status=status,
        messages=failures,
    )
