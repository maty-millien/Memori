from __future__ import annotations

from typing import Any

from memori.benchmark.graders.common import (
    ScenarioResult,
    check_count_spec,
    check_tool_calls,
    memory_from_dict,
)
from memori.benchmark.report import (
    LogFn,
    Status,
    log_header,
    log_initial_memories,
    log_llm_exchange,
    log_memories,
    log_result,
    log_snapshot,
    log_text,
    noop,
)
from memori.domain.engine import Engine
from memori.llm.apply import apply_tool_call
from memori.llm.chat import chat


def grade_memory_tool_call(
    scenario: dict[str, Any], engine: Engine, log: LogFn = noop
) -> ScenarioResult:
    log_header(log, scenario)
    initial_raw = scenario.get("initial_memories", []) or []
    log_initial_memories(log, [memory_from_dict(m) for m in initial_raw])
    engine.reset([memory_from_dict(m) for m in initial_raw])

    user_turns = [t for t in scenario.get("turns", []) if t.get("role") == "user"]
    if not user_turns:
        early_failures = ["scenario has no user turn"]
        log_result(log, "failed", early_failures)
        return ScenarioResult(
            scenario_id=scenario["id"],
            scenario_type=scenario["type"],
            status="failed",
            messages=early_failures,
        )
    user_content = user_turns[-1]["content"]
    log_text(log, "User turn", user_content)

    injected = [r.memory for r in engine.retrieve_memories(user_content)]
    log_memories(log, "Injected memories (sent to LLM)", injected)
    recent, similar = engine.retrieve_conversations(user_content)
    log_memories(log, "Recent conversations (sent to LLM)", recent)
    log_memories(log, "Similar conversations (sent to LLM)", similar)

    result = chat(user_content, injected, recent, similar)
    log_llm_exchange(log, result)

    for call in result.tool_calls:
        apply_tool_call(call, engine)

    log_snapshot(log, engine)

    expected = scenario.get("expected", {}) or {}
    failures = check_tool_calls(result.tool_calls, expected)
    failures.extend(
        check_count_spec(
            len(engine.memories()),
            expected.get("final_memory_count", {}) or {},
            "final",
        )
    )

    status: Status = "failed" if failures else "passed"
    log_result(log, status, failures)
    return ScenarioResult(
        scenario_id=scenario["id"],
        scenario_type=scenario["type"],
        status=status,
        messages=failures,
    )
