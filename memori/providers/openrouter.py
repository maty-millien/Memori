from __future__ import annotations

from typing import Any

import httpx
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from memori.config import Settings


BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def _post(
        self, path: str, payload: dict[str, Any], timeout: float
    ) -> dict[str, Any]:
        response = httpx.post(
            f"{BASE_URL}{path}",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json()

    def embeddings(
        self, model: str, inputs: list[str], timeout: float = 30.0
    ) -> dict[str, Any]:
        return self._post("/embeddings", {"model": model, "input": inputs}, timeout)


def openrouter_chat_model(settings: Settings) -> OpenAIChatModel:
    return OpenAIChatModel(
        settings.chat_model,
        provider=OpenAIProvider(
            base_url=BASE_URL,
            api_key=settings.openrouter_api_key,
        ),
    )
