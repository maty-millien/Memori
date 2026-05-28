from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import ClassVar

from dotenv import load_dotenv
from pydantic_ai.messages import ModelMessage
from pydantic_ai.usage import RunUsage
from textual import events
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.widgets import Input, Static

from memori import Memori
from memori.cli.tui.widgets.turn import AssistantTurn, SystemTurn, UserTurn
from memori.cli.tui.workers import run_chat


DB_PATH = ".memori"


@dataclass(frozen=True)
class Command:
    name: str
    description: str


COMMANDS = [
    Command("/new", "start a new session"),
    Command("/clear", "start a new session"),
    Command("/reset", "clear memories"),
    Command("/memories", "list memories"),
    Command("/help", "show help"),
    Command("/quit", "exit"),
]


class CommandSuggestionRow(Static):
    def __init__(self, command: Command, selected: bool) -> None:
        super().__init__("", classes="command-suggestion-row")
        self.command = command
        self.set_class(selected, "selected")
        self._render_command()

    def set_selected(self, selected: bool) -> None:
        self.set_class(selected, "selected")

    def _render_command(self) -> None:
        self.update(f"{self.command.name:<10} {self.command.description}")


class CommandSuggestions(Vertical):
    def __init__(self) -> None:
        super().__init__(id="command-suggestions")
        self.display = False

    async def update_matches(self, matches: list[Command], selected_index: int) -> None:
        self.remove_children()
        self.display = bool(matches)
        for index, command in enumerate(matches[:5]):
            await self.mount(CommandSuggestionRow(command, index == selected_index))

    def update_selection(self, selected_index: int) -> None:
        for index, row in enumerate(self.query(CommandSuggestionRow)):
            row.set_selected(index == selected_index)


class CommandInput(Input):
    BINDINGS: ClassVar = [
        *Input.BINDINGS,
        Binding("tab", "complete_command", show=False),
        Binding("up", "previous_command", show=False),
        Binding("down", "next_command", show=False),
    ]

    async def action_submit(self) -> None:
        app = self.app
        if isinstance(app, MemoriApp) and await app.complete_partial_command():
            return
        await super().action_submit()

    async def action_complete_command(self) -> None:
        app = self.app
        if isinstance(app, MemoriApp):
            await app.complete_selected_command()

    def action_previous_command(self) -> None:
        app = self.app
        if isinstance(app, MemoriApp):
            app.select_previous_command()

    def action_next_command(self) -> None:
        app = self.app
        if isinstance(app, MemoriApp):
            app.select_next_command()


