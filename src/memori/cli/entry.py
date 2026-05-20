from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from prompt_toolkit import PromptSession
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.history import FileHistory
from prompt_toolkit.styles import Style
from pydantic_ai.messages import ModelMessage
from rich.console import Console

from memori.cli.stream_printer import StreamPrinter
from memori.domain.engine import Engine
from memori.llm.chat import stream_chat
from memori.llm.summarize import summarize_session


DB_PATH = ".memori"
HISTORY_PATH = Path(DB_PATH) / ".history"
COMMANDS = ["/memories", "/reset", "/new", "/help", "/quit"]
PROMPT_STYLE = Style.from_dict({"prompt": "bold cyan"})


def _list_memories(engine: Engine, console: Console) -> None:
    mems = engine.memories()
    if not mems:
        console.print("[dim](no memories)[/dim]")
        return
    for m in mems:
        console.print(f"[cyan]{m.id}[/cyan]: {m.content}")


def _save_session(engine: Engine, turns: list[ModelMessage]) -> None:
    if turns:
        engine.record_summary(summarize_session(turns))
        turns.clear()


def _chat(
    line: str,
    engine: Engine,
    turns: list[ModelMessage],
    console: Console,
) -> None:
    retrieved = [r.memory for r in engine.retrieve_memories(line)]
    recent, similar = engine.retrieve_conversations(line)
    printer = StreamPrinter(console)

    result = stream_chat(
        line,
        retrieved,
        recent,
        similar,
        history=turns,
        engine=engine,
        on_reasoning=printer.on_reasoning,
        on_content=printer.on_content,
        on_tool=printer.on_tool,
    )
    printer.finalize()

    turns.extend(result.new_messages)


def main() -> None:
    load_dotenv()
    engine = Engine(path=DB_PATH)
    console = Console()
    turns: list[ModelMessage] = []

    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    session: PromptSession[str] = PromptSession(
        history=FileHistory(str(HISTORY_PATH)),
        completer=WordCompleter(COMMANDS, ignore_case=True),
        style=PROMPT_STYLE,
        multiline=False,
    )

    console.print("[bold]Memori[/bold] — type [cyan]/help[/cyan] or Ctrl+D to quit.")

    while True:
        try:
            line = session.prompt([("class:prompt", "› ")]).strip()
        except (EOFError, KeyboardInterrupt):
            console.print()
            _save_session(engine, turns)
            return
        if not line:
            continue
        if line in {"/quit", "/exit"}:
            _save_session(engine, turns)
            return
        if line == "/help":
            console.print(f"[dim]commands: {', '.join(COMMANDS)}[/dim]")
        elif line == "/memories":
            _list_memories(engine, console)
        elif line == "/reset":
            engine.reset([])
            turns.clear()
            console.print("[dim](memories cleared)[/dim]")
        elif line == "/new":
            _save_session(engine, turns)
            console.print("[dim](new session)[/dim]")
        else:
            _chat(line, engine, turns, console)


if __name__ == "__main__":
    main()
