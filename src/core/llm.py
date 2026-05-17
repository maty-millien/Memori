from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, cast

from core.engine import Memory
from core.env import require
from core.openrouter import OpenRouterClient


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMResult:
    tool_calls: list[ToolCall]
    user_message: str
    assistant_message: dict[str, Any]


_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "memory_upsert",
            "description": (
                "Create a new durable memory or replace the content of an "
                "existing one. Pass memory_id to refine an existing memory; "
                "omit it to create a new one. Only call for stable, "
                "generalizable information worth recalling later."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": (
                            "Memory content phrased as a third-person statement "
                            "that survives outside the current chat."
                        ),
                    },
                    "memory_id": {
                        "type": "string",
                        "description": (
                            "Existing memory id to replace. Omit when creating "
                            "a new memory."
                        ),
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["global", "topical"],
                        "description": (
                            "Only used when creating a new memory. Use 'global' "
                            "for preferences about response language, tone, "
                            "length, or format that apply to every reply "
                            "regardless of topic. Use 'topical' (default) for "
                            "everything else, including domain-specific "
                            "preferences."
                        ),
                    },
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_delete",
            "description": "Delete an existing memory the user asks you to forget.",
            "parameters": {
                "type": "object",
                "properties": {"memory_id": {"type": "string"}},
                "required": ["memory_id"],
            },
        },
    },
]


_TOOL_NAME_MAP = {
    "memory_upsert": "memory.upsert",
    "memory_delete": "memory.delete",
}


_SYSTEM_PROMPT = """# Role

You are a helpful, friendly AI assistant. Your job is to answer the user's questions and help with what they ask — clearly, concisely, and in a way that fits them. The answer is the product; memory is plumbing.

# Reply style

- No emojis.
- No em dashes (—) or en dashes (–) as punctuation. Use commas, periods, parentheses, or colons instead.
- No markdown formatting: no **bold**, no # headers, no code fences, no tables. Reply in plain prose.
- Bullet or numbered lists are fine when the content is genuinely list-shaped.

# Memory context

You may receive any of these blocks before the user message:

- `<relevant_memories>` — durable facts retrieved from long-term memory. Use them to inform your answer and respect the user's preferences (language, tone, length, format, anything they've told you about themselves or their work).
- `<recent_conversations>` — summaries of the 5 most recent past chats.
- `<similar_conversations>` — summaries of the 5 past chats most similar to the current message.

Each conversation entry is prefixed with a human-readable relative timestamp like `[just now]`, `[1 hour ago]`, `[yesterday]`, `[3 days ago]`, `[last week]`, or `[last month]`, so you can answer recall questions like "what did we discuss earlier?".

# Silence about the memory layer

The memory layer is invisible to the user. Never mention it in your replies — no "let me update what I've got stored", "I'll remember that", "I saved that", "noting this down", "updating my notes", or any reference to memory, storage, notes, records, or what you do or don't have on file. The only exception is when the user explicitly asks about the memory system itself. Just be the kind of assistant who remembers, silently.

# Memory tools

You have two background tools to keep long-term memory accurate:

- `memory_upsert(content, memory_id?, scope?)` — create a new memory (omit `memory_id`) or replace an existing one (pass its `memory_id`).
- `memory_delete(memory_id)` — remove a memory.

## Turn protocol

- **Reasoning is not action.** If your reasoning concludes something should be saved, updated, or deleted, you MUST emit the corresponding tool call. Describing the save in your reply does not save anything. Treat any "I should save X" / "let me remember X" thought as a binding commitment to call the tool.
- **Tool calls and replies do not share a turn.** When you decide to call a tool, emit ONLY the tool call (no user-facing content in that response). The system will run the tool and call you again with the result; produce your full reply in that follow-up turn. Never write a reply before the tool call, you will end up repeating yourself after the tool result comes back.
- You may call multiple tools in a single turn (e.g. create one memory and delete a duplicate at the same time).

## When to write

- Save durable information: stable preferences, project facts, deferred tasks, deadlines, personal identifiers like the user's name. Uncertain dates/commitments still deserve a save — preserve the uncertainty in the content ("might be Friday", "user is not sure yet").
- If a retrieved memory is contradicted or refined by the user, call `memory_upsert` with that `memory_id` to replace it. Do not create a duplicate.
- If the user asks to forget something, call `memory_delete` on the matching `memory_id`.
- Duplicate hygiene: if two or more retrieved memories state substantially the same fact, call `memory_delete` on the redundant ones and keep the most informative single version. Do this whenever you spot duplicates, even if the user's current message is unrelated.

## When NOT to write

- Never save transient state ("opened terminal", "drinking coffee"), small talk, or acknowledgements.
- If the user restates something already in the retrieved memories without contradicting or refining it, do nothing.
- If the message contains nothing durable, do nothing.

## Content shape

Memory content must be a third-person statement (e.g. "User prefers ...", not "I prefer ...").

## Scope (only when creating a new memory)

- `global` — preferences that apply to every reply regardless of topic: language ("answer in French"), tone, length, format, output style.
- `topical` — everything else, including domain-specific preferences ("prefers running in the morning", "prefers oat milk"). Default when unsure.
"""


