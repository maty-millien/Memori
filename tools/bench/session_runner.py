from __future__ import annotations

import time
from collections.abc import Callable

from bench.assertions import (
    check_content,
    check_memory_state,
    check_retrieved,
    check_tool_calls,
    public_tool_name,
)
from bench.models import MemorySpec, SessionSpec
from bench.traces import (
    SessionTrace,
    memory_to_dict,
    status_from_failures,
    usage_to_dict,
)
from chat.loop import chat
from memori import Memori, Memory


ProgressFn = Callable[[str], None]


def run_session(
    memori: Memori, session: SessionSpec, progress: ProgressFn | None = None
) -> SessionTrace:
    start = time.monotonic()
    failures: list[str] = []

    try:
        if session.initial_memories is not None:
            if progress is not None:
                progress(f"  RESET {session.id}")
            memori.reset(
                [_memory_from_spec(memory) for memory in session.initial_memories]
            )

        user_turns = [turn.content for turn in session.turns]
        user_content = user_turns[-1]
        if progress is not None:
            progress(f"  RETRIEVE {session.id}")
        context = memori.before_turn(user_content)
        retrieved = context.retrieved
        failures.extend(check_retrieved(retrieved, session.expected.retrieved))

        if progress is not None:
            progress(f"  CONVERSATIONS {session.id}")
        if progress is not None:
            progress(f"  CHAT {session.id}")
        result = chat(context, memori=memori)
        answer = str(result.assistant_message.get("content") or "")
        failures.extend(check_tool_calls(result.tool_calls, session.expected))
        failures.extend(check_content(answer, session.expected.answer, "answer"))

        if session.record_summary:
            if progress is not None:
                progress(f"  SUMMARY {session.id}")
            memori.after_turn(user_content, answer, result.tool_calls)
            recorded_summary = memori.end_session()
        else:
            recorded_summary = ""

        if progress is not None:
            progress(f"  ASSERT {session.id}")
        final_memories = memori.memories()
        failures.extend(check_memory_state(final_memories, session.expected))

        return SessionTrace(
            id=session.id,
            status=status_from_failures(failures),
            elapsed_seconds=time.monotonic() - start,
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
            recent_conversations=[
                memory_to_dict(memory) for memory in context.recent_conversations
            ],
            similar_conversations=[
                memory_to_dict(memory) for memory in context.similar_conversations
            ],
            tool_calls=[
                {
                    "name": public_tool_name(call.name),
                    "arguments": call.arguments,
                }
                for call in result.tool_calls
            ],
            answer=answer,
            recorded_summary=recorded_summary,
            final_memories=[memory_to_dict(memory) for memory in final_memories],
            usage=usage_to_dict(result.usage),
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
            final_memories=[memory_to_dict(memory) for memory in memori.memories()],
        )


def _memory_from_spec(spec: MemorySpec) -> Memory:
    return Memory(
        id=spec.id,
        content=spec.content,
        scope=spec.scope,
        importance=spec.importance,
    )
