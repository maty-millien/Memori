from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.openai import OpenAIChatModelSettings

from chat.system_prompt import SYSTEM_PROMPT
from chat.tool_adapter import Deps, memory_tools
from memori.config import Settings
from memori.providers.openrouter import openrouter_chat_model


def _settings() -> Settings:
    return Settings.from_env()


def model_settings() -> OpenAIChatModelSettings:
    settings = _settings()
    return OpenAIChatModelSettings(
        extra_body={"reasoning": {"effort": settings.reasoning_effort}},
    )


def build_agent() -> Agent[Deps, str]:
    settings = _settings()
    agent: Agent[Deps, str] = Agent(
        openrouter_chat_model(settings),
        deps_type=Deps,
        system_prompt=SYSTEM_PROMPT,
        tools=memory_tools(),
    )
    return agent


def extract_text(messages: list[ModelMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, ModelResponse):
            chunks = [p.content for p in msg.parts if isinstance(p, TextPart)]
            if chunks:
                return "".join(chunks)
    return ""