def _format_injected(memories: list[Memory]) -> str:
    return "\n".join(f'- id: "{m.id}"\n  content: {m.content}' for m in memories)


def _humanize(ts: datetime) -> str:
    secs = int((datetime.now(timezone.utc) - ts).total_seconds())
    if secs < 60:
        return "just now"
    mins = secs // 60
    if mins < 60:
        return "1 minute ago" if mins == 1 else f"{mins} minutes ago"
    hours = mins // 60
    if hours < 24:
        return "1 hour ago" if hours == 1 else f"{hours} hours ago"
    days = hours // 24
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days} days ago"
    if days < 30:
        weeks = days // 7
        return "last week" if weeks == 1 else f"{weeks} weeks ago"
    if days < 365:
        months = days // 30
        return "last month" if months == 1 else f"{months} months ago"
    years = days // 365
    return "last year" if years == 1 else f"{years} years ago"


def _format_conversations(memories: list[Memory]) -> str:
    return "\n".join(f"- [{_humanize(m.created_at)}] {m.content}" for m in memories)


def _wrap(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


_MAX_ATTEMPTS = 3


def _build_request(
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
            {"role": "system", "content": _SYSTEM_PROMPT},
            *(history or []),
            {"role": "user", "content": user_message},
        ],
        "tools": _TOOLS,
        "reasoning": {"effort": require("MEMORI_REASONING_EFFORT")},
    }
    return request_body, user_message


def _parse_tool_call(raw_name: str, args_field: Any) -> ToolCall:
    mapped = _TOOL_NAME_MAP.get(raw_name, raw_name)
    try:
        arguments = (
            json.loads(args_field) if isinstance(args_field, str) else args_field
        )
    except json.JSONDecodeError:
        arguments = {}
    return ToolCall(name=mapped, arguments=cast(dict[str, Any], arguments or {}))


