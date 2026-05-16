from __future__ import annotations

import os
from typing import Any

import httpx


_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def _post(
        self, path: str, payload: dict[str, Any], timeout: float
    ) -> dict[str, Any]:
        response = httpx.post(
            f"{_BASE_URL}{path}",
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

    def chat_completions(
        self, payload: dict[str, Any], timeout: float = 180.0
    ) -> dict[str, Any]:
        return self._post("/chat/completions", payload, timeout)


def get_client() -> OpenRouterClient:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY must be set")
    return OpenRouterClient(api_key)
