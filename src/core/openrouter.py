from __future__ import annotations

from typing import Any

import httpx

from core.env import require


_BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterClient:
    def __init__(self) -> None:
        self._api_key = require("OPENROUTER_API_KEY")

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
