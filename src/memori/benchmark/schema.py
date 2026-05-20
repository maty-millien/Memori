from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from memori.domain.memory import Scope


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MemorySpec(StrictModel):
    id: str
    content: str
    scope: Scope = "topical"


class TurnSpec(StrictModel):
    role: Literal["user"]
    content: str


class RegexSpec(StrictModel):
    regex: str


class ContentSpec(StrictModel):
    should_match: list[RegexSpec] = Field(default_factory=list)
    should_not_match: list[RegexSpec] = Field(default_factory=list)


class RankBeforeSpec(StrictModel):
    before: str
    after: str


class CountSpec(StrictModel):
    min: int | None = None
    max: int | None = None


class RetrievedSpec(StrictModel):
    include_ids: list[str] = Field(default_factory=list)
    exclude_ids: list[str] = Field(default_factory=list)
    rank_before: list[RankBeforeSpec] = Field(default_factory=list)
    max_count: int | None = None
    content: ContentSpec = Field(default_factory=ContentSpec)


class ToolArgumentsSpec(StrictModel):
    memory_id: str | None = None
    memory_id_regex: str | None = None
    content_regex: str | None = None
    scope: Scope | None = None


class ToolCallSpec(StrictModel):
    name: Literal["memory.upsert", "memory.delete"]
    arguments: ToolArgumentsSpec = Field(default_factory=ToolArgumentsSpec)


class ExpectedSpec(StrictModel):
    retrieved: RetrievedSpec = Field(default_factory=RetrievedSpec)
    tool_calls: list[ToolCallSpec] = Field(default_factory=list)
    forbidden_tool_calls: list[ToolCallSpec] = Field(default_factory=list)
    answer: ContentSpec = Field(default_factory=ContentSpec)
    final_memory_count: CountSpec = Field(default_factory=CountSpec)
    final_memories: ContentSpec = Field(default_factory=ContentSpec)


class SessionSpec(StrictModel):
    id: str
    initial_memories: list[MemorySpec] | None = None
    turns: list[TurnSpec]
    expected: ExpectedSpec = Field(default_factory=ExpectedSpec)
    record_summary: bool = True


class ScenarioSpec(StrictModel):
    id: str
    description: str = ""
    type: Literal["memory_loop"] = "memory_loop"
    sessions: list[SessionSpec]
    final_state: ExpectedSpec = Field(default_factory=ExpectedSpec)