class MemoriApp(App):
    ansi_color = True
    ENABLE_COMMAND_PALETTE = False

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
    #command-suggestions {
        height: auto;
        max-height: 7;
        margin: 0 1;
        padding: 0 1;
        border: round ansi_bright_black;
        background: ansi_default;
    }
    .command-suggestion-row {
        height: 1;
        color: ansi_bright_black;
        background: ansi_default;
    }
    .command-suggestion-row.selected {
        color: ansi_default;
        background: ansi_bright_blue;
        text-style: bold;
    }
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
    ]

    def __init__(self) -> None:
        super().__init__()
        load_dotenv()
        self.memori = Memori.from_env(path=DB_PATH)
        self.turns: list[ModelMessage] = []
        self._last_input_tokens = 0
        self._last_output_tokens = 0
        self._total_requests = 0
        self._total_tool_calls = 0
        self._turn_count = 0
        self._last_elapsed = 0.0
        self._command_matches: list[Command] = []
        self._command_selected_index = 0
        self._suppress_next_command_update = False

    def compose(self) -> ComposeResult:
        self.scroll = VerticalScroll(id="conversation")
        yield self.scroll
        self.status_left = Static("", id="status-bar-left")
        self.status_right = Static("", id="status-bar-right")
        self.command_suggestions = CommandSuggestions()
        with Vertical(id="input-area"):
            yield self.command_suggestions
            yield CommandInput(placeholder="Ask Memori… (/help)")
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

    async def on_input_changed(self, event: Input.Changed) -> None:
        if self._suppress_next_command_update:
            self._suppress_next_command_update = False
            await self._hide_command_suggestions()
            return
        await self._update_command_suggestions(event.value)

    async def on_key(self, event: events.Key) -> None:
        if not self.query_one(Input).has_focus:
            return
        if event.key == "escape" and self._command_matches:
            await self._hide_command_suggestions()
            event.stop()
            return
        if event.key == "enter" and self._should_complete_on_enter():
            await self.complete_selected_command()
            event.stop()

    async def _update_command_suggestions(self, value: str) -> None:
        if not value.startswith("/") or any(char.isspace() for char in value):
            await self._hide_command_suggestions()
            return

        needle = value.casefold()
        self._command_matches = [
            command
            for command in COMMANDS
            if command.name.casefold().startswith(needle)
        ]
        if self._command_selected_index >= len(self._command_matches):
            self._command_selected_index = 0
        await self.command_suggestions.update_matches(
            self._command_matches, self._command_selected_index
        )

    def select_previous_command(self) -> None:
        self._select_command(-1)

    def select_next_command(self) -> None:
        self._select_command(1)

    def _select_command(self, delta: int) -> None:
        if not self._command_matches:
            return
        self._command_selected_index = (self._command_selected_index + delta) % len(
            self._command_matches
        )
        self.command_suggestions.update_selection(self._command_selected_index)

    async def _hide_command_suggestions(self) -> None:
        self._command_matches = []
        self._command_selected_index = 0
        await self.command_suggestions.update_matches([], 0)

    def _should_complete_on_enter(self) -> bool:
        if not self._command_matches:
            return False
        value = self.query_one(Input).value.strip()
        return all(value != command.name for command in COMMANDS)

    async def complete_partial_command(self) -> bool:
        if not self._should_complete_on_enter():
            return False
        await self.complete_selected_command()
        return True

    async def complete_selected_command(self) -> None:
        if not self._command_matches:
            return
        command = self._command_matches[self._command_selected_index]
        input_widget = self.query_one(Input)
        self._suppress_next_command_update = True
        input_widget.value = command.name
        input_widget.cursor_position = len(command.name)
        await self._hide_command_suggestions()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        line = event.value.strip()
        event.input.value = ""
        await self._hide_command_suggestions()
        if not line:
            return

        if line == "/quit":
            await self._quit_from_command()
            return
        if line in {"/new", "/clear"}:
            await self.action_new_session()
            return
        if line == "/reset":
            self.memori.reset()
            self.turns.clear()
            await self._system("(memories cleared)")
            return
        if line == "/memories":
            mems = self.memori.memories()
            if not mems:
                await self._system("(no memories)")
            else:
                for m in mems:
                    await self._system(f"{m.id} [{m.importance}]: {m.content}")
            return
        if line == "/help":
            await self._system("commands: /new /clear /reset /memories /quit")
            return

        await self._say(line)
        turn = AssistantTurn()
        await self.scroll.mount(turn)
        self.scroll.scroll_end(animate=False)

        self.run_worker(
            lambda: run_chat(self, turn, line, self.memori, self.turns),
            thread=True,
            exclusive=True,
        )

    async def _save_session_with_indicator(self, done_text: str | None) -> None:
        if not self.turns:
            return
        indicator = Static("⚡ Summarizing conversation…", classes="summarize")
        await self.scroll.mount(indicator)
        self.scroll.scroll_end(animate=False)
        try:
            try:
                await asyncio.to_thread(self.memori.end_session)
            except Exception:
                pass
        finally:
            self.turns.clear()
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

    def action_help_quit(self) -> None:
        pass

    async def action_quit(self) -> None:
        pass

    async def _quit_from_command(self) -> None:
        if self.turns:
            await self._save_session_with_indicator(None)
        self.exit()
