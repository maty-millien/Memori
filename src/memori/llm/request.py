from __future__ import annotations

from memori.domain.memory import Memory
from memori.llm.humanize import humanize


def _format_injected(memories: list[Memory]) -> str:
    return "\n".join(f'- id: "{m.id}"\n  content: {m.content}' for m in memories)


def _format_conversations(memories: list[Memory]) -> str:
    return "\n".join(f"- [{humanize(m.created_at)}] {m.content}" for m in memories)


def _wrap(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def build_user_message(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None,
    similar_conversations: list[Memory] | None,
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
    return "\n\n".join([*blocks, user_content]) if blocks else user_content
