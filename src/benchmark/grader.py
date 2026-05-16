from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, cast

from core.engine import Memory, MemoryEngine, MemoryKind


Status = Literal["passed", "failed", "skipped"]


@dataclass
class ScenarioResult:
    scenario_id: str
    scenario_type: str
    status: Status
    messages: list[str] = field(default_factory=list)


def _memory_from_dict(raw: dict[str, Any]) -> Memory:
    return Memory(
        id=raw["id"],
        kind=cast(MemoryKind, raw["kind"]),
        content=raw["content"],
    )


def grade_retrieval_injection(
    scenario: dict[str, Any], engine: MemoryEngine
) -> ScenarioResult:
    engine.seed([_memory_from_dict(m) for m in scenario.get("initial_memories", [])])

    user_turns = [t for t in scenario.get("turns", []) if t.get("role") == "user"]
    query = user_turns[-1]["content"] if user_turns else ""

    expected = scenario.get("expected", {})
    ids_spec = expected.get("injected_memory_ids", {})
    max_count = ids_spec.get("max_count", 5)

    retrieved = engine.retrieve(query, top_k=max_count)
    retrieved_ids = [r.memory.id for r in retrieved]
    failures: list[str] = []

    for required in ids_spec.get("include", []):
        if required not in retrieved_ids:
            failures.append(
                f"expected memory '{required}' to be retrieved (got {retrieved_ids})"
            )
    for forbidden in ids_spec.get("exclude", []):
        if forbidden in retrieved_ids:
            failures.append(
                f"expected memory '{forbidden}' to be excluded (got {retrieved_ids})"
            )
    if len(retrieved_ids) > max_count:
        failures.append(
            f"retrieved {len(retrieved_ids)} memories, exceeds max_count {max_count}"
        )

    content_spec = expected.get("injected_memory_content", {})
    concatenated = " ".join(r.memory.content for r in retrieved)
    for matcher in content_spec.get("should_match", []):
        pattern = matcher["regex"]
        if not re.search(pattern, concatenated):
            failures.append(f"injected content did not match regex {pattern!r}")
    for matcher in content_spec.get("should_not_match", []):
        pattern = matcher["regex"]
        if re.search(pattern, concatenated):
            failures.append(f"injected content unexpectedly matched regex {pattern!r}")

    return ScenarioResult(
        scenario_id=scenario["id"],
        scenario_type=scenario["type"],
        status="failed" if failures else "passed",
        messages=failures,
    )


_GRADERS: dict[str, Callable[[dict[str, Any], MemoryEngine], ScenarioResult]] = {
    "retrieval_injection": grade_retrieval_injection,
}


def grade(scenario: dict[str, Any], engine: MemoryEngine) -> ScenarioResult:
    scenario_type = scenario.get("type", "")
    grader = _GRADERS.get(scenario_type)
    if grader is None:
        return ScenarioResult(
            scenario_id=scenario.get("id", "<unknown>"),
            scenario_type=scenario_type,
            status="skipped",
            messages=[f"no grader implemented for type '{scenario_type}'"],
        )
    return grader(scenario, engine)
