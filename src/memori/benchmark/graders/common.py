from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, cast

from memori.benchmark.report import Status
from memori.domain.memory import Memory, Scope
from memori.llm.tools import ToolCall


@dataclass
class ScenarioResult:
    scenario_id: str
    scenario_type: str
    status: Status
    messages: list[str] = field(default_factory=list)


def memory_from_dict(raw: dict[str, Any]) -> Memory:
    return Memory(
        id=raw["id"],
        content=raw["content"],
        scope=cast(Scope, raw.get("scope", "topical")),
    )


def call_matches(actual: ToolCall, expected: dict[str, Any]) -> bool:
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


def check_tool_calls(
    actual: list[ToolCall],
    expected: dict[str, Any],
    context: str = "",
) -> list[str]:
    prefix = f"{context} " if context else ""
    failures: list[str] = []
    for ec in expected.get("tool_calls", []) or []:
        if not any(call_matches(ac, ec) for ac in actual):
            failures.append(
                f"{prefix}expected tool call {ec!r} not satisfied "
                f"(actual={[(c.name, c.arguments) for c in actual]})"
            )
    for fc in expected.get("forbidden_tool_calls", []) or []:
        offenders = [(c.name, c.arguments) for c in actual if call_matches(c, fc)]
        if offenders:
            failures.append(f"{prefix}forbidden tool call {fc!r} matched {offenders}")
    return failures


def check_count_spec(count: int, spec: dict[str, Any], context: str = "") -> list[str]:
    prefix = f"{context} " if context else ""
    failures: list[str] = []
    if "min" in spec and count < spec["min"]:
        failures.append(f"{prefix}memory count {count} below min {spec['min']}")
    if "max" in spec and count > spec["max"]:
        failures.append(f"{prefix}memory count {count} above max {spec['max']}")
    return failures


def check_content_patterns(
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
