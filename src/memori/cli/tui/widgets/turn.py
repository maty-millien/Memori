from __future__ import annotations

from typing import Any

from textual.containers import Vertical
from textual.widgets import Markdown, Static


class UserTurn(Static):
    def __init__(self, text: str) -> None:
        super().__init__(f"› {text}", classes="user-turn")


class SystemTurn(Static):
    def __init__(self, text: str) -> None:
        super().__init__(f"• {text}", classes="system-turn")


class AssistantTurn(Vertical):
    def __init__(self) -> None:
        super().__init__(classes="assistant-turn")
        self._last_kind: str | None = None
        self._reasoning_widget: Static | None = None
        self._content_widget: Markdown | None = None
        self._reasoning_buf = ""
        self._content_buf = ""

    def _ensure_reasoning(self) -> None:
        if self._reasoning_widget is None or self._last_kind != "reasoning":
            self._reasoning_buf = ""
            self._reasoning_widget = Static("", classes="reasoning")
            self.mount(self._reasoning_widget)
        self._last_kind = "reasoning"

    def append_reasoning(self, s: str) -> None:
        self._ensure_reasoning()
        self._reasoning_buf += s
        assert self._reasoning_widget is not None
        self._reasoning_widget.update(self._reasoning_buf.strip())
        self._scroll_end()

    def append_content(self, s: str) -> None:
        if self._last_kind != "content":
            self._content_buf = ""
            self._content_widget = Markdown("")
            self.mount(self._content_widget)
            self._last_kind = "content"
        self._content_buf += s
        assert self._content_widget is not None
        self._content_widget.update(self._content_buf)
        self._scroll_end()

    def append_tool(self, name: str, args: dict[str, Any]) -> None:
        self.mount(Static(f"⚡ {_format_tool_inner(name, args)}", classes="tool-call"))
        self._last_kind = "tool"
        self._reasoning_widget = None
        self._scroll_end()

    def _scroll_end(self) -> None:
        parent = self.parent
        if parent is not None and hasattr(parent, "scroll_end"):
            parent.scroll_end(animate=False)


def _format_tool_inner(name: str, args: dict[str, Any]) -> str:
    if not args:
        return name
    items = list(args.items())
    primary_key, primary_value = items[0]
    head = f"{name} {_format_value(primary_value)}"
    rest = items[1:]
    if not rest:
        return head
    tail = ", ".join(f"{key} {_format_value(value)}" for key, value in rest)
    return f"{head}  ({tail})"


def _format_value(value: Any) -> str:
    if isinstance(value, str):
        text = value.replace("\n", " ")
        if len(text) > 80:
            text = text[:77] + "…"
        return f'"{text}"'
    rendered = repr(value)
    if len(rendered) > 80:
        rendered = rendered[:77] + "…"
    return rendered
