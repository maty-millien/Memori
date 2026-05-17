from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, cast

from core.engine import Memory, MemoryEngine, Retrieved, Scope
from benchmark.judge import judge_trait
from core.llm import ToolCall, call_with_tools


Status = Literal["passed", "failed", "skipped"]
LogFn = Callable[[str], None]


def _noop(_: str) -> None:
    return None


@dataclass
class ScenarioResult:
    scenario_id: str
    scenario_type: str
    status: Status
    messages: list[str] = field(default_factory=list)


def _memory_from_dict(raw: dict[str, Any]) -> Memory:
    return Memory(
        id=raw["id"],
        content=raw["content"],
        scope=cast(Scope, raw.get("scope", "topical")),
    )


def _fence(log: LogFn, lang: str, body: str) -> None:
    log(f"```{lang}")
    for line in body.splitlines() or [""]:
        log(line)
    log("```")


def _label(log: LogFn, text: str) -> None:
    log("")
    log(f"**{text}**")
    log("")


def _yaml_memory_block(memories: list[Memory]) -> str:
    rows: list[str] = []
    for m in memories:
        rows.append(f'- id: "{m.id}"')
        rows.append(f"  content: {json.dumps(m.content, ensure_ascii=False)}")
    return "\n".join(rows)


def _log_memories(log: LogFn, label: str, memories: list[Memory]) -> None:
    _label(log, label)
    if not memories:
        log("_(none)_")
        return
    _fence(log, "yaml", _yaml_memory_block(memories))


def _log_retrieved(
    log: LogFn, items: list[Retrieved], *, with_reason: bool = True
) -> None:
    _label(log, "Retrieved")
    if not items:
        log("_(none)_")
        return
    rows: list[str] = []
    for r in items:
        rows.append(f'- id: "{r.memory.id}"')
        rows.append(f"  score: {r.score:.3f}")
        if with_reason:
            rows.append(f"  reason: {json.dumps(r.reason, ensure_ascii=False)}")
        rows.append(f"  content: {json.dumps(r.memory.content, ensure_ascii=False)}")
    _fence(log, "yaml", "\n".join(rows))


def _log_tool_calls(log: LogFn, calls: list[ToolCall]) -> None:
    _label(log, "Tool calls")
    if not calls:
        log("_(none)_")
        return
    payload = [{"name": c.name, "arguments": c.arguments} for c in calls]
    _fence(log, "json", json.dumps(payload, ensure_ascii=False, indent=2))


def _log_text(log: LogFn, label: str, text: str) -> None:
    _label(log, label)
    _fence(log, "text", text)


def _log_quote(log: LogFn, label: str, text: str, *, italic: bool = False) -> None:
    _label(log, label)
    for line in text.splitlines() or [""]:
        if not line:
            log(">")
        elif italic:
            log(f"> _{line}_")
        else:
            log(f"> {line}")


def _log_header(log: LogFn, scenario: dict[str, Any]) -> None:
    log("---")
    log("")
    log(
        f"## `{scenario.get('id', '<unknown>')}` — `{scenario.get('type', '<unknown>')}`"
    )


def _log_initial_memories(log: LogFn, memories: list[dict[str, Any]]) -> None:
    _log_memories(log, "Initial memories", [_memory_from_dict(m) for m in memories])


def _log_snapshot(log: LogFn, engine: MemoryEngine) -> None:
    _log_memories(log, "Final memory state", engine.get_all_memories())


def _log_result(log: LogFn, status: Status, failures: list[str]) -> None:
    _label(log, f"Result: {status.upper()}")
    if failures:
        for f in failures:
            log(f"- {f}")
        log("")


def grade_retrieval_injection(
    scenario: dict[str, Any], engine: MemoryEngine, log: LogFn = _noop
) -> ScenarioResult:
    _log_header(log, scenario)
    initial_raw = scenario.get("initial_memories", []) or []
    _log_initial_memories(log, initial_raw)
    engine.reset([_memory_from_dict(m) for m in initial_raw])

    user_turns = [t for t in scenario.get("turns", []) if t.get("role") == "user"]
    query = user_turns[-1]["content"] if user_turns else ""
    _log_text(log, "User turn", query)

    expected = scenario.get("expected", {}) or {}
    ids_spec = expected.get("injected_memory_ids", {}) or {}
    max_count = ids_spec.get("max_count", 10)

    retrieved = engine.retrieve_memories(query)
    retrieved_ids = [r.memory.id for r in retrieved]
    _log_retrieved(log, retrieved)

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
    _log_result(log, status, failures)
    return ScenarioResult(
        scenario_id=scenario["id"],
        scenario_type=scenario["type"],
        status=status,
        messages=failures,
    )


