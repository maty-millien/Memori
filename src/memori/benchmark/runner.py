from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

import chromadb

from memori.benchmark.assertions import (
    check_content,
    check_memory_state,
    check_retrieved,
    check_tool_calls,
    public_tool_name,
)
from memori.benchmark.schema import MemorySpec, ScenarioSpec, SessionSpec
from memori.domain.engine import Engine
from memori.domain.memory import Memory
from memori.llm.chat import chat
from memori.llm.summarize import summarize_session


Status = Literal["passed", "failed", "error"]
ProgressFn = Callable[[str], None]


@dataclass
class SessionTrace:
    id: str
    status: Status
    elapsed_seconds: float
    failures: list[str] = field(default_factory=list)
    error: str | None = None
    user_turns: list[str] = field(default_factory=list)
    retrieved: list[dict[str, Any]] = field(default_factory=list)
    recent_conversations: list[dict[str, Any]] = field(default_factory=list)
    similar_conversations: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    answer: str = ""
    final_memories: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScenarioTrace:
    id: str
    description: str
    status: Status
    elapsed_seconds: float
    failures: list[str] = field(default_factory=list)
    error: str | None = None
    sessions: list[SessionTrace] = field(default_factory=list)
    final_memories: list[dict[str, Any]] = field(default_factory=list)


def _memory_from_spec(spec: MemorySpec) -> Memory:
    return Memory(id=spec.id, content=spec.content, scope=spec.scope)


def _memory_to_dict(memory: Memory) -> dict[str, Any]:
    return {
        "id": memory.id,
        "content": memory.content,
        "scope": memory.scope,
        "kind": memory.kind,
        "created_at": memory.created_at.isoformat(),
    }


def _usage_to_dict(usage: Any) -> dict[str, Any]:
    if hasattr(usage, "model_dump"):
        return dict(usage.model_dump())
    if hasattr(usage, "__dict__"):
        return dict(usage.__dict__)
    return {}


def _status(failures: list[str], error: str | None = None) -> Status:
    if error is not None:
        return "error"
    return "failed" if failures else "passed"


def _run_session(
    engine: Engine, session: SessionSpec, progress: ProgressFn | None = None
) -> SessionTrace:
    start = time.monotonic()
    failures: list[str] = []
    error: str | None = None

    try:
        if session.initial_memories is not None:
            if progress is not None:
                progress(f"  RESET {session.id}")
            engine.reset(
                [_memory_from_spec(memory) for memory in session.initial_memories]
            )

        user_turns = [turn.content for turn in session.turns]
        user_content = user_turns[-1]
        if progress is not None:
            progress(f"  RETRIEVE {session.id}")
        retrieved = engine.retrieve_memories(user_content)
        failures.extend(check_retrieved(retrieved, session.expected.retrieved))

        if progress is not None:
            progress(f"  CONVERSATIONS {session.id}")
        recent, similar = engine.retrieve_conversations(user_content)
        if progress is not None:
            progress(f"  CHAT {session.id}")
        result = chat(
            user_content,
            [item.memory for item in retrieved],
            recent,
            similar,
            engine=engine,
        )
        answer = str(result.assistant_message.get("content") or "")
        failures.extend(check_tool_calls(result.tool_calls, session.expected))
        failures.extend(check_content(answer, session.expected.answer, "answer"))

        if session.record_summary:
            if progress is not None:
                progress(f"  SUMMARY {session.id}")
            engine.record_summary(
                summarize_session([turn.model_dump() for turn in session.turns])
            )

        if progress is not None:
            progress(f"  ASSERT {session.id}")
        final_memories = engine.memories()
        failures.extend(check_memory_state(final_memories, session.expected))
        elapsed = time.monotonic() - start

        return SessionTrace(
            id=session.id,
            status=_status(failures),
            elapsed_seconds=elapsed,
            failures=failures,
            user_turns=user_turns,
            retrieved=[
                {
                    "id": item.memory.id,
                    "content": item.memory.content,
                    "score": item.score,
                    "reason": item.reason,
                }
                for item in retrieved
            ],
            recent_conversations=[_memory_to_dict(memory) for memory in recent],
            similar_conversations=[_memory_to_dict(memory) for memory in similar],
            tool_calls=[
                {
                    "name": public_tool_name(call.name),
                    "arguments": call.arguments,
                }
                for call in result.tool_calls
            ],
            answer=answer,
            final_memories=[_memory_to_dict(memory) for memory in final_memories],
            usage=_usage_to_dict(result.usage),
        )
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        if progress is not None:
            progress(f"  ERROR {session.id}: {error}")
        return SessionTrace(
            id=session.id,
            status="error",
            elapsed_seconds=time.monotonic() - start,
            failures=failures,
            error=error,
            user_turns=[turn.content for turn in session.turns],
            final_memories=[_memory_to_dict(memory) for memory in engine.memories()],
        )


