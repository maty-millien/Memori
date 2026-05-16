from __future__ import annotations

import re
from typing import Annotated, Any, Literal, Union

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    model_validator,
)
from pydantic_core import ErrorDetails


ToolName = Literal["memory.write", "memory.update", "memory.delete"]


def _compile_regex(value: str) -> str:
    try:
        re.compile(value)
    except re.error as error:
        raise ValueError(f"invalid regex: {error}") from None
    return value


Regex = Annotated[str, AfterValidator(_compile_regex)]


class _Base(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")


class Memory(_Base):
    id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    content: str = Field(min_length=1)


def _unique_memory_ids(memories: list[Memory]) -> list[Memory]:
    seen: set[str] = set()
    for memory in memories:
        if memory.id in seen:
            raise ValueError(f"duplicate memory id '{memory.id}'")
        seen.add(memory.id)
    return memories


MemoryList = Annotated[list[Memory], AfterValidator(_unique_memory_ids)]


class Turn(_Base):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class RegexPattern(_Base):
    regex: Regex
    kind: str | None = None


class InjectedMemoryIds(_Base):
    include: list[str] = []
    exclude: list[str] = []
    max_count: int | None = Field(default=None, ge=0)


class MemoryContent(_Base):
    should_match: list[RegexPattern] = []
    should_not_match: list[RegexPattern] = []


class Count(_Base):
    min: int | None = Field(default=None, ge=0)
    max: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _check_bounds(self) -> Count:
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("min cannot exceed max")
        return self


class ToolArguments(_Base):
    kind: str | None = None
    memory_id: str | None = None
    content_regex: Regex | None = None
    memory_id_regex: Regex | None = None


class ToolCall(_Base):
    name: ToolName
    arguments: ToolArguments | None = None


class RetrievalInjectionExpected(_Base):
    injected_memory_ids: InjectedMemoryIds | None = None
    injected_memory_content: MemoryContent | None = None


class RetrievalInjection(_Base):
    id: str = Field(min_length=1)
    type: Literal["retrieval_injection"]
    initial_memories: MemoryList = []
    turns: list[Turn] = Field(min_length=1)
    expected: RetrievalInjectionExpected

    @model_validator(mode="after")
    def _check_include_refs(self) -> RetrievalInjection:
        known = {m.id for m in self.initial_memories}
        injected = self.expected.injected_memory_ids
        if injected is None:
            return self
        for ref in injected.include:
            if ref not in known:
                raise ValueError(
                    f"injected_memory_ids.include references unknown memory id '{ref}'"
                )
        return self


class MemoryToolCallExpected(_Base):
    tool_calls: list[ToolCall] = []
    forbidden_tool_calls: list[ToolCall] = []
    final_memory_count: Count | None = None


class MemoryToolCall(_Base):
    id: str = Field(min_length=1)
    type: Literal["memory_tool_call"]
    initial_memories: MemoryList = []
    turns: list[Turn] = Field(min_length=1)
    expected: MemoryToolCallExpected


class ConsolidationExpected(_Base):
    final_memory_count: Count | None = None
    final_memories: MemoryContent | None = None


class SessionConsolidation(_Base):
    id: str = Field(min_length=1)
    type: Literal["session_consolidation"]
    pre_consolidation_memories: MemoryList
    expected: ConsolidationExpected


class SessionExpected(_Base):
    tool_calls: list[ToolCall] = []
    forbidden_tool_calls: list[ToolCall] = []
    final_memory_count: Count | None = None
    answer_traits: list[str] | None = None


class Session(_Base):
    id: str = Field(min_length=1)
    initial_memories: MemoryList = []
    turns: list[Turn] = Field(min_length=1)
    expected_injected_memory_ids: InjectedMemoryIds | None = None
    expected: SessionExpected


class PostSessionConsolidation(_Base):
    expected: ConsolidationExpected


class FullLoop(_Base):
    id: str = Field(min_length=1)
    type: Literal["full_loop"]
    sessions: list[Session] = Field(min_length=1)
    post_session_consolidation: PostSessionConsolidation | None = None


Scenario = Annotated[
    Union[RetrievalInjection, MemoryToolCall, SessionConsolidation, FullLoop],
    Field(discriminator="type"),
]

_SCENARIOS_ADAPTER = TypeAdapter(list[Scenario])
_SCENARIO_TAGS = {
    "retrieval_injection",
    "memory_tool_call",
    "session_consolidation",
    "full_loop",
}


def validate_scenarios(scenarios: list[dict[str, Any]]) -> list[str]:
    if not scenarios:
        return ["No scenarios found."]

    errors: list[str] = []
    seen_ids: set[str] = set()
    for index, scenario in enumerate(scenarios):
        scenario_id = scenario.get("id") if isinstance(scenario, dict) else None
        if isinstance(scenario_id, str) and scenario_id in seen_ids:
            errors.append(
                f"scenarios[{index}].id duplicates scenario id '{scenario_id}'"
            )
        if isinstance(scenario_id, str):
            seen_ids.add(scenario_id)

    try:
        _SCENARIOS_ADAPTER.validate_python(scenarios)
    except ValidationError as error:
        errors.extend(_format_error(item) for item in error.errors())
    return errors


def _format_error(error: ErrorDetails) -> str:
    parts = ["scenarios"]
    for component in error["loc"]:
        if component in _SCENARIO_TAGS:
            continue
        if isinstance(component, int):
            parts.append(f"[{component}]")
        else:
            parts.append(f".{component}")
    return f"{''.join(parts)}: {error['msg']}"
