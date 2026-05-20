from __future__ import annotations

import re

from memori.benchmark.schema import (
    ContentSpec,
    CountSpec,
    ExpectedSpec,
    RetrievedSpec,
    ToolArgumentsSpec,
    ToolCallSpec,
)
from memori.domain.memory import Memory, Retrieved
from memori.llm.tools import DISPLAY_NAME, ToolCall


def public_tool_name(name: str) -> str:
    return DISPLAY_NAME.get(name, name)


def check_content(text: str, spec: ContentSpec, context: str) -> list[str]:
    failures: list[str] = []
    for matcher in spec.should_match:
        if not re.search(matcher.regex, text):
            failures.append(f"{context} did not match {matcher.regex!r}")
    for matcher in spec.should_not_match:
        if re.search(matcher.regex, text):
            failures.append(f"{context} unexpectedly matched {matcher.regex!r}")
    return failures


def check_count(count: int, spec: CountSpec, context: str) -> list[str]:
    failures: list[str] = []
    if spec.min is not None and count < spec.min:
        failures.append(f"{context} count {count} is below min {spec.min}")
    if spec.max is not None and count > spec.max:
        failures.append(f"{context} count {count} is above max {spec.max}")
    return failures


def _arg_matches(actual: ToolCall, expected: ToolArgumentsSpec) -> bool:
    args = actual.arguments
    fields = expected.model_fields_set
    if "memory_id" in fields:
        if args.get("memory_id") != expected.memory_id:
            return False
    if (
        "memory_id_regex" in fields
        and expected.memory_id_regex is not None
        and not re.search(expected.memory_id_regex, str(args.get("memory_id") or ""))
    ):
        return False
    if (
        "content_regex" in fields
        and expected.content_regex is not None
        and not re.search(expected.content_regex, str(args.get("content") or ""))
    ):
        return False
    if (
        "scope" in fields
        and expected.scope is not None
        and args.get("scope") != expected.scope
    ):
        return False
    if (
        "importance" in fields
        and expected.importance is not None
        and args.get("importance") != expected.importance
    ):
        return False
    return True


def tool_call_matches(actual: ToolCall, expected: ToolCallSpec) -> bool:
    return public_tool_name(actual.name) == expected.name and _arg_matches(
        actual, expected.arguments
    )


def check_tool_calls(actual: list[ToolCall], expected: ExpectedSpec) -> list[str]:
    failures: list[str] = []
    trace = [
        {"name": public_tool_name(c.name), "arguments": c.arguments} for c in actual
    ]
    for required in expected.tool_calls:
        if not any(tool_call_matches(call, required) for call in actual):
            failures.append(
                f"expected tool call {required.model_dump(exclude_none=True)!r} "
                f"not found in {trace!r}"
            )
    for forbidden in expected.forbidden_tool_calls:
        offenders = [
            {"name": public_tool_name(c.name), "arguments": c.arguments}
            for c in actual
            if tool_call_matches(c, forbidden)
        ]
        if offenders:
            failures.append(
                f"forbidden tool call {forbidden.model_dump(exclude_none=True)!r} "
                f"matched {offenders!r}"
            )
    return failures


def check_retrieved(actual: list[Retrieved], spec: RetrievedSpec) -> list[str]:
    failures: list[str] = []
    ids = [item.memory.id for item in actual]
    for required in spec.include_ids:
        if required not in ids:
            failures.append(f"expected retrieved memory {required!r}, got {ids!r}")
    for forbidden in spec.exclude_ids:
        if forbidden in ids:
            failures.append(f"did not expect retrieved memory {forbidden!r}")
    for rank in spec.rank_before:
        if rank.before not in ids:
            failures.append(f"expected retrieved memory {rank.before!r}, got {ids!r}")
        elif rank.after not in ids:
            failures.append(f"expected retrieved memory {rank.after!r}, got {ids!r}")
        elif ids.index(rank.before) > ids.index(rank.after):
            failures.append(
                f"expected {rank.before!r} to rank before {rank.after!r}, got {ids!r}"
            )
    if spec.max_count is not None and len(ids) > spec.max_count:
        failures.append(
            f"retrieved count {len(ids)} is above max {spec.max_count}: {ids!r}"
        )
    text = " ".join(item.memory.content for item in actual)
    failures.extend(check_content(text, spec.content, "retrieved content"))
    return failures


def check_memory_state(memories: list[Memory], expected: ExpectedSpec) -> list[str]:
    failures = check_count(len(memories), expected.final_memory_count, "final memory")
    text = " ".join(memory.content for memory in memories)
    failures.extend(check_content(text, expected.final_memories, "final memories"))
    return failures
