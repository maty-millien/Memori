from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.reactive import reactive
from textual.widgets import Markdown, Static


class UserTurn(Static):
    def __init__(self, text: str) -> None:
        super().__init__(f"› {text}", classes="user-turn")


class AssistantTurn(Vertical):
    reasoning: reactive[str] = reactive("")
    content: reactive[str] = reactive("")

    def __init__(self) -> None:
        super().__init__(classes="assistant-turn")
        self._tools: list[str] = []

    def compose(self) -> ComposeResult:
        self.tools_view = Static("", classes="tools")
        self.reasoning_view = Static("", classes="reasoning")
        self.content_view = Markdown("")
        yield self.tools_view
        yield self.reasoning_view
        yield self.content_view

    def append_tool(self, name: str) -> None:
        self._tools.append(name)
        self.tools_view.update("\n".join(f"· {t}" for t in self._tools))

    def watch_reasoning(self, value: str) -> None:
        if hasattr(self, "reasoning_view"):
            self.reasoning_view.update(value)

    def watch_content(self, value: str) -> None:
        if hasattr(self, "content_view"):
            self.content_view.update(value)
