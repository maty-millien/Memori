from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from dotenv import load_dotenv

from memori.domain.engine import Engine
from memori.domain.memory import Importance, Memory, Retrieved, Scope
from memori.llm.request import build_user_message
from memori.llm.summarize import summarize_session


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class MemoryTool:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class SessionTurn:
    role: str
    content: str


@dataclass(frozen=True)
class MemoryContext:
    user_message: str
    prompt: str
    retrieved: list[Retrieved]
    memories: list[Memory]
    recent_conversations: list[Memory]
    similar_conversations: list[Memory]


@dataclass
class Memori:
    _engine: Engine
    _session_turns: list[SessionTurn] = field(default_factory=list)

    @classmethod
    def from_env(cls, path: str | None = None) -> Memori:
        load_dotenv()
        return cls(Engine(path=path))

    def before_turn(self, user_message: str) -> MemoryContext:
        retrieved = self._engine.retrieve_memories(user_message)
        memories = [item.memory for item in retrieved]
        recent, similar = self._engine.retrieve_conversations(user_message)
        prompt = build_user_message(user_message, memories, recent, similar)
        return MemoryContext(
            user_message=user_message,
            prompt=prompt,
            retrieved=retrieved,
            memories=memories,
            recent_conversations=recent,
            similar_conversations=similar,
        )

    def tools(self) -> list[MemoryTool]:
        return [
            MemoryTool(
                name="memory_upsert",
                description=(
                    "Create a new durable memory or replace the content of an "
                    "existing one. Only call for stable, generalizable "
                    "information worth recalling later."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": (
                                "Memory content phrased as a third-person "
                                "statement that survives outside the current chat."
                            ),
                        },
                        "memory_id": {
                            "type": ["string", "null"],
                            "description": (
                                "Existing memory id to replace. Omit when "
                                "creating a new memory."
                            ),
                        },
                        "scope": {
                            "type": "string",
                            "enum": ["global", "topical"],
                            "default": "topical",
                        },
                        "importance": {
                            "type": "string",
                            "enum": [
                                "identity",
                                "global_preference",
                                "active_project",
                                "useful_fact",
                                "uncertain",
                            ],
                            "default": "useful_fact",
                        },
                    },
                    "required": ["content"],
                },
            ),
            MemoryTool(
                name="memory_delete",
                description=(
                    "Delete an existing memory when the user asks to forget it "
                    "or when a retrieved memory is redundant."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "memory_id": {
                            "type": "string",
                            "description": "The id of the memory to delete.",
                        },
                    },
                    "required": ["memory_id"],
                },
            ),
        ]

    def handle_tool_call(self, name: str, arguments: dict[str, Any]) -> str:
        if name == "memory_upsert":
            content = str(arguments["content"])
            memory_id = arguments.get("memory_id") or None
            scope = _scope(arguments.get("scope", "topical"))
            importance = _importance(arguments.get("importance", "useful_fact"))
            new_id, created = self._engine.upsert(
                content=content,
                scope=scope,
                importance=importance,
                memory_id=str(memory_id) if memory_id is not None else None,
            )
            verb = "created" if created else "updated"
            return f'{verb} memory with id "{new_id}"'
        if name == "memory_delete":
            memory_id = str(arguments["memory_id"])
            self._engine.delete(memory_id)
            return f'deleted memory with id "{memory_id}"'
        raise ValueError(f"unknown memory tool: {name}")

    def after_turn(
        self,
        user_message: str,
        assistant_message: str,
        tool_calls: list[Any] | None = None,
    ) -> None:
        self._session_turns.append(SessionTurn(role="user", content=user_message))
        self._session_turns.append(
            SessionTurn(role="assistant", content=assistant_message)
        )

    def end_session(self) -> str:
        if not self._session_turns:
            return ""
        summary = summarize_session(
            [
                {"role": turn.role, "content": turn.content}
                for turn in self._session_turns
            ]
        )
        self._engine.record_summary(summary)
        self._session_turns.clear()
        return summary

    def memories(self) -> list[Memory]:
        return self._engine.memories()

    def reset(self, memories: list[Memory] | None = None) -> None:
        self._engine.reset(memories or [])
        self._session_turns.clear()


def _scope(value: Any) -> Scope:
    if value in {"global", "topical"}:
        return value
    raise ValueError(f"unknown memory scope: {value}")


def _importance(value: Any) -> Importance:
    if value in {
        "identity",
        "global_preference",
        "active_project",
        "useful_fact",
        "uncertain",
    }:
        return value
    raise ValueError(f"unknown memory importance: {value}")