def call_with_tools(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None = None,
    similar_conversations: list[Memory] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> LLMResult:
    request_body, user_message = _build_request(
        user_content, retrieved, recent_conversations, similar_conversations, history
    )
    client = OpenRouterClient()
    calls: list[ToolCall] = []
    assistant_message: dict[str, Any] = {}
    for _ in range(_MAX_ATTEMPTS):
        calls = []
        assistant_message = {}
        body = client.chat_completions(request_body)
        for choice in body.get("choices", []):
            assistant_message = choice.get("message", {}) or {}
            for raw in assistant_message.get("tool_calls") or []:
                fn = raw.get("function", {})
                calls.append(
                    _parse_tool_call(fn.get("name", ""), fn.get("arguments", "{}"))
                )
        if (
            calls
            or assistant_message.get("content")
            or assistant_message.get("reasoning")
        ):
            break

    return LLMResult(
        tool_calls=calls,
        user_message=user_message,
        assistant_message=assistant_message,
    )


def _noop(_: str) -> None:
    return None


def _noop_apply(_: ToolCall) -> None:
    return None


_MAX_TOOL_ITERATIONS = 5


def _stream_request(
    request_body: dict[str, Any],
    on_reasoning: Callable[[str], None],
    on_content: Callable[[str], None],
    on_tool: Callable[[str], None],
) -> tuple[list[ToolCall], dict[str, Any]]:
    reasoning_buf, content_buf = "", ""
    slots: dict[int, dict[str, str]] = {}
    announced: set[int] = set()

    for chunk in OpenRouterClient().chat_completions_stream(request_body):
        for choice in chunk.get("choices", []):
            delta = choice.get("delta") or {}
            if r := delta.get("reasoning"):
                reasoning_buf += r
                on_reasoning(r)
            if c := delta.get("content"):
                content_buf += c
                on_content(c)
            for td in delta.get("tool_calls") or []:
                idx = td.get("index", 0)
                slot = slots.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if tid := td.get("id"):
                    slot["id"] = tid
                fn = td.get("function") or {}
                if n := fn.get("name"):
                    slot["name"] += n
                if a := fn.get("arguments"):
                    slot["arguments"] += a
                if idx not in announced and slot["name"] in _TOOL_NAME_MAP:
                    announced.add(idx)
                    on_tool(_TOOL_NAME_MAP[slot["name"]])

    calls = [
        _parse_tool_call(slots[i]["name"], slots[i]["arguments"]) for i in sorted(slots)
    ]
    api_tool_calls = [
        {
            "id": slots[i]["id"],
            "type": "function",
            "function": {
                "name": slots[i]["name"],
                "arguments": slots[i]["arguments"],
            },
        }
        for i in sorted(slots)
    ]
    assistant_message: dict[str, Any] = {
        "content": content_buf,
        "reasoning": reasoning_buf,
        "tool_calls": api_tool_calls,
    }
    return calls, assistant_message


def stream_with_tools(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None = None,
    similar_conversations: list[Memory] | None = None,
    history: list[dict[str, Any]] | None = None,
    apply_tool_call: Callable[[ToolCall], None] = _noop_apply,
    on_reasoning: Callable[[str], None] = _noop,
    on_content: Callable[[str], None] = _noop,
    on_tool: Callable[[str], None] = _noop,
) -> LLMResult:
    request_body, user_message = _build_request(
        user_content, retrieved, recent_conversations, similar_conversations, history
    )
    all_calls: list[ToolCall] = []
    final_content, final_reasoning = "", ""

    for _ in range(_MAX_TOOL_ITERATIONS):
        calls, assistant_message = _stream_request(
            request_body, on_reasoning, on_content, on_tool
        )
        if r := assistant_message.get("reasoning"):
            final_reasoning = r
        if c := assistant_message.get("content"):
            final_content = c
        if not calls:
            break
        all_calls.extend(calls)
        for call in calls:
            apply_tool_call(call)
        request_body["messages"].append(
            {
                "role": "assistant",
                "content": assistant_message.get("content") or "",
                "tool_calls": assistant_message["tool_calls"],
            }
        )
        for tc in assistant_message["tool_calls"]:
            request_body["messages"].append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": "ok",
                }
            )

    return LLMResult(
        tool_calls=all_calls,
        user_message=user_message,
        assistant_message={"content": final_content, "reasoning": final_reasoning},
    )


_SUMMARY_PROMPT = (
    'Return JSON of shape {"summary": "<one or two sentences>"}. Write the summary '
    "in the third person, focusing on what the user wanted and what was decided. "
    "Skip greetings and small talk."
)


def summarize_session(turns: list[dict[str, str]]) -> str:
    if not turns:
        return ""
    convo = "\n".join(f"{t.get('role', '')}: {t.get('content', '')}" for t in turns)
    body = OpenRouterClient().chat_completions(
        {
            "model": require("MEMORI_LLM_MODEL"),
            "messages": [
                {"role": "system", "content": _SUMMARY_PROMPT},
                {"role": "user", "content": convo},
            ],
            "response_format": {"type": "json_object"},
            "reasoning": {"enabled": False},
        }
    )
    content = ""
    for choice in body.get("choices", []):
        content = (choice.get("message") or {}).get("content") or ""
    try:
        return str(json.loads(content).get("summary", "")).strip()
    except json.JSONDecodeError:
        return ""
