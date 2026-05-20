from __future__ import annotations

from typing import Any

from dotenv import load_dotenv

from memori.cli.stream_printer import StreamPrinter
from memori.domain.engine import Engine
from memori.llm.apply import apply_tool_call
from memori.llm.chat import stream_chat
from memori.llm.summarize import summarize_session


DB_PATH = ".memori"
BANNER = "Memori — /memories, /reset, /new, Ctrl+D to quit."


def _list_memories(engine: Engine) -> None:
    mems = engine.memories()
    if not mems:
        print("(no memories)")
        return
    for m in mems:
        print(f"{m.id}: {m.content}")


def _save_session(engine: Engine, turns: list[dict[str, Any]]) -> None:
    if turns:
        engine.record_summary(summarize_session(turns))
        turns.clear()


def _chat(line: str, engine: Engine, turns: list[dict[str, Any]]) -> None:
    retrieved = [r.memory for r in engine.retrieve_memories(line)]
    recent, similar = engine.retrieve_conversations(line)
    printer = StreamPrinter()

    result = stream_chat(
        line,
        retrieved,
        recent,
        similar,
        history=turns,
        apply_tool_call=lambda c: apply_tool_call(c, engine),
        on_reasoning=printer.on_reasoning,
        on_content=printer.on_content,
        on_tool=printer.on_tool,
    )
    printer.finalize()

    turns.append({"role": "user", "content": line})
    turns.append(
        {"role": "assistant", "content": result.assistant_message.get("content") or ""}
    )


def main() -> None:
    load_dotenv()
    engine = Engine(path=DB_PATH)
    turns: list[dict[str, Any]] = []
    print(BANNER)
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
