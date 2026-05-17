from __future__ import annotations

from typing import Any, cast

from dotenv import load_dotenv

from core.engine import MemoryEngine
from core.llm import ToolCall, stream_with_tools
from core.store import Scope

_DB_PATH = ".memori"
_DIM = "\033[2m"
_DIM_ITALIC = "\033[2;3m"
_RESET = "\033[0m"
_BANNER = "Memori — /memories, /reset, /new, Ctrl+D to quit."


def _apply(call: ToolCall, engine: MemoryEngine) -> None:
    if call.name == "memory.upsert":
        engine.upsert(
            content=call.arguments.get("content", ""),
            scope=cast(Scope, call.arguments.get("scope", "topical")),
            memory_id=call.arguments.get("memory_id") or None,
        )
    elif call.name == "memory.delete":
        engine.delete(call.arguments.get("memory_id", ""))


def _list_memories(engine: MemoryEngine) -> None:
    mems = engine.get_all_memories()
    if not mems:
        print("(no memories)")
        return
    for m in mems:
        print(f"{m.id}: {m.content}")


def _save_session(engine: MemoryEngine, turns: list[dict[str, Any]]) -> None:
    if turns:
        engine.record_conversation_summary(turns)
        turns.clear()


def _chat(line: str, engine: MemoryEngine, turns: list[dict[str, Any]]) -> None:
    retrieved = [r.memory for r in engine.retrieve_memories(line)]
    recent, similar = engine.retrieve_conversations(line)
    phase: dict[str, str | None] = {"v": None}

    def _switch(target: str) -> None:
        if phase["v"] == target:
            return
        if phase["v"] == "reasoning":
            print(_RESET, end="", flush=True)
        if phase["v"] is not None:
            print()
        if target == "reasoning":
            print(_DIM_ITALIC, end="", flush=True)
        phase["v"] = target

    def on_reasoning(s: str) -> None:
        _switch("reasoning")
        print(s, end="", flush=True)

    def on_content(s: str) -> None:
        _switch("content")
        print(s, end="", flush=True)

    def on_tool(name: str) -> None:
        if phase["v"] == "reasoning":
            print(_RESET, end="", flush=True)
        if phase["v"] is not None:
            print()
        print(f"{_DIM}· {name}{_RESET}", flush=True)
        phase["v"] = "tool"

    result = stream_with_tools(
        line,
        retrieved,
        recent,
        similar,
        history=turns,
        on_reasoning=on_reasoning,
        on_content=on_content,
        on_tool=on_tool,
    )

    if phase["v"] == "reasoning":
        print(_RESET)
    elif phase["v"] == "content":
        print()
    elif phase["v"] is None:
        print("(empty response)")

    for c in result.tool_calls:
        _apply(c, engine)

    turns.append({"role": "user", "content": line})
    turns.append(
        {"role": "assistant", "content": result.assistant_message.get("content") or ""}
    )


def main() -> None:
    load_dotenv()
    engine = MemoryEngine(path=_DB_PATH)
    turns: list[dict[str, Any]] = []
    print(_BANNER)
    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            _save_session(engine, turns)
            return
        if not line:
            continue
        if line == "/memories":
            _list_memories(engine)
        elif line == "/reset":
            engine.reset([])
            turns.clear()
            print("(memories cleared)")
        elif line == "/new":
            _save_session(engine, turns)
            print("(new session)")
        else:
            _chat(line, engine, turns)


if __name__ == "__main__":
    main()
