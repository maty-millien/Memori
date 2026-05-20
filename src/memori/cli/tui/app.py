from __future__ import annotations

import asyncio

from dotenv import load_dotenv
from pydantic_ai.messages import ModelMessage
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.suggester import SuggestFromList
from textual.widgets import Input

from memori.cli.tui.widgets.turn import AssistantTurn, UserTurn
from memori.cli.tui.workers import run_chat
from memori.domain.engine import Engine
from memori.llm.summarize import summarize_session


DB_PATH = ".memori"
COMMANDS = ["/new", "/reset", "/memories", "/help", "/quit"]


class MemoriApp(App):
    ansi_color = True

    CSS = """
    Screen { background: ansi_default; color: ansi_default; }
    #conversation { background: ansi_default; padding: 0 1; scrollbar-size: 0 0; }
    .user-turn { color: ansi_default; padding-top: 1; background: ansi_default; }
    .reasoning {
        color: ansi_bright_black;
        text-opacity: 70%;
        text-style: italic;
        background: ansi_default;
        border-left: outer ansi_bright_black;
        padding: 1 0 1 1;
        margin: 0 0 1 0;
    }
    .assistant-turn {
        padding-bottom: 1;
        margin-top: 1;
        height: auto;
        background: ansi_default;
    }
    Markdown { background: ansi_default; color: ansi_default; margin: 0; padding: 0 0 0 2; }
    Markdown > * { background: ansi_default; margin: 0; padding: 0; }
    MarkdownParagraph { margin: 0; padding: 0; }
    MarkdownFence, MarkdownCode { background: ansi_default; }
    Input {
        dock: bottom;
        background: ansi_default;
        color: ansi_default;
        border: round ansi_bright_black;
        padding: 0 1;
        margin: 0 1 1 1;
    }
    Input:focus { border: round ansi_default; }
    Input > .input--suggestion { color: ansi_bright_black; }
    """

    BINDINGS = [
        Binding("ctrl+n", "new_session", "New"),
        Binding("ctrl+l", "clear", "Clear"),
        Binding("ctrl+c", "quit", "Quit", priority=True, show=False),
    ]

    def __init__(self) -> None:
        super().__init__()
        load_dotenv()
        self.engine = Engine(path=DB_PATH)
        self.turns: list[ModelMessage] = []

    def compose(self) -> ComposeResult:
        self.scroll = VerticalScroll(id="conversation")
        yield self.scroll
        yield Input(
            placeholder="Ask Memori… (/help)",
            suggester=SuggestFromList(COMMANDS, case_sensitive=False),
        )

    def on_mount(self) -> None:
        self.title = "Memori"
        self.query_one(Input).focus()

    async def _say(self, text: str) -> None:
        await self.scroll.mount(UserTurn(text))

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        line = event.value.strip()
        event.input.value = ""
        if not line:
            return

        if line in {"/quit", "/exit"}:
            await self.action_quit()
            return
        if line == "/new":
            self.action_new_session()
            return
        if line == "/reset":
            self.engine.reset([])
            self.turns.clear()
            await self._say("(memories cleared)")
            return
        if line == "/memories":
            mems = self.engine.memories()
            if not mems:
                await self._say("(no memories)")
            else:
                for m in mems:
                    await self._say(f"{m.id}: {m.content}")
            return
        if line == "/help":
            await self._say("commands: /new /reset /memories /quit")
            return

        await self._say(line)
        turn = AssistantTurn()
        await self.scroll.mount(turn)
        self.scroll.scroll_end(animate=False)

        self.run_worker(
            lambda: run_chat(self, turn, line, self.engine, self.turns),
            thread=True,
            exclusive=True,
        )

    def _save_session(self) -> None:
        if not self.turns:
            return
        try:
            self.engine.record_summary(summarize_session(self.turns))
        except Exception:
            pass
        self.turns.clear()

    def action_new_session(self) -> None:
        self._save_session()
        self.scroll.remove_children()

    def action_clear(self) -> None:
        self.scroll.remove_children()

    async def action_quit(self) -> None:
        self.exit()
        try:
            await asyncio.to_thread(self._save_session)
        except Exception:
            pass
