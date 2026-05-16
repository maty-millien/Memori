from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, cast

import httpx

from core.engine import Memory


_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


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
            "name": "memory_write",
            "description": (
                "Save a new durable memory the user wants to keep across future "
                "sessions. Only call for stable, generalizable information."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["preference", "project", "fact", "note"],
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "Memory content phrased as a third-person statement "
                            "that survives outside the current chat."
                        ),
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["global", "topical"],
                        "description": (
                            "Use 'global' for preferences about response language, "
                            "tone, length, or format that apply to every reply "
                            "regardless of topic. Use 'topical' (default) for "
                            "everything else, including domain-specific preferences."
                        ),
                    },
                },
                "required": ["kind", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_update",
            "description": (
                "Replace the content of an existing memory when the user "
                "contradicts or refines it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "memory_id": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["memory_id", "content"],
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
    "memory_write": "memory.write",
    "memory_update": "memory.update",
    "memory_delete": "memory.delete",
}


_SYSTEM_PROMPT = """You are a helpful assistant with persistent memory. The user sends messages of any kind: questions, statements, requests. You may receive relevant memories from earlier conversations under a <relevant_memories> tag.

Two responsibilities, every turn:
1. ANSWER the user. Use the retrieved memories to inform your answer. Respect any preference about language or style stored in those memories. Be concise. If the user is just sharing information (not asking a question), a brief acknowledgement is enough.
2. MAINTAIN the memory base via memory_write / memory_update / memory_delete tools when the conversation reveals durable information.

Memory maintenance rules:
- Write for stable preferences, project facts, deferred tasks, or deadlines. Uncertain dates/commitments still deserve a write — preserve the uncertainty in the content ("might be Friday", "user is not sure yet").
- Never write transient state ("opened terminal", "drinking coffee"), small talk, or acknowledgements.
- If a retrieved memory is contradicted or refined by the user, call memory_update on that memory_id; do not write a duplicate.
- If the user asks to forget something, call memory_delete on the matching memory_id.
- If the user restates information already in the retrieved memories without contradicting or refining it, do not write a new memory.
- Duplicate hygiene: if two or more retrieved memories state substantially the same fact, call memory_delete on the redundant ones and keep the most informative single version. Do this whenever you spot duplicates, even if the user's current message is unrelated.
- If the message contains nothing durable, do nothing.
- You may call multiple tools per turn (e.g. write a new fact AND delete a duplicate at the same time).
- Memory content must be a third-person statement (e.g. "User prefers ...", not "I prefer ...").

Choosing the kind:
- preference: how the user likes things ("prefers short answers", "answers in French").
- project: facts or decisions about the project the user is working on.
- fact: external real-world information, including uncertain dates, deadlines, events, and commitments ("final presentation might be on Friday").
- note: only as a fallback when none of the above fit.

Choosing the scope (for memory_write):
- global: preferences that should apply to every reply regardless of topic — language ("answer in French"), tone, length, format, output style.
- topical: everything else, including domain-specific preferences ("prefers running in the morning", "prefers oat milk"). Default if you are unsure.
"""


_JUDGE_PROMPT = """You are a strict evaluator. Given an assistant's answer and a trait that should hold true about that answer, decide whether it holds.

Respond with strictly "yes" or "no" as the very first word of your reply, then a short reason on the same line."""


def _format_injected(memories: list[Memory]) -> str:
    return "\n".join(
        f"- id: {m.id}\n  kind: {m.kind}\n  content: {m.content}" for m in memories
    )


def call_with_tools(user_content: str, retrieved: list[Memory]) -> LLMResult:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY must be set to call the LLM")
    model = os.environ.get("MEMORI_LLM_MODEL")
    if not model:
        raise RuntimeError("MEMORI_LLM_MODEL must be set to call the LLM")
    reasoning_effort = os.environ.get("MEMORI_REASONING_EFFORT")
    if not reasoning_effort:
        raise RuntimeError("MEMORI_REASONING_EFFORT must be set to call the LLM")

    if retrieved:
        user_message = (
            f"<relevant_memories>\n{_format_injected(retrieved)}\n</relevant_memories>\n\n"
            f"{user_content}"
        )
    else:
        user_message = user_content

    response = httpx.post(
        _OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            "tools": _TOOLS,
            "reasoning": {"effort": reasoning_effort},
        },
        timeout=180.0,
    )
    response.raise_for_status()
    body = response.json()

    calls: list[ToolCall] = []
    assistant_message: dict[str, Any] = {}
    for choice in body.get("choices", []):
        assistant_message = choice.get("message", {}) or {}
        for raw in assistant_message.get("tool_calls") or []:
            fn = raw.get("function", {})
            raw_name = fn.get("name", "")
            mapped = _TOOL_NAME_MAP.get(raw_name, raw_name)
            args_field = fn.get("arguments", "{}")
            try:
                arguments = (
                    json.loads(args_field)
                    if isinstance(args_field, str)
                    else args_field
                )
            except json.JSONDecodeError:
                arguments = {}
            calls.append(
                ToolCall(name=mapped, arguments=cast(dict[str, Any], arguments))
            )
    return LLMResult(
        tool_calls=calls,
        user_message=user_message,
        assistant_message=assistant_message,
    )


@dataclass
class JudgeVerdict:
    passed: bool
    reason: str


def judge_trait(answer: str, trait: str) -> JudgeVerdict:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY must be set to call the judge")
    model = os.environ.get("MEMORI_LLM_MODEL")
    if not model:
        raise RuntimeError("MEMORI_LLM_MODEL must be set to call the judge")

    user_message = f"ASSISTANT ANSWER:\n---\n{answer}\n---\n\nTRAIT TO VERIFY:\n{trait}"
    response = httpx.post(
        _OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": _JUDGE_PROMPT},
                {"role": "user", "content": user_message},
            ],
            "reasoning": {"effort": "low"},
        },
        timeout=120.0,
    )
    response.raise_for_status()
    body = response.json()
    content = ""
    for choice in body.get("choices", []):
        content = choice.get("message", {}).get("content", "") or ""
    first_line = content.strip().split("\n", 1)[0].strip().lower()
    passed = first_line.startswith("yes")
    return JudgeVerdict(passed=passed, reason=content.strip())
