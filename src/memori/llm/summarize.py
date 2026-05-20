from __future__ import annotations

import json

from memori.infra.env import require
from memori.infra.openrouter import OpenRouterClient
from memori.llm.prompts import SUMMARY_PROMPT


def summarize_session(turns: list[dict[str, str]]) -> str:
    if not turns:
        return ""
    convo = "\n".join(f"{t.get('role', '')}: {t.get('content', '')}" for t in turns)
    body = OpenRouterClient().chat_completions(
        {
            "model": require("MEMORI_LLM_MODEL"),
            "messages": [
                {"role": "system", "content": SUMMARY_PROMPT},
                {"role": "user", "content": convo},
            ],
            "response_format": {"type": "json_object"},
            "reasoning": {"enabled": False},
        }
    )
    content = ""
    for choice in body.get("choices", []):
        content = (choice.get("message") or {}).get("content") or ""
    try:
        return str(json.loads(content).get("summary", "")).strip()
    except json.JSONDecodeError:
        return ""
