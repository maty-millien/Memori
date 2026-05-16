from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, cast

from core.engine import Memory, MemoryEngine, MemoryKind, Scope
from core.llm import ToolCall, call_with_tools, judge_trait


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
        kind=cast(MemoryKind, raw["kind"]),
        content=raw["content"],
        scope=cast(Scope, raw.get("scope", "topical")),
    )


def _log_header(log: LogFn, scenario: dict[str, Any]) -> None:
    log("=" * 78)
    log(
        f"[{scenario.get('id', '<unknown>')}]  type={scenario.get('type', '<unknown>')}"
    )
    log("=" * 78)


def _log_initial_memories(log: LogFn, memories: list[dict[str, Any]]) -> None:
    if not memories:
        log("Initial memories: (none)")
        return
    log("Initial memories:")
    for m in memories:
        log(f"  - {m['id']} [{m['kind']}] {m['content']}")


def _log_snapshot(log: LogFn, engine: MemoryEngine) -> None:
    snap = engine.snapshot()
    if not snap:
        log("Final memory state: (empty)")
        return
    log("Final memory state:")
    for m in snap:
        log(f"  - {m.id} [{m.kind}] {m.content}")


def _log_result(log: LogFn, status: Status, failures: list[str]) -> None:
    log("")
    log(f"Result: {status.upper()}")
    for f in failures:
        log(f"  ! {f}")
    log("")


def grade_retrieval_injection(
    scenario: dict[str, Any], engine: MemoryEngine, log: LogFn = _noop
) -> ScenarioResult:
    _log_header(log, scenario)
    initial_raw = scenario.get("initial_memories", []) or []
    _log_initial_memories(log, initial_raw)
    engine.seed([_memory_from_dict(m) for m in initial_raw])

    user_turns = [t for t in scenario.get("turns", []) if t.get("role") == "user"]
    query = user_turns[-1]["content"] if user_turns else ""
    log("")
    log(f"User turn: {query}")

    expected = scenario.get("expected", {}) or {}
    ids_spec = expected.get("injected_memory_ids", {}) or {}
    max_count = ids_spec.get("max_count", 5)

    retrieved = engine.retrieve(query, top_k=max_count)
    retrieved_ids = [r.memory.id for r in retrieved]
    log("")
    log(f"Retrieved (top_k={max_count}):")
    if not retrieved:
        log("  (nothing above similarity threshold)")
    for r in retrieved:
        log(f"  - [score={r.score:.3f}] {r.memory.id}: {r.memory.content}")
        log(f"    reason: {r.reason}")

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
    if "kind" in args and args["kind"] != actual.arguments.get("kind"):
        return False
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
        if call.name == "memory.write":
            engine.write(
                call.arguments.get("content", ""),
                cast(MemoryKind, call.arguments.get("kind", "note")),
                cast(Scope, call.arguments.get("scope", "topical")),
            )
        elif call.name == "memory.update":
            engine.update(
                call.arguments.get("memory_id", ""),
                call.arguments.get("content", ""),
            )
        elif call.name == "memory.delete":
            engine.delete(call.arguments.get("memory_id", ""))
    except (KeyError, IndexError):
        return


def grade_memory_tool_call(
    scenario: dict[str, Any], engine: MemoryEngine, log: LogFn = _noop
) -> ScenarioResult:
    _log_header(log, scenario)
    initial_raw = scenario.get("initial_memories", []) or []
    _log_initial_memories(log, initial_raw)
    engine.seed([_memory_from_dict(m) for m in initial_raw])

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
    log("")
    log(f"User turn: {user_content}")

    injected = [r.memory for r in engine.retrieve(user_content, top_k=5)]
    log("")
    log("Injected memories (sent to LLM):")
    if not injected:
        log("  (none)")
    for m in injected:
        log(f"  - {m.id} [{m.kind}] {m.content}")

    result = call_with_tools(user_content, injected)
    log("")
    log("LLM user message (verbatim):")
    for line in result.user_message.splitlines():
        log(f"  | {line}")

    reasoning = result.assistant_message.get("reasoning")
    if reasoning:
        log("")
        log("LLM reasoning trace:")
        for line in str(reasoning).splitlines():
            log(f"  | {line}")

    log("")
    log("Tool calls:")
    if not result.tool_calls:
        log("  (no tool calls)")
    for call in result.tool_calls:
        log(f"  - {call.name}({json.dumps(call.arguments, ensure_ascii=False)})")

    assistant_content = result.assistant_message.get("content")
    if assistant_content:
        log("")
        log("LLM assistant content:")
        for line in str(assistant_content).splitlines():
            log(f"  | {line}")

    for call in result.tool_calls:
        _apply_tool_call(call, engine)

    log("")
    _log_snapshot(log, engine)

    failures: list[str] = []
    expected = scenario.get("expected", {}) or {}

    for ec in expected.get("tool_calls", []) or []:
        if not any(_call_matches(ac, ec) for ac in result.tool_calls):
            failures.append(
                f"expected tool call {ec!r} not satisfied "
                f"(actual={[(c.name, c.arguments) for c in result.tool_calls]})"
            )

    for fc in expected.get("forbidden_tool_calls", []) or []:
        offenders = [
            (c.name, c.arguments) for c in result.tool_calls if _call_matches(c, fc)
        ]
        if offenders:
            failures.append(f"forbidden tool call {fc!r} matched {offenders}")

    count_spec = expected.get("final_memory_count", {}) or {}
    final_count = len(engine.snapshot())
    if "min" in count_spec and final_count < count_spec["min"]:
        failures.append(
            f"final memory count {final_count} below min {count_spec['min']}"
        )
    if "max" in count_spec and final_count > count_spec["max"]:
        failures.append(
            f"final memory count {final_count} above max {count_spec['max']}"
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
    context: str,
) -> list[str]:
    failures: list[str] = []
    for ec in expected.get("tool_calls", []) or []:
        if not any(_call_matches(ac, ec) for ac in actual):
            failures.append(
                f"{context} expected tool call {ec!r} not satisfied "
                f"(actual={[(c.name, c.arguments) for c in actual]})"
            )
    for fc in expected.get("forbidden_tool_calls", []) or []:
        offenders = [(c.name, c.arguments) for c in actual if _call_matches(c, fc)]
        if offenders:
            failures.append(f"{context} forbidden tool call {fc!r} matched {offenders}")
    return failures