def _call_matches(actual: ToolCall, expected: dict[str, Any]) -> bool:
    if expected.get("name") != actual.name:
        return False
    args = expected.get("arguments") or {}
    if "memory_id" in args and args["memory_id"] != actual.arguments.get("memory_id"):
        return False
    if "memory_id_regex" in args and not re.search(
        args["memory_id_regex"], actual.arguments.get("memory_id", "")
    ):
        return False
    if "content_regex" in args and not re.search(
        args["content_regex"], actual.arguments.get("content", "")
    ):
        return False
    return True


def _apply_tool_call(call: ToolCall, engine: MemoryEngine) -> None:
    try:
        if call.name == "memory.upsert":
            engine.upsert(
                content=call.arguments.get("content", ""),
                scope=cast(Scope, call.arguments.get("scope", "topical")),
                memory_id=call.arguments.get("memory_id") or None,
            )
        elif call.name == "memory.delete":
            engine.delete(call.arguments.get("memory_id", ""))
    except (KeyError, IndexError):
        return


def _log_llm_exchange(log: LogFn, result: Any) -> Any:
    _log_text(log, "LLM user message (verbatim)", result.user_message)
    reasoning = result.assistant_message.get("reasoning")
    if reasoning:
        _log_quote(log, "LLM reasoning trace", str(reasoning), italic=True)
    _log_tool_calls(log, result.tool_calls)
    assistant_content = result.assistant_message.get("content")
    if assistant_content:
        _log_quote(log, "LLM assistant content", str(assistant_content))
    return assistant_content


def grade_memory_tool_call(
    scenario: dict[str, Any], engine: MemoryEngine, log: LogFn = _noop
) -> ScenarioResult:
    _log_header(log, scenario)
    initial_raw = scenario.get("initial_memories", []) or []
    _log_initial_memories(log, initial_raw)
    engine.reset([_memory_from_dict(m) for m in initial_raw])

    user_turns = [t for t in scenario.get("turns", []) if t.get("role") == "user"]
    if not user_turns:
        early_failures = ["scenario has no user turn"]
        _log_result(log, "failed", early_failures)
        return ScenarioResult(
            scenario_id=scenario["id"],
            scenario_type=scenario["type"],
            status="failed",
            messages=early_failures,
        )
    user_content = user_turns[-1]["content"]
    _log_text(log, "User turn", user_content)

    injected = [r.memory for r in engine.retrieve_memories(user_content)]
    _log_memories(log, "Injected memories (sent to LLM)", injected)
    recent, similar = engine.retrieve_conversations(user_content)
    _log_memories(log, "Recent conversations (sent to LLM)", recent)
    _log_memories(log, "Similar conversations (sent to LLM)", similar)

    result = call_with_tools(user_content, injected, recent, similar)
    _log_llm_exchange(log, result)

    for call in result.tool_calls:
        _apply_tool_call(call, engine)

    _log_snapshot(log, engine)

    expected = scenario.get("expected", {}) or {}
    failures = _check_tool_calls(result.tool_calls, expected)
    failures.extend(
        _check_count_spec(
            len(engine.get_all_memories()),
            expected.get("final_memory_count", {}) or {},
            "final",
        )
    )

    status: Status = "failed" if failures else "passed"
    _log_result(log, status, failures)
    return ScenarioResult(
        scenario_id=scenario["id"],
        scenario_type=scenario["type"],
        status=status,
        messages=failures,
    )


def _check_tool_calls(
    actual: list[ToolCall],
    expected: dict[str, Any],
    context: str = "",
) -> list[str]:
    prefix = f"{context} " if context else ""
    failures: list[str] = []
    for ec in expected.get("tool_calls", []) or []:
        if not any(_call_matches(ac, ec) for ac in actual):
            failures.append(
                f"{prefix}expected tool call {ec!r} not satisfied "
                f"(actual={[(c.name, c.arguments) for c in actual]})"
            )
    for fc in expected.get("forbidden_tool_calls", []) or []:
        offenders = [(c.name, c.arguments) for c in actual if _call_matches(c, fc)]
        if offenders:
            failures.append(f"{prefix}forbidden tool call {fc!r} matched {offenders}")
    return failures


