from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic_ai import Agent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    ModelMessage,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)

from memori.domain.engine import Engine
from memori.domain.memory import Memory
from memori.llm.agent import build_agent, extract_text, model_settings
from memori.llm.request import build_user_message
from memori.llm.tools import DISPLAY_NAME, Deps, ToolCall, extract_tool_calls


@dataclass
class LLMResult:
    tool_calls: list[ToolCall]
    user_message: str
    assistant_message: dict[str, Any]
    new_messages: list[ModelMessage]


def _noop(_: str) -> None:
    return None


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
) -> LLMResult:
    user_message = build_user_message(
        user_content, retrieved, recent_conversations, similar_conversations
    )
    result = _get_agent().run_sync(
        user_message,
        deps=Deps(engine=engine),
        message_history=history or [],
        model_settings=model_settings(),
    )
    new_messages = list(result.new_messages())
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
    on_tool: Callable[[str], None],
) -> tuple[list[ModelMessage], str, str]:
    agent = _get_agent()
    final_content, final_reasoning = "", ""
    new_messages: list[ModelMessage] = []

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
                            name = tool_event.part.tool_name
                            on_tool(DISPLAY_NAME.get(name, name))

        if run.result is not None:
            new_messages = list(run.result.new_messages())

    return new_messages, final_content, final_reasoning


def stream_chat(
    user_content: str,
    retrieved: list[Memory],
    recent_conversations: list[Memory] | None = None,
    similar_conversations: list[Memory] | None = None,
    history: list[ModelMessage] | None = None,
    engine: Engine | None = None,
    on_reasoning: Callable[[str], None] = _noop,
    on_content: Callable[[str], None] = _noop,
    on_tool: Callable[[str], None] = _noop,
) -> LLMResult:
    user_message = build_user_message(
        user_content, retrieved, recent_conversations, similar_conversations
    )
    new_messages, content, reasoning = asyncio.run(
        _stream_async(
            user_message,
            history or [],
            Deps(engine=engine),
            on_reasoning,
            on_content,
            on_tool,
        )
    )
    return LLMResult(
        tool_calls=extract_tool_calls(new_messages),
        user_message=user_message,
        assistant_message={"content": content, "reasoning": reasoning},
        new_messages=new_messages,
    )
