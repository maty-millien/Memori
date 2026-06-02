from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from memori.config import Settings
from memori.memory_service import MemoryService
from memori.models import Memory, MemoryContext, MemoryTool
from memori.prompting import build_context_prompt, timestamped_user_content
from memori.session import SessionTranscript
from memori.summarization import summarize_session
from memori.tool_specs import handle_memory_tool, memory_tools


@dataclass
class Memori:
    _service: MemoryService
    _settings: Settings
    _session: SessionTranscript = field(default_factory=SessionTranscript)

    @classmethod
    def from_env(cls, path: str | None = None) -> Memori:
        settings = Settings.from_env()
        return cls(
            _service=MemoryService.from_settings(settings, path=path),
            _settings=settings,
        )

    def before_turn(self, user_message: str) -> MemoryContext:
        retrieved = self._service.retrieve_memories(user_message)
        memories = [item.memory for item in retrieved]
        recent, similar = self._service.retrieve_conversations(user_message)
        history_message = timestamped_user_content(user_message)
        prompt = build_context_prompt(
            history_message,
            memories,
            recent,
            similar,
            add_timestamp=False,
        )
        return MemoryContext(
            user_message=user_message,
            prompt=prompt,
            history_message=history_message,
            retrieved=retrieved,
            memories=memories,
            recent_conversations=recent,
            similar_conversations=similar,
        )

    @staticmethod
    def tools() -> list[MemoryTool]:
        return memory_tools()

    def handle_tool_call(self, name: str, arguments: dict[str, Any]) -> str:
        return handle_memory_tool(self._service, name, arguments)

    def after_turn(
        self,
        user_message: str,
        assistant_message: str,
        tool_calls: list[Any] | None = None,
    ) -> None:
        self._session.record_turn(user_message, assistant_message)

    def end_session(self) -> str:
        if self._session.is_empty():
            return ""
        summary = summarize_session(self._session.as_messages(), self._settings)
        self._service.record_summary(summary)
        self._session.clear()
        return summary

    def memories(self) -> list[Memory]:
        return self._service.memories()

    def reset(self, memories: list[Memory] | None = None) -> None:
        self._service.reset(memories or [])
        self._session.clear()
