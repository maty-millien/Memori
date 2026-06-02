from __future__ import annotations

from datetime import datetime
from pathlib import Path

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


def _local_timezone_name(now: datetime) -> str:
    if now.tzinfo is not None and hasattr(now.tzinfo, "key"):
        return str(now.tzinfo.key)
    localtime = Path("/etc/localtime")
    if localtime.exists():
        zoneinfo_path = str(localtime.resolve())
        marker = "/zoneinfo/"
        if marker in zoneinfo_path:
            return zoneinfo_path.split(marker, 1)[1]
    return now.tzname() or str(now.tzinfo)


def timestamped_user_content(user_content: str) -> str:
    now = datetime.now().astimezone().replace(microsecond=0)
    timezone = _local_timezone_name(now)
    metadata = f"datetime: {now.isoformat()}\ntimezone: {timezone}"
    return "\n\n".join([_wrap("message_metadata", metadata), user_content])


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
