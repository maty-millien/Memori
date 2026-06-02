from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

from memori.models import Importance


IMPORTANCE_ENV: dict[Importance, str] = {
    "identity": "MEMORI_WEIGHT_IDENTITY",
    "global_preference": "MEMORI_WEIGHT_GLOBAL_PREFERENCE",
    "active_project": "MEMORI_WEIGHT_ACTIVE_PROJECT",
    "useful_fact": "MEMORI_WEIGHT_USEFUL_FACT",
    "uncertain": "MEMORI_WEIGHT_UNCERTAIN",
}


@dataclass(frozen=True)
class Settings:
    openrouter_api_key: str
    chat_model: str
    reasoning_effort: str
    embedding_model: str
    retrieval_top_k: int
    retrieval_pool_k: int
    recent_conversations: int
    similar_conversations: int
    importance_weights: dict[Importance, float]
    rank_semantic_weight: float
    rank_importance_weight: float
    rank_recency_weight: float
    rank_usage_weight: float
    rank_global_scope_boost: float

    @classmethod
    def from_env(cls) -> Settings:
        load_dotenv()
        return cls(
            openrouter_api_key=require("OPENROUTER_API_KEY"),
            chat_model=require("MEMORI_LLM_MODEL"),
            reasoning_effort=require("MEMORI_REASONING_EFFORT"),
            embedding_model=require("MEMORI_EMBEDDING_MODEL"),
            retrieval_top_k=int(require("MEMORI_RETRIEVAL_TOP_K")),
            retrieval_pool_k=int(require("MEMORI_RETRIEVAL_POOL_K")),
            recent_conversations=int(require("MEMORI_RECENT_CONVERSATIONS")),
            similar_conversations=int(require("MEMORI_SIMILAR_CONVERSATIONS")),
            importance_weights={
                importance: float(require(env_name))
                for importance, env_name in IMPORTANCE_ENV.items()
            },
            rank_semantic_weight=float(require("MEMORI_RANK_SEMANTIC_WEIGHT")),
            rank_importance_weight=float(require("MEMORI_RANK_IMPORTANCE_WEIGHT")),
            rank_recency_weight=float(require("MEMORI_RANK_RECENCY_WEIGHT")),
            rank_usage_weight=float(require("MEMORI_RANK_USAGE_WEIGHT")),
            rank_global_scope_boost=float(require("MEMORI_RANK_GLOBAL_SCOPE_BOOST")),
        )


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value
