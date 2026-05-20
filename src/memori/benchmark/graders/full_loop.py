from __future__ import annotations

from typing import Any

from memori.benchmark.graders.common import (
    ScenarioResult,
    check_content_patterns,
    check_count_spec,
    check_tool_calls,
    memory_from_dict,
)
from memori.benchmark.judge import judge_trait
from memori.benchmark.report import (
    LogFn,
    Status,
    label,
    log_header,
    log_initial_memories,
    log_llm_exchange,
    log_memories,
    log_result,
    log_retrieved,
    log_snapshot,
    log_text,
    noop,
)
from memori.domain.engine import Engine
from memori.llm.chat import chat
from memori.llm.summarize import summarize_session


def grade_full_loop(
    scenario: dict[str, Any], engine: Engine, log: LogFn = noop
) -> ScenarioResult:
    log_header(log, scenario)
    failures: list[str] = []

    for session in scenario.get("sessions", []) or []:
        session_id = session.get("id", "<session>")
        context = f"[{session_id}]"
        log("")
        log(f"### Session · `{session_id}`")

        if "initial_memories" in session:
            initial_raw = session.get("initial_memories", []) or []
            log_initial_memories(log, [memory_from_dict(m) for m in initial_raw])
            engine.reset([memory_from_dict(m) for m in initial_raw])

        user_turns = [
            t for t in session.get("turns", []) or [] if t.get("role") == "user"
        ]
        if not user_turns:
            failures.append(f"{context} session has no user turn")
            continue
        user_content = user_turns[-1]["content"]
        log_text(log, "User turn", user_content)

        injected_content_spec = session.get("expected_injected_content", {}) or {}

        retrieved = engine.retrieve_memories(user_content)
        log_retrieved(log, retrieved, with_reason=False)

        retrieved_text = " ".join(r.memory.content for r in retrieved)
        failures.extend(
            check_content_patterns(
                retrieved_text, injected_content_spec, f"{context} injected content"
            )
        )

        injected_memories = [r.memory for r in retrieved]
        recent, similar = engine.retrieve_conversations(user_content)
        log_memories(log, "Recent conversations (sent to LLM)", recent)
        log_memories(log, "Similar conversations (sent to LLM)", similar)
        result = chat(user_content, injected_memories, recent, similar, engine=engine)
        assistant_content = log_llm_exchange(log, result)

        engine.record_summary(summarize_session(session.get("turns", []) or []))

        log_snapshot(log, engine)

        expected = session.get("expected", {}) or {}
        failures.extend(check_tool_calls(result.tool_calls, expected, context))
        failures.extend(
            check_count_spec(
                len(engine.memories()),
                expected.get("final_memory_count", {}) or {},
                f"{context} final",
            )
        )

        traits = expected.get("answer_traits", []) or []
        if traits:
            label(log, "Answer trait checks")
        for trait in traits:
            verdict = judge_trait(str(assistant_content or ""), trait)
            log(f"- **{'PASS' if verdict.passed else 'FAIL'}** — {trait}")
            log(f"  - _reason:_ {verdict.reason}")
            if not verdict.passed:
                failures.append(
                    f"{context} answer trait '{trait}' not satisfied: {verdict.reason}"
                )

    final_state = scenario.get("final_state", {}) or {}
    final_expected = final_state.get("expected", {}) or {}
    if final_expected:
        log("")
        log("### Final state assertions")
        log_snapshot(log, engine)
        snapshot = engine.memories()
        failures.extend(
            check_count_spec(
                len(snapshot),
                final_expected.get("final_memory_count", {}) or {},
                "[final_state]",
            )
        )
        final_text = " ".join(m.content for m in snapshot)
        failures.extend(
            check_content_patterns(
                final_text,
                final_expected.get("final_memories", {}) or {},
                "[final_state] memories",
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