def _check_count_spec(count: int, spec: dict[str, Any], context: str) -> list[str]:
    failures: list[str] = []
    if "min" in spec and count < spec["min"]:
        failures.append(f"{context} memory count {count} below min {spec['min']}")
    if "max" in spec and count > spec["max"]:
        failures.append(f"{context} memory count {count} above max {spec['max']}")
    return failures


def _check_content_patterns(text: str, spec: dict[str, Any], context: str) -> list[str]:
    failures: list[str] = []
    for matcher in spec.get("should_match", []) or []:
        pattern = matcher["regex"]
        if not re.search(pattern, text):
            failures.append(f"{context} did not match regex {pattern!r}")
    for matcher in spec.get("should_not_match", []) or []:
        pattern = matcher["regex"]
        if re.search(pattern, text):
            failures.append(f"{context} unexpectedly matched regex {pattern!r}")
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
        log("-" * 78)
        log(f"Session: {session_id}")
        log("-" * 78)

        if "initial_memories" in session:
            initial_raw = session.get("initial_memories", []) or []
            _log_initial_memories(log, initial_raw)
            engine.seed([_memory_from_dict(m) for m in initial_raw])

        user_turns = [
            t for t in session.get("turns", []) or [] if t.get("role") == "user"
        ]
        if not user_turns:
            failures.append(f"{context} session has no user turn")
            continue
        user_content = user_turns[-1]["content"]
        log("")
        log(f"User turn: {user_content}")

        injected_content_spec = session.get("expected_injected_content", {}) or {}
        max_count = injected_content_spec.get("max_count", 5)

        retrieved = engine.retrieve(user_content, top_k=max_count)
        log("")
        log(f"Retrieved (top_k={max_count}):")
        if not retrieved:
            log("  (nothing above similarity threshold)")
        for r in retrieved:
            log(f"  - [score={r.score:.3f}] {r.memory.id}: {r.memory.content}")

        retrieved_text = " ".join(r.memory.content for r in retrieved)
        failures.extend(
            _check_content_patterns(
                retrieved_text, injected_content_spec, f"{context} injected content"
            )
        )

        injected_memories = [r.memory for r in retrieved]
        result = call_with_tools(user_content, injected_memories)

        log("")
        log("LLM user message (verbatim):")
        for line in result.user_message.splitlines():
            log(f"  | {line}")

        reasoning = result.assistant_message.get("reasoning")
        if reasoning:
            log("")
            log("LLM reasoning trace:")
            for line in str(reasoning).splitlines():
                log(f"  | {line}")

        log("")
        log("Tool calls:")
        if not result.tool_calls:
            log("  (no tool calls)")
        for call in result.tool_calls:
            log(f"  - {call.name}({json.dumps(call.arguments, ensure_ascii=False)})")

        assistant_content = result.assistant_message.get("content")
        if assistant_content:
            log("")
            log("LLM assistant content:")
            for line in str(assistant_content).splitlines():
                log(f"  | {line}")

        for call in result.tool_calls:
            _apply_tool_call(call, engine)

        log("")
        _log_snapshot(log, engine)

        expected = session.get("expected", {}) or {}
        failures.extend(_check_tool_calls(result.tool_calls, expected, context))
        failures.extend(
            _check_count_spec(
                len(engine.snapshot()),
                expected.get("final_memory_count", {}) or {},
                f"{context} final",
            )
        )

        traits = expected.get("answer_traits", []) or []
        if traits:
            log("")
            log("Answer trait checks:")
        for trait in traits:
            verdict = judge_trait(str(assistant_content or ""), trait)
            log(f"  - {'PASS' if verdict.passed else 'FAIL'}: {trait}")
            log(f"    reason: {verdict.reason}")
            if not verdict.passed:
                failures.append(
                    f"{context} answer trait '{trait}' not satisfied: {verdict.reason}"
                )

    final_state = scenario.get("final_state", {}) or {}
    final_expected = final_state.get("expected", {}) or {}
    if final_expected:
        log("")
        log("-" * 78)
        log("Final state assertions")
        log("-" * 78)
        _log_snapshot(log, engine)
        snapshot = engine.snapshot()
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
        log("=" * 78)
        log(f"[{scenario.get('id', '<unknown>')}]  type={scenario_type}  SKIPPED")
        log(f"  no grader implemented for type '{scenario_type}'")
        log("")
        return ScenarioResult(
            scenario_id=scenario.get("id", "<unknown>"),
            scenario_type=scenario_type,
            status="skipped",
            messages=[f"no grader implemented for type '{scenario_type}'"],
        )
    return grader(scenario, engine, log)
