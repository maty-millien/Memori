from __future__ import annotations

from datetime import datetime, timezone, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from memori.models import Memory


def build_context_prompt(
    user_content: str,
    memories: list[Memory],
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
    if memories:
        blocks.append(_wrap("relevant_memories", _format_memories(memories)))
    timestamped_content = (
        timestamped_user_content(user_content) if add_timestamp else user_content
    )
    return (
        "\n\n".join([*blocks, timestamped_content]) if blocks else timestamped_content
    )


def timestamped_user_content(user_content: str) -> str:
    now = datetime.now().astimezone().replace(microsecond=0)
    timezone_name = _local_timezone_name(now)
    metadata = f"datetime: {now.isoformat()}\ntimezone: {timezone_name}"
    return "\n\n".join([_wrap("message_metadata", metadata), user_content])


def _format_memories(memories: list[Memory]) -> str:
    return "\n".join(
        f'- id: "{memory.id}"\n'
        f"  importance: {memory.importance}\n"
        f"  content: {memory.content}"
        for memory in memories
    )


def _format_conversations(memories: list[Memory]) -> str:
    return "\n".join(
        f"- [{_format_timestamp(memory.created_at)}] {memory.content}"
        for memory in memories
    )


def _format_timestamp(value: datetime) -> str:
    local_tz, timezone_name = _local_timezone(datetime.now().astimezone())
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=timezone.utc)
    local_value = value.astimezone(local_tz)
    return (
        f"local_datetime: {local_value.isoformat(timespec='seconds')}; "
        f"timezone: {timezone_name}"
    )


def _wrap(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def _local_timezone_name(now: datetime) -> str:
    timezone_name = _local_zoneinfo_name(now)
    if timezone_name:
        return timezone_name
    return now.tzname() or str(now.tzinfo)


def _local_timezone(now: datetime) -> tuple[tzinfo, str]:
    timezone_name = _local_zoneinfo_name(now)
    if timezone_name:
        try:
            return ZoneInfo(timezone_name), timezone_name
        except ZoneInfoNotFoundError:
            pass
    if now.tzinfo is not None and now.utcoffset() is not None:
        return now.tzinfo, now.tzname() or str(now.tzinfo)
    return timezone.utc, "UTC"


def _local_zoneinfo_name(now: datetime) -> str | None:
    if now.tzinfo is not None and hasattr(now.tzinfo, "key"):
        return str(now.tzinfo.key)
    localtime = Path("/etc/localtime")
    if localtime.exists():
        zoneinfo_path = str(localtime.resolve())
        marker = "/zoneinfo/"
        if marker in zoneinfo_path:
            return zoneinfo_path.split(marker, 1)[1]
    return None


build_user_message = build_context_prompt
