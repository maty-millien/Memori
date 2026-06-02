from __future__ import annotations

import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from bench.assertions import check_memory_state
from bench.models import ScenarioSpec
from bench.session_runner import ProgressFn, run_session
from bench.traces import (
    ScenarioTrace,
    SessionTrace,
    memory_to_dict,
    status_from_failures,
)
from memori import Memori


def run_scenario(
    scenario: ScenarioSpec, progress: ProgressFn | None = None
) -> ScenarioTrace:
    start = time.monotonic()
    memori = Memori.from_env()
    failures: list[str] = []
    sessions = []

    for session in scenario.sessions:
        trace = run_session(memori, session, progress)
        sessions.append(trace)
        failures.extend(f"[{session.id}] {failure}" for failure in trace.failures)
        if trace.error is not None:
            failures.append(f"[{session.id}] {trace.error}")

    final_memories = memori.memories()
    failures.extend(check_memory_state(final_memories, scenario.final_state))
    status = status_from_failures(failures)
    if any(session.status == "error" for session in sessions):
        status = "error"

    return ScenarioTrace(
        id=scenario.id,
        description=scenario.description,
        status=status,
        elapsed_seconds=time.monotonic() - start,
        failures=failures,
        sessions=sessions,
        final_memories=[memory_to_dict(memory) for memory in final_memories],
    )


def run_suite(
    scenarios: list[ScenarioSpec], progress: ProgressFn | None = None
) -> dict[str, Any]:
    started_at = datetime.now(timezone.utc)
    start = time.monotonic()

    completed_traces_by_id: dict[str, ScenarioTrace] = {}
    concurrency = max(1, len(scenarios))
    with ProcessPoolExecutor(max_workers=concurrency) as executor:
        futures = {}
        for scenario in scenarios:
            if progress is not None:
                progress(f"START {scenario.id}")
            future = executor.submit(
                _run_scenario_in_process, scenario.model_dump(exclude_unset=True)
            )
            futures[future] = scenario.id

        for future in as_completed(futures):
            scenario_id = futures[future]
            try:
                trace = future.result()
            except Exception as exc:
                message = f"{type(exc).__name__}: {exc}"
                trace = ScenarioTrace(
                    id=scenario_id,
                    description="",
                    status="error",
                    elapsed_seconds=0.0,
                    failures=[message],
                    error=message,
                )
            completed_traces_by_id[scenario_id] = trace
            if progress is not None:
                progress(
                    f"{trace.status.upper()} {trace.id} ({trace.elapsed_seconds:.1f}s)"
                )

    completed_traces = [
        completed_traces_by_id[scenario.id]
        for scenario in scenarios
        if scenario.id in completed_traces_by_id
    ]

    return {
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": time.monotonic() - start,
        "concurrency": concurrency,
        "totals": _totals(completed_traces),
        "scenarios": [_scenario_to_dict(scenario) for scenario in completed_traces],
    }


def _run_scenario_in_process(scenario_data: dict[str, Any]) -> ScenarioTrace:
    scenario = ScenarioSpec.model_validate(scenario_data)

    def progress(line: str) -> None:
        print(f"{scenario.id}: {line}", flush=True)

    return run_scenario(scenario, progress)


def _totals(scenarios: list[ScenarioTrace]) -> dict[str, int]:
    return {
        "passed": sum(1 for scenario in scenarios if scenario.status == "passed"),
        "failed": sum(1 for scenario in scenarios if scenario.status == "failed"),
        "error": sum(1 for scenario in scenarios if scenario.status == "error"),
        "total": len(scenarios),
    }


def _scenario_to_dict(scenario: ScenarioTrace) -> dict[str, Any]:
    return {
        "id": scenario.id,
        "description": scenario.description,
        "status": scenario.status,
        "elapsed_seconds": scenario.elapsed_seconds,
        "failures": scenario.failures,
        "error": scenario.error,
        "sessions": [_session_to_dict(session) for session in scenario.sessions],
        "final_memories": scenario.final_memories,
    }


def _session_to_dict(session: SessionTrace) -> dict[str, Any]:
    return {
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
        "recorded_summary": session.recorded_summary,
        "final_memories": session.final_memories,
        "usage": session.usage,
    }
