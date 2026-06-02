from __future__ import annotations

import asyncio
from datetime import datetime

from pydantic_ai.messages import ModelMessage
from pydantic_ai.usage import RunUsage
from textual import events
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.widgets import Input, Static

from memori import Memori, Memory
from cli.tui.commands import COMMANDS, HELP_TEXT, Command
from cli.tui.styles import APP_CSS
from cli.tui.widgets.command import CommandInput, CommandSuggestions
from cli.tui.widgets.turn import AssistantTurn, SystemTurn, UserTurn
from cli.tui.workers import run_chat


DB_PATH = ".memori"


class MemoriApp(App):
    ansi_color = True
    ENABLE_COMMAND_PALETTE = False
    CSS = APP_CSS

    BINDINGS = [
        Binding("ctrl+n", "new_session", "New"),
        Binding("ctrl+l", "clear", "Clear"),
    ]

    def __init__(self) -> None:
        super().__init__()
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

    def on_click(self, _event: events.Click) -> None:
        self.query_one(Input).focus()

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
                    await self._system(_format_memory_details(m))
            return
        if line == "/help":
            await self._system(HELP_TEXT)
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
        indicator = Static("Summarizing conversation…", classes="summarize")
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


def _format_memory_details(memory: Memory) -> str:
    return "\n".join(
        [
            f"memory {memory.id}",
            f"kind: {memory.kind}",
            f"scope: {memory.scope}",
            f"importance: {memory.importance}",
            f"created_at: {memory.created_at.isoformat(timespec='seconds')}",
            f"updated_at: {memory.updated_at.isoformat(timespec='seconds')}",
            f"last_accessed_at: {_format_memory_datetime(memory.last_accessed_at)}",
            f"access_count: {memory.access_count}",
            f"content: {memory.content}",
        ]
    )


def _format_memory_datetime(value: datetime | None) -> str:
    if value is None:
        return "never"
    return value.isoformat(timespec="seconds")
