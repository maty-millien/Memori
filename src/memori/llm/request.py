from __future__ import annotations

from datetime import datetime

from memori.domain.memory import Memory
from memori.llm.humanize import humanize


def _format_injected(memories: list[Memory]) -> str:
    return "\n".join(
        f'- id: "{m.id}"\n  importance: {m.importance}\n  content: {m.content}'
        for m in memories
    )


def _format_conversations(memories: list[Memory]) -> str:
    return "\n".join(f"- [{humanize(m.created_at)}] {m.content}" for m in memories)


def _wrap(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def timestamped_user_content(user_content: str) -> str:
    now = datetime.now().astimezone().replace(microsecond=0)
    return "\n\n".join([_wrap("user_datetime", now.isoformat()), user_content])


def build_user_message(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None,
    similar_conversations: list[Memory] | None,
    *,
    add_timestamp: bool = True,
) -> str:
    blocks: list[str] = []
    if recent_conversations:
        blocks.append(
            _wrap("recent_conversations", _format_conversations(recent_conversations))
        )
    if similar_conversations:
        blocks.append(
            _wrap("similar_conversations", _format_conversations(similar_conversations))
        )
    if retrieved:
        blocks.append(_wrap("relevant_memories", _format_injected(retrieved)))
    timestamped_content = (
        timestamped_user_content(user_content) if add_timestamp else user_content
    )
    return (
        "\n\n".join([*blocks, timestamped_content]) if blocks else timestamped_content
    )
