from __future__ import annotations

import math
from datetime import datetime, timezone

from memori.config import Settings
from memori.models import Memory, Retrieved


def rank_memory(memory: Memory, semantic_score: float, settings: Settings) -> Retrieved:
    importance = settings.importance_weights[memory.importance]
    recency = _recency_score(memory.updated_at)
    usage = _usage_score(memory.access_count)
    scope_boost = settings.rank_global_scope_boost if memory.scope == "global" else 0.0
    score = (
        (settings.rank_semantic_weight * semantic_score)
        + (settings.rank_importance_weight * importance)
        + (settings.rank_recency_weight * recency)
        + (settings.rank_usage_weight * usage)
        + scope_boost
    )
    reason = (
        f"semantic {semantic_score:.3f}, "
        f"importance {memory.importance}={importance:.3f}, "
        f"recency {recency:.3f}, "
        f"usage {usage:.3f}, "
        f"scope {scope_boost:.3f}"
    )
    return Retrieved(memory=memory, score=score, reason=reason)


def _recency_score(updated_at: datetime) -> float:
    age_seconds = max(0.0, (datetime.now(timezone.utc) - updated_at).total_seconds())
    age_days = age_seconds / 86_400
    return 1.0 / (1.0 + age_days / 30)


def _usage_score(access_count: int) -> float:
    if access_count <= 0:
        return 0.0
    return min(1.0, math.log1p(access_count) / math.log1p(10))
