from __future__ import annotations

_DIM = "\033[2m"
_DIM_ITALIC = "\033[2;3m"
_RESET = "\033[0m"


class StreamPrinter:
    def __init__(self) -> None:
        self.phase: str | None = None

    def _switch(self, target: str) -> None:
        if self.phase == target:
            return
        if self.phase == "reasoning":
            print(_RESET, end="", flush=True)
        if self.phase is not None:
            print()
        if target == "reasoning":
            print(_DIM_ITALIC, end="", flush=True)
        self.phase = target

    def on_reasoning(self, s: str) -> None:
        self._switch("reasoning")
        print(s, end="", flush=True)

    def on_content(self, s: str) -> None:
        self._switch("content")
        print(s, end="", flush=True)

    def on_tool(self, name: str) -> None:
        if self.phase == "reasoning":
            print(_RESET, end="", flush=True)
        if self.phase is not None:
            print()
        print(f"{_DIM}· {name}{_RESET}", flush=True)
        self.phase = "tool"

    def finalize(self) -> None:
        if self.phase == "reasoning":
            print(_RESET)
        elif self.phase == "content":
            print()
        elif self.phase is None:
            print("(empty response)")
