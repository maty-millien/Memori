from __future__ import annotations

import asyncio

from dotenv import load_dotenv
from pydantic_ai.messages import ModelMessage
from pydantic_ai.usage import RunUsage
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.suggester import SuggestFromList
from textual.widgets import Input, Static

from memori.cli.tui.widgets.turn import AssistantTurn, SystemTurn, UserTurn
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
    .user-turn {
        color: ansi_bright_cyan;
        text-style: bold;
        padding-top: 1;
        background: ansi_default;
    }
    .system-turn {
        color: ansi_bright_green;
        text-style: italic;
        padding-top: 1;
        background: ansi_default;
    }
    .reasoning {
        color: ansi_bright_black;
        text-opacity: 70%;
        text-style: italic;
        background: ansi_default;
        border-left: outer ansi_bright_black;
        padding: 0 0 0 1;
        margin: 0;
    }
    .tool-call {
        color: ansi_bright_yellow;
        background: ansi_default;
        border-left: outer ansi_yellow;
        padding: 0 0 0 1;
        margin: 1 0;
    }
    .summarize {
        color: ansi_bright_magenta;
        background: ansi_default;
        border-left: outer ansi_magenta;
        padding: 0 0 0 1;
        margin: 0;
    }
    .assistant-turn {
        padding-bottom: 1;
        margin-top: 1;
        height: auto;
        background: ansi_default;
    }
    Markdown {
        background: ansi_default;
        color: ansi_default;
        margin: 1 0 0 0;
        padding: 0 0 0 1;
        border-left: outer ansi_bright_blue;
    }
    Markdown > * { background: ansi_default; margin: 0; padding: 0; }
    MarkdownParagraph { margin: 0; padding: 0; }
    MarkdownFence, MarkdownCode { background: ansi_default; color: ansi_bright_magenta; }
    MarkdownH1, MarkdownH2, MarkdownH3 { color: ansi_bright_blue; text-style: bold; }
    #input-area {
        dock: bottom;
        height: auto;
        background: ansi_default;
    }
    Input {
        background: ansi_default;
        color: ansi_default;
        border: round ansi_bright_black;
        padding: 0 1;
        margin: 0 1 0 1;
    }
    Input:focus { border: round ansi_default; }
    Input > .input--suggestion { color: ansi_bright_black; }
    #status-bar {
        height: 1;
        background: ansi_default;
        color: ansi_bright_black;
        padding: 0 2;
        margin: 0 1 1 1;
    }
    #status-bar-left { width: 1fr; height: 1; content-align: left middle; }
    #status-bar-right { width: 1fr; height: 1; content-align: right middle; }
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
        self._last_input_tokens = 0
        self._last_output_tokens = 0
        self._total_requests = 0
        self._total_tool_calls = 0
        self._turn_count = 0
        self._last_elapsed = 0.0

    def compose(self) -> ComposeResult:
        self.scroll = VerticalScroll(id="conversation")
        yield self.scroll
        self.status_left = Static("", id="status-bar-left")
        self.status_right = Static("", id="status-bar-right")
        with Vertical(id="input-area"):
            yield Input(
                placeholder="Ask Memori… (/help)",
                suggester=SuggestFromList(COMMANDS, case_sensitive=False),
            )
            with Horizontal(id="status-bar"):
                yield self.status_left
                yield self.status_right

    def on_mount(self) -> None:
        self.title = "Memori"
        self.query_one(Input).focus()
        self._render_status()

    def _render_status(self) -> None:
        total = self._last_input_tokens + self._last_output_tokens
        left = [
            f"⏎ {self._turn_count} turns",
            f"Σ {total:,} tok",
        ]
        right = [
            f"⚙ {self._total_tool_calls} tools",
            f"⇄ {self._total_requests} req",
        ]
        if self._last_elapsed:
            right.append(f"⏱ {self._last_elapsed:.1f}s")
        self.status_left.update(" · ".join(left))
        self.status_right.update(" · ".join(right))

    def record_turn_metrics(self, usage: RunUsage, elapsed: float) -> None:
        self._turn_count += 1
        self._last_input_tokens = int(usage.input_tokens or 0)
        self._last_output_tokens = int(usage.output_tokens or 0)
        self._total_requests += int(usage.requests or 0)
        self._total_tool_calls += int(usage.tool_calls or 0)
        self._last_elapsed = elapsed
        self._render_status()

    async def _say(self, text: str) -> None:
        await self.scroll.mount(UserTurn(text))

    async def _system(self, text: str) -> None:
        await self.scroll.mount(SystemTurn(text))

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        line = event.value.strip()
        event.input.value = ""
        if not line:
            return

        if line in {"/quit", "/exit"}:
            await self.action_quit()
            return
        if line == "/new":
            await self.action_new_session()
            return
        if line == "/reset":
            self.engine.reset([])
            self.turns.clear()
            await self._system("(memories cleared)")
            return
        if line == "/memories":
            mems = self.engine.memories()
            if not mems:
                await self._system("(no memories)")
            else:
                for m in mems:
                    await self._system(f"{m.id} [{m.importance}]: {m.content}")
            return
        if line == "/help":
            await self._system("commands: /new /reset /memories /quit")
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

    async def _save_session_with_indicator(self, done_text: str | None) -> None:
        if not self.turns:
            return
        indicator = Static("⚡ Summarizing conversation…", classes="summarize")
        await self.scroll.mount(indicator)
        self.scroll.scroll_end(animate=False)
        try:
            await asyncio.to_thread(self._save_session)
        finally:
            await indicator.remove()
            if done_text:
                await self._system(done_text)

    async def action_new_session(self) -> None:
        await self._save_session_with_indicator(None)
        self.scroll.remove_children()
        self._last_input_tokens = 0
        self._last_output_tokens = 0
        self._total_requests = 0
        self._total_tool_calls = 0
        self._turn_count = 0
        self._last_elapsed = 0.0
        self._render_status()

    def action_clear(self) -> None:
        self.scroll.remove_children()

    async def action_quit(self) -> None:
        if self.turns:
            await self._save_session_with_indicator(None)
        self.exit()
