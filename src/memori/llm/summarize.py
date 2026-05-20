from __future__ import annotations

import json
import re

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.openai import OpenAIProvider

from memori.infra.env import require
from memori.llm.prompts import SUMMARY_PROMPT


_agent: Agent[None, str] | None = None


def _get_agent() -> Agent[None, str]:
    global _agent
    if _agent is None:
        model = OpenAIChatModel(
            require("MEMORI_LLM_MODEL"),
            provider=OpenAIProvider(
                base_url="https://openrouter.ai/api/v1",
                api_key=require("OPENROUTER_API_KEY"),
            ),
        )
        _agent = Agent(model, system_prompt=SUMMARY_PROMPT)
    return _agent


def _turns_to_text(turns: list[ModelMessage]) -> str:
    lines: list[str] = []
    for msg in turns:
        if isinstance(msg, ModelRequest):
            for req_part in msg.parts:
                if isinstance(req_part, UserPromptPart) and isinstance(
                    req_part.content, str
                ):
                    lines.append(f"user: {req_part.content}")
        elif isinstance(msg, ModelResponse):
            for resp_part in msg.parts:
                if isinstance(resp_part, TextPart) and resp_part.content:
                    lines.append(f"assistant: {resp_part.content}")
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


def summarize_session(turns: list[ModelMessage] | list[dict[str, str]]) -> str:
    if not turns:
        return ""
    if isinstance(turns[0], dict):
        convo = "\n".join(
            f"{t.get('role', '')}: {t.get('content', '')}"
            for t in turns  # type: ignore[union-attr]
        )
    else:
        convo = _turns_to_text(turns)  # type: ignore[arg-type]
    if not convo:
        return ""
    result = _get_agent().run_sync(
        convo,
        model_settings=OpenAIChatModelSettings(
            extra_body={
                "response_format": {"type": "json_object"},
                "reasoning": {"enabled": False, "effort": "none"},
            },
        ),
    )
    return _summary_from_output(str(result.output))
