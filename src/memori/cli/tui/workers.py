from __future__ import annotations

from typing import Any

from pydantic_ai.messages import ModelMessage
from textual.app import App

from memori.cli.tui.widgets.turn import AssistantTurn
from memori import Memori
from memori.llm.chat import stream_chat


def run_chat(
    app: App,
    turn: AssistantTurn,
    line: str,
    memori: Memori,
    history: list[ModelMessage],
) -> None:
    context = memori.before_turn(line)

    def _on_reasoning(s: str) -> None:
        app.call_from_thread(turn.append_reasoning, s)

    def _on_content(s: str) -> None:
        app.call_from_thread(turn.append_content, s)

    def _on_tool(name: str, args: dict[str, Any]) -> None:
        app.call_from_thread(turn.append_tool, name, args)

    result = stream_chat(
        line,
        context.memories,
        context.recent_conversations,
        context.similar_conversations,
        history=history,
        memori=memori,
        on_reasoning=_on_reasoning,
        on_content=_on_content,
        on_tool=_on_tool,
    )
    history.extend(result.new_messages)
    memori.after_turn(
        line,
        str(result.assistant_message.get("content") or ""),
        result.tool_calls,
    )
    if hasattr(app, "record_turn_metrics"):
        app.call_from_thread(app.record_turn_metrics, result.usage, result.elapsed)
