from __future__ import annotations

from typing import Any

from memori.domain.memory import Memory
from memori.infra.env import require
from memori.llm.humanize import humanize
from memori.llm.prompts import SYSTEM_PROMPT
from memori.llm.tools import SCHEMAS


def _format_injected(memories: list[Memory]) -> str:
    return "\n".join(f'- id: "{m.id}"\n  content: {m.content}' for m in memories)


def _format_conversations(memories: list[Memory]) -> str:
    return "\n".join(f"- [{humanize(m.created_at)}] {m.content}" for m in memories)


def _wrap(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def build_request(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None,
    similar_conversations: list[Memory] | None,
    history: list[dict[str, Any]] | None,
) -> tuple[dict[str, Any], str]:
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
    user_message = "\n\n".join([*blocks, user_content]) if blocks else user_content

    request_body: dict[str, Any] = {
        "model": require("MEMORI_LLM_MODEL"),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            *(history or []),
            {"role": "user", "content": user_message},
        ],
        "tools": SCHEMAS,
        "reasoning": {"effort": require("MEMORI_REASONING_EFFORT")},
    }
    return request_body, user_message
