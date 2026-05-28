from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic_ai import Agent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    ModelMessage,
    ModelRequest,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    UserPromptPart,
)
from pydantic_ai.usage import RunUsage

from memori.domain.engine import Engine
from memori.domain.memory import Memory
from memori.client import Memori
from memori.llm.agent import build_agent, extract_text, model_settings
from memori.llm.request import build_user_message
from memori.llm.tools import DISPLAY_NAME, Deps, ToolCall, extract_tool_calls


@dataclass
class LLMResult:
    tool_calls: list[ToolCall]
    user_message: str
    assistant_message: dict[str, Any]
    new_messages: list[ModelMessage]
    usage: RunUsage = field(default_factory=RunUsage)
    elapsed: float = 0.0


def _noop(_: str) -> None:
    return None


def _strip_context_from_history(
    new_messages: list[ModelMessage], raw_user_content: str
) -> None:
    for msg in new_messages:
        if isinstance(msg, ModelRequest):
            for part in msg.parts:
                if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                    part.content = raw_user_content
                    return


_agent: Agent[Deps, str] | None = None


def _get_agent() -> Agent[Deps, str]:
    global _agent
    if _agent is None:
        _agent = build_agent()
    return _agent


def chat(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None = None,
    similar_conversations: list[Memory] | None = None,
    history: list[ModelMessage] | None = None,
    engine: Engine | None = None,
    memori: Memori | None = None,
) -> LLMResult:
    user_message = build_user_message(
        user_content, retrieved, recent_conversations, similar_conversations
    )
    result = _get_agent().run_sync(
        user_message,
        deps=Deps(engine=engine, memori=memori),
        message_history=history or [],
        model_settings=model_settings(),
    )
    new_messages = list(result.new_messages())
    _strip_context_from_history(new_messages, user_content)
    return LLMResult(
        tool_calls=extract_tool_calls(new_messages),
        user_message=user_message,
        assistant_message={"content": extract_text(new_messages), "reasoning": ""},
        new_messages=new_messages,
    )


async def _stream_async(
    user_message: str,
    history: list[ModelMessage],
    deps: Deps,
    on_reasoning: Callable[[str], None],
    on_content: Callable[[str], None],
    on_tool: Callable[[str, dict[str, Any]], None],
) -> tuple[list[ModelMessage], str, str, RunUsage]:
    agent = _get_agent()
    final_content, final_reasoning = "", ""
    new_messages: list[ModelMessage] = []
    usage = RunUsage()

    async with agent.iter(
        user_message,
        deps=deps,
        message_history=history,
        model_settings=model_settings(),
    ) as run:
        async for node in run:
            if Agent.is_model_request_node(node):
                async with node.stream(run.ctx) as request_stream:
                    async for event in request_stream:
                        if isinstance(event, PartStartEvent):
                            part = event.part
                            if isinstance(part, ThinkingPart) and part.content:
                                final_reasoning += part.content
                                on_reasoning(part.content)
                            elif isinstance(part, TextPart) and part.content:
                                final_content += part.content
                                on_content(part.content)
                        elif isinstance(event, PartDeltaEvent):
                            delta = event.delta
                            if (
                                isinstance(delta, ThinkingPartDelta)
                                and delta.content_delta
                            ):
                                final_reasoning += delta.content_delta
                                on_reasoning(delta.content_delta)
                            elif (
                                isinstance(delta, TextPartDelta) and delta.content_delta
                            ):
                                final_content += delta.content_delta
                                on_content(delta.content_delta)
            elif Agent.is_call_tools_node(node):
                async with node.stream(run.ctx) as tool_stream:
                    async for tool_event in tool_stream:
                        if isinstance(tool_event, FunctionToolCallEvent):
                            part = tool_event.part
                            name = part.tool_name
                            args = (
                                part.args_as_dict()
                                if hasattr(part, "args_as_dict")
                                else {}
                            )
                            on_tool(DISPLAY_NAME.get(name, name), args)

        if run.result is not None:
            new_messages = list(run.result.new_messages())
            try:
                usage = run.result.usage()
            except Exception:
                pass

    return new_messages, final_content, final_reasoning, usage


def stream_chat(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None = None,
    similar_conversations: list[Memory] | None = None,
    history: list[ModelMessage] | None = None,
    engine: Engine | None = None,
    memori: Memori | None = None,
    on_reasoning: Callable[[str], None] = _noop,
    on_content: Callable[[str], None] = _noop,
    on_tool: Callable[[str, dict[str, Any]], None] = lambda _n, _a: None,
) -> LLMResult:
    user_message = build_user_message(
        user_content, retrieved, recent_conversations, similar_conversations
    )
    start = time.monotonic()
    new_messages, content, reasoning, usage = asyncio.run(
        _stream_async(
            user_message,
            history or [],
            Deps(engine=engine, memori=memori),
            on_reasoning,
            on_content,
            on_tool,
        )
    )
    _strip_context_from_history(new_messages, user_content)
    return LLMResult(
        tool_calls=extract_tool_calls(new_messages),
        user_message=user_message,
        assistant_message={"content": content, "reasoning": reasoning},
        new_messages=new_messages,
        usage=usage,
        elapsed=time.monotonic() - start,
    )
