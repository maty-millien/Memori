from __future__ import annotations

from pydantic_ai.messages import ModelMessage
from textual.app import App

from memori.cli.tui.widgets.turn import AssistantTurn
from memori.domain.engine import Engine
from memori.llm.chat import stream_chat


def run_chat(
    app: App,
    turn: AssistantTurn,
    line: str,
    engine: Engine,
    history: list[ModelMessage],
) -> None:
    retrieved = [r.memory for r in engine.retrieve_memories(line)]
    recent, similar = engine.retrieve_conversations(line)

    def _set_reasoning(s: str) -> None:
        app.call_from_thread(setattr, turn, "reasoning", turn.reasoning + s)

    def _set_content(s: str) -> None:
        app.call_from_thread(setattr, turn, "content", turn.content + s)

    def _tool(name: str) -> None:
        app.call_from_thread(turn.append_tool, name)

    result = stream_chat(
        line,
        retrieved,
        recent,
        similar,
        history=history,
        engine=engine,
        on_reasoning=_set_reasoning,
        on_content=_set_content,
        on_tool=_tool,
    )
    history.extend(result.new_messages)
