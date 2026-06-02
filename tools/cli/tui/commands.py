from __future__ import annotations

from dataclasses import dataclass


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

HELP_TEXT = "commands: /new /clear /reset /memories /quit"
