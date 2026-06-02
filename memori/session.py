from __future__ import annotations

from dataclasses import dataclass, field

from memori.models import SessionTurn
from memori.prompting import timestamped_user_content


@dataclass
class SessionTranscript:
    _turns: list[SessionTurn] = field(default_factory=list)

    def record_turn(self, user_message: str, assistant_message: str) -> None:
        self._turns.append(
            SessionTurn(role="user", content=timestamped_user_content(user_message))
        )
        self._turns.append(SessionTurn(role="assistant", content=assistant_message))

    def is_empty(self) -> bool:
        return not self._turns

    def as_messages(self) -> list[dict[str, str]]:
        return [{"role": turn.role, "content": turn.content} for turn in self._turns]

    def clear(self) -> None:
        self._turns.clear()
