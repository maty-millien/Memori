from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.openai import OpenAIProvider

from memori.infra.env import require
from memori.llm.prompts import SYSTEM_PROMPT
from memori.llm.tools import Deps, register


def _build_model() -> OpenAIChatModel:
    return OpenAIChatModel(
        require("MEMORI_LLM_MODEL"),
        provider=OpenAIProvider(
            base_url="https://openrouter.ai/api/v1",
            api_key=require("OPENROUTER_API_KEY"),
        ),
    )


def model_settings() -> OpenAIChatModelSettings:
    return OpenAIChatModelSettings(
        extra_body={"reasoning": {"effort": require("MEMORI_REASONING_EFFORT")}},
    )


def build_agent() -> Agent[Deps, str]:
    agent: Agent[Deps, str] = Agent(
        _build_model(),
        deps_type=Deps,
        system_prompt=SYSTEM_PROMPT,
    )
    register(agent)
    return agent


def extract_text(messages: list[ModelMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, ModelResponse):
            chunks = [p.content for p in msg.parts if isinstance(p, TextPart)]
            if chunks:
                return "".join(chunks)
    return ""