def run_scenario(
    scenario: ScenarioSpec, progress: ProgressFn | None = None
) -> ScenarioTrace:
    start = time.monotonic()
    engine = Engine()
    failures: list[str] = []
    sessions: list[SessionTrace] = []

    for session in scenario.sessions:
        trace = _run_session(engine, session, progress)
        sessions.append(trace)
        failures.extend(f"[{session.id}] {failure}" for failure in trace.failures)
        if trace.error is not None:
            failures.append(f"[{session.id}] {trace.error}")

    final_memories = engine.memories()
    failures.extend(check_memory_state(final_memories, scenario.final_state))
    status = _status(failures)
    if any(session.status == "error" for session in sessions):
        status = "error"

    return ScenarioTrace(
        id=scenario.id,
        description=scenario.description,
        status=status,
        elapsed_seconds=time.monotonic() - start,
        failures=failures,
        sessions=sessions,
        final_memories=[_memory_to_dict(memory) for memory in final_memories],
    )


def run_suite(
    scenarios: list[ScenarioSpec], progress: ProgressFn | None = None
) -> dict[str, Any]:
    started_at = datetime.now(timezone.utc)
    start = time.monotonic()

    # Chroma's first client initialization may validate tenants; do it once before
    # running scenarios.
    chromadb.Client()
    completed_traces: list[ScenarioTrace] = []
    for scenario in scenarios:
        if progress is not None:
            progress(f"START {scenario.id}")
        trace = run_scenario(scenario, progress)
        completed_traces.append(trace)
        if progress is not None:
            progress(
                f"{trace.status.upper()} {trace.id} ({trace.elapsed_seconds:.1f}s)"
            )

    totals = {
        "passed": sum(
            1 for scenario in completed_traces if scenario.status == "passed"
        ),
        "failed": sum(
            1 for scenario in completed_traces if scenario.status == "failed"
        ),
        "error": sum(1 for scenario in completed_traces if scenario.status == "error"),
        "total": len(completed_traces),
    }
    return {
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": time.monotonic() - start,
        "concurrency": 1,
        "totals": totals,
        "scenarios": [
            {
                "id": scenario.id,
                "description": scenario.description,
                "status": scenario.status,
                "elapsed_seconds": scenario.elapsed_seconds,
                "failures": scenario.failures,
                "error": scenario.error,
                "sessions": [
                    {
                        "id": session.id,
                        "status": session.status,
                        "elapsed_seconds": session.elapsed_seconds,
                        "failures": session.failures,
                        "error": session.error,
                        "user_turns": session.user_turns,
                        "retrieved": session.retrieved,
                        "recent_conversations": session.recent_conversations,
                        "similar_conversations": session.similar_conversations,
                        "tool_calls": session.tool_calls,
                        "answer": session.answer,
                        "final_memories": session.final_memories,
                        "usage": session.usage,
                    }
                    for session in scenario.sessions
                ],
                "final_memories": scenario.final_memories,
            }
            for scenario in completed_traces
        ],
    }
