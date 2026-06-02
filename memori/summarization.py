from __future__ import annotations

import json
import re
from typing import cast

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIChatModelSettings

from memori.config import Settings
from memori.providers.openrouter import openrouter_chat_model


SUMMARY_PROMPT = (
    'Return JSON of shape {"summary": "<one or two sentences>"}. Write the summary '
    "in the third person, focusing on what the user wanted and what was decided. "
    "Skip greetings and small talk."
)


def summarize_session(
    turns: list[ModelMessage] | list[dict[str, str]], settings: Settings
) -> str:
    if not turns:
        return ""
    conversation = _conversation_text(turns)
    if not conversation:
        return ""
    result = _get_agent(settings).run_sync(
        conversation,
        model_settings=OpenAIChatModelSettings(
            extra_body={
                "response_format": {"type": "json_object"},
                "reasoning": {"enabled": False, "effort": "none"},
            },
        ),
    )
    return _summary_from_output(str(result.output))


def _conversation_text(turns: list[ModelMessage] | list[dict[str, str]]) -> str:
    if isinstance(turns[0], dict):
        dict_turns = cast(list[dict[str, str]], turns)
        return "\n".join(
            f"{turn.get('role', '')}: {turn.get('content', '')}" for turn in dict_turns
        )
    return _model_messages_to_text(cast(list[ModelMessage], turns))


def _get_agent(settings: Settings) -> Agent[None, str]:
    return Agent(openrouter_chat_model(settings), system_prompt=SUMMARY_PROMPT)


def _model_messages_to_text(turns: list[ModelMessage]) -> str:
    lines: list[str] = []
    for message in turns:
        if isinstance(message, ModelRequest):
            for request_part in message.parts:
                if isinstance(request_part, UserPromptPart) and isinstance(
                    request_part.content, str
                ):
                    lines.append(f"user: {request_part.content}")
        elif isinstance(message, ModelResponse):
            for response_part in message.parts:
                if isinstance(response_part, TextPart) and response_part.content:
                    lines.append(f"assistant: {response_part.content}")
    return "\n".join(lines)


def _summary_from_output(output: str) -> str:
    raw = output.strip()
    if not raw:
        return ""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'"summary"\s*:\s*"(?P<summary>.*?)"', raw, re.DOTALL)
        if match:
            return match.group("summary").strip()
        return raw
    if not isinstance(parsed, dict):
        return raw
    summary = parsed.get("summary")
    return str(summary).strip() if summary else raw
