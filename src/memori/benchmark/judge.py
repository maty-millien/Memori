from __future__ import annotations

from dataclasses import dataclass

from memori.infra.env import require
from memori.infra.openrouter import OpenRouterClient


_JUDGE_PROMPT = """You are a strict evaluator. Given an assistant's answer and a trait that should hold true about that answer, decide whether it holds.

Respond with strictly "yes" or "no" as the very first word of your reply, then a short reason on the same line."""


@dataclass
class JudgeVerdict:
    passed: bool
    reason: str


def judge_trait(answer: str, trait: str) -> JudgeVerdict:
    model = require("MEMORI_LLM_MODEL")
    user_message = f"ASSISTANT ANSWER:\n---\n{answer}\n---\n\nTRAIT TO VERIFY:\n{trait}"
    body = OpenRouterClient().chat_completions(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": _JUDGE_PROMPT},
                {"role": "user", "content": user_message},
            ],
        },
        timeout=120.0,
    )
    content = ""
    for choice in body.get("choices", []):
        content = choice.get("message", {}).get("content", "") or ""
    first_line = content.strip().split("\n", 1)[0].strip().lower()
    passed = first_line.startswith("yes")
    return JudgeVerdict(passed=passed, reason=content.strip())
