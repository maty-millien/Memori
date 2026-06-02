from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx

from memori.infra.env import require


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

    def chat_completions_stream(
        self, payload: dict[str, Any], timeout: float = 180.0
    ) -> Iterator[dict[str, Any]]:
        with httpx.stream(
            "POST",
            f"{_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={**payload, "stream": True},
            timeout=timeout,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    return
                try:
                    yield json.loads(data)
                except json.JSONDecodeError:
                    continue
