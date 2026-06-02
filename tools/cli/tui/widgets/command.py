from __future__ import annotations

from typing import Any, Awaitable, Callable, ClassVar, cast

from textual.binding import Binding
from textual.containers import Vertical
from textual.widgets import Input, Static

from cli.tui.commands import Command


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
        complete = cast(
            Callable[[], Awaitable[bool]] | None,
            getattr(self.app, "complete_partial_command", None),
        )
        if complete is not None and await complete():
            return
        await super().action_submit()

    async def action_complete_command(self) -> None:
        complete = cast(
            Callable[[], Awaitable[None]] | None,
            getattr(self.app, "complete_selected_command", None),
        )
        if complete is not None:
            await complete()

    def action_previous_command(self) -> None:
        select = cast(
            Callable[[], Any] | None,
            getattr(self.app, "select_previous_command", None),
        )
        if select is not None:
            select()

    def action_next_command(self) -> None:
        select = cast(
            Callable[[], Any] | None,
            getattr(self.app, "select_next_command", None),
        )
        if select is not None:
            select()
