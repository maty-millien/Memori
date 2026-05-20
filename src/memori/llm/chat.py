from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from memori.domain.memory import Memory
from memori.infra.openrouter import OpenRouterClient
from memori.llm.request import build_request
from memori.llm.tools import NAME_MAP, ToolCall, parse_tool_call


@dataclass
class LLMResult:
    tool_calls: list[ToolCall]
    user_message: str
    assistant_message: dict[str, Any]


_MAX_ATTEMPTS = 3
_MAX_TOOL_ITERATIONS = 5


def _noop(_: str) -> None:
    return None


def _noop_apply(_: ToolCall) -> None:
    return None


def chat(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None = None,
    similar_conversations: list[Memory] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> LLMResult:
    request_body, user_message = build_request(
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
                    parse_tool_call(fn.get("name", ""), fn.get("arguments", "{}"))
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
                if idx not in announced and slot["name"] in NAME_MAP:
                    announced.add(idx)
                    on_tool(NAME_MAP[slot["name"]])

    calls = [
        parse_tool_call(slots[i]["name"], slots[i]["arguments"]) for i in sorted(slots)
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


def stream_chat(
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
    request_body, user_message = build_request(
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
