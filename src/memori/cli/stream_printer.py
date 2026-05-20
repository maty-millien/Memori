from __future__ import annotations

from rich.console import Console, Group
from rich.live import Live
from rich.markdown import Markdown
from rich.text import Text


class StreamPrinter:
    def __init__(self, console: Console) -> None:
        self.console = console
        self.reasoning = ""
        self.content = ""
        self.tools: list[str] = []
        self.live = Live(
            self._render(),
            console=console,
            refresh_per_second=20,
            transient=False,
        )
        self.live.start()

    def _render(self) -> Group:
        parts: list = []
        for name in self.tools:
            parts.append(Text(f"· {name}", style="dim"))
        if self.reasoning:
            parts.append(Text(self.reasoning, style="dim italic"))
        if self.content:
            parts.append(Markdown(self.content))
        return Group(*parts)

    def on_reasoning(self, s: str) -> None:
        self.reasoning += s
        self.live.update(self._render())

    def on_content(self, s: str) -> None:
        self.content += s
        self.live.update(self._render())

    def on_tool(self, name: str) -> None:
        self.tools.append(name)
        self.live.update(self._render())

    def finalize(self) -> None:
        if not (self.reasoning or self.content or self.tools):
            self.console.print("[dim](empty response)[/dim]")
        self.live.stop()