def _check_count_spec(count: int, spec: dict[str, Any], context: str = "") -> list[str]:
    prefix = f"{context} " if context else ""
    failures: list[str] = []
    if "min" in spec and count < spec["min"]:
        failures.append(f"{prefix}memory count {count} below min {spec['min']}")
    if "max" in spec and count > spec["max"]:
        failures.append(f"{prefix}memory count {count} above max {spec['max']}")
    return failures


def _check_content_patterns(
    text: str, spec: dict[str, Any], context: str = ""
) -> list[str]:
    prefix = f"{context} " if context else ""
    failures: list[str] = []
    for matcher in spec.get("should_match", []) or []:
        pattern = matcher["regex"]
        if not re.search(pattern, text):
            failures.append(f"{prefix}did not match regex {pattern!r}")
    for matcher in spec.get("should_not_match", []) or []:
        pattern = matcher["regex"]
        if re.search(pattern, text):
            failures.append(f"{prefix}unexpectedly matched regex {pattern!r}")
    return failures


def grade_full_loop(
    scenario: dict[str, Any], engine: MemoryEngine, log: LogFn = _noop
) -> ScenarioResult:
    _log_header(log, scenario)
    failures: list[str] = []

    for session in scenario.get("sessions", []) or []:
        session_id = session.get("id", "<session>")
        context = f"[{session_id}]"
        log("")
        log(f"### Session · `{session_id}`")

        if "initial_memories" in session:
            initial_raw = session.get("initial_memories", []) or []
            _log_initial_memories(log, initial_raw)
            engine.reset([_memory_from_dict(m) for m in initial_raw])

        user_turns = [
            t for t in session.get("turns", []) or [] if t.get("role") == "user"
        ]
        if not user_turns:
            failures.append(f"{context} session has no user turn")
            continue
        user_content = user_turns[-1]["content"]
        _log_text(log, "User turn", user_content)

        injected_content_spec = session.get("expected_injected_content", {}) or {}

        retrieved = engine.retrieve_memories(user_content)
        _log_retrieved(log, retrieved, with_reason=False)

        retrieved_text = " ".join(r.memory.content for r in retrieved)
        failures.extend(
            _check_content_patterns(
                retrieved_text, injected_content_spec, f"{context} injected content"
            )
        )

        injected_memories = [r.memory for r in retrieved]
        recent, similar = engine.retrieve_conversations(user_content)
        _log_memories(log, "Recent conversations (sent to LLM)", recent)
        _log_memories(log, "Similar conversations (sent to LLM)", similar)
        result = call_with_tools(user_content, injected_memories, recent, similar)
        assistant_content = _log_llm_exchange(log, result)

        for call in result.tool_calls:
            _apply_tool_call(call, engine)

        engine.record_conversation_summary(session.get("turns", []) or [])

        _log_snapshot(log, engine)

        expected = session.get("expected", {}) or {}
        failures.extend(_check_tool_calls(result.tool_calls, expected, context))
        failures.extend(
            _check_count_spec(
                len(engine.get_all_memories()),
                expected.get("final_memory_count", {}) or {},
                f"{context} final",
            )
        )

        traits = expected.get("answer_traits", []) or []
        if traits:
            _label(log, "Answer trait checks")
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
        _log_snapshot(log, engine)
        snapshot = engine.get_all_memories()
        failures.extend(
            _check_count_spec(
                len(snapshot),
                final_expected.get("final_memory_count", {}) or {},
                "[final_state]",
            )
        )
        final_text = " ".join(m.content for m in snapshot)
        failures.extend(
            _check_content_patterns(
                final_text,
                final_expected.get("final_memories", {}) or {},
                "[final_state] memories",
            )
        )

    status: Status = "failed" if failures else "passed"
    _log_result(log, status, failures)
    return ScenarioResult(
        scenario_id=scenario["id"],
        scenario_type=scenario["type"],
        status=status,
        messages=failures,
    )


_GRADERS: dict[str, Callable[[dict[str, Any], MemoryEngine, LogFn], ScenarioResult]] = {
    "retrieval_injection": grade_retrieval_injection,
    "memory_tool_call": grade_memory_tool_call,
    "full_loop": grade_full_loop,
}


def grade(
    scenario: dict[str, Any], engine: MemoryEngine, log: LogFn = _noop
) -> ScenarioResult:
    scenario_type = scenario.get("type", "")
    grader = _GRADERS.get(scenario_type)
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
