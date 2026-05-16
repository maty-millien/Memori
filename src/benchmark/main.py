from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any

import yaml


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_BENCHMARK_DIR = ROOT_DIR / "benchmarks"
BENCHMARK_NAME = "Memori benchmark V2"
BENCHMARK_VERSION = "2.0"
SCENARIO_TYPES = {
    "retrieval_injection",
    "memory_tool_call",
    "session_consolidation",
    "full_loop",
}
TOOL_NAMES = {"memory.write", "memory.update", "memory.delete"}


class BenchmarkValidationError(ValueError):
    pass


def load_benchmark(benchmark_dir: Path = DEFAULT_BENCHMARK_DIR) -> dict[str, Any]:
    return {
        "name": BENCHMARK_NAME,
        "version": BENCHMARK_VERSION,
        "scenarios": load_scenarios(benchmark_dir),
    }


def load_scenarios(benchmark_dir: Path = DEFAULT_BENCHMARK_DIR) -> list[dict[str, Any]]:
    if not benchmark_dir.is_dir():
        raise BenchmarkValidationError(
            f"Benchmark directory does not exist: {benchmark_dir}"
        )

    scenarios: list[dict[str, Any]] = []
    for path in sorted(benchmark_dir.glob("*.yaml")):
        scenario = _load_yaml_object(path)
        if not isinstance(scenario, dict):
            raise BenchmarkValidationError(
                f"Scenario file must contain an object: {path}"
            )
        scenarios.append(scenario)

    return scenarios


def validate_benchmark(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    scenario_ids: set[str] = set()

    scenarios = data.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        return ["Benchmark must contain a non-empty 'scenarios' list."]

    for scenario_index, scenario in enumerate(scenarios):
        path = f"scenarios[{scenario_index}]"
        if not isinstance(scenario, dict):
            errors.append(f"{path} must be an object.")
            continue

        scenario_id = _string_field(scenario, "id", path, errors)
        if scenario_id in scenario_ids:
            errors.append(f"{path}.id duplicates scenario id '{scenario_id}'.")
        scenario_ids.add(scenario_id)

        _string_field(scenario, "title", path, errors)
        _string_list_field(scenario, "focus", path, errors)
        scenario_type = _scenario_type(scenario, path, errors)

        if scenario_type == "retrieval_injection":
            _validate_retrieval_injection(scenario, path, errors)
        elif scenario_type == "memory_tool_call":
            _validate_memory_tool_call(scenario, path, errors)
        elif scenario_type == "session_consolidation":
            _validate_session_consolidation(scenario, path, errors)
        elif scenario_type == "full_loop":
            _validate_full_loop(scenario, path, errors)

    return errors


def scenario_summary(data: dict[str, Any]) -> str:
    scenarios = data["scenarios"]
    focus_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    lines = [
        f"{data.get('name', 'Benchmark')} ({data.get('version', 'unknown version')})",
        f"{len(scenarios)} scenarios",
        "",
    ]

    for scenario in scenarios:
        focus = ", ".join(scenario["focus"])
        scenario_type = scenario["type"]
        lines.append(
            f"- {scenario['id']}: {scenario['title']} [{scenario_type}; {focus}]"
        )
        type_counts[scenario_type] = type_counts.get(scenario_type, 0) + 1
        for item in scenario["focus"]:
            focus_counts[item] = focus_counts.get(item, 0) + 1

    lines.append("")
    lines.append("Type coverage:")
    for scenario_type, count in sorted(type_counts.items()):
        lines.append(f"- {scenario_type}: {count}")

    lines.append("")
    lines.append("Focus coverage:")
    for focus, count in sorted(focus_counts.items()):
        lines.append(f"- {focus}: {count}")

    return "\n".join(lines)


def _validate_retrieval_injection(
    scenario: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    memory_ids = _validate_memories(scenario.get("initial_memories"), path, errors)
    _validate_turns(scenario, path, errors)
    expected = _validate_object(scenario.get("expected"), f"{path}.expected", errors)
    if expected is None:
        return

    _validate_injected_memory_expectation(
        expected.get("injected_memory_ids"),
        memory_ids,
        f"{path}.expected.injected_memory_ids",
        errors,
        require_known_include=True,
    )
    _validate_memory_content_expectation(
        expected.get("injected_memory_content"),
        f"{path}.expected.injected_memory_content",
        errors,
    )


def _validate_memory_tool_call(
    scenario: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    memory_ids = _validate_memories(scenario.get("initial_memories"), path, errors)
    _validate_id_references(
        scenario.get("injected_memory_ids", []),
        memory_ids,
        f"{path}.injected_memory_ids",
        errors,
    )
    _validate_turns(scenario, path, errors)
    expected = _validate_object(scenario.get("expected"), f"{path}.expected", errors)
    if expected is None:
        return

    _validate_tool_call_list(
        expected.get("tool_calls"), f"{path}.expected.tool_calls", errors
    )
    _validate_tool_call_list(
        expected.get("forbidden_tool_calls"),
        f"{path}.expected.forbidden_tool_calls",
        errors,
    )
    _validate_count(
        expected.get("final_memory_count"),
        f"{path}.expected.final_memory_count",
        errors,
    )


def _validate_session_consolidation(
    scenario: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    _validate_memories(
        scenario.get("pre_consolidation_memories"),
        path,
        errors,
        field="pre_consolidation_memories",
    )
    expected = _validate_object(scenario.get("expected"), f"{path}.expected", errors)
    if expected is None:
        return

    _validate_count(
        expected.get("final_memory_count"),
        f"{path}.expected.final_memory_count",
        errors,
    )
    _validate_memory_content_expectation(
        expected.get("final_memories"),
        f"{path}.expected.final_memories",
        errors,
    )


def _validate_full_loop(
    scenario: dict[str, Any],
    path: str,
    errors: list[str],
) -> None:
    sessions = scenario.get("sessions")
    if not isinstance(sessions, list) or not sessions:
        errors.append(f"{path}.sessions must be a non-empty list.")
        return

    for session_index, session in enumerate(sessions):
        session_path = f"{path}.sessions[{session_index}]"
        if not isinstance(session, dict):
            errors.append(f"{session_path} must be an object.")
            continue

        _string_field(session, "id", session_path, errors)
        if not isinstance(session.get("fresh_context"), bool):
            errors.append(f"{session_path}.fresh_context must be a boolean.")

        if "initial_memories" in session:
            _validate_memories(session.get("initial_memories"), session_path, errors)
        _validate_turns(session, session_path, errors)
        _validate_injected_memory_expectation(
            session.get("expected_injected_memory_ids"),
            set(),
            f"{session_path}.expected_injected_memory_ids",
            errors,
            require_known_include=False,
        )

        expected = _validate_object(
            session.get("expected"),
            f"{session_path}.expected",
            errors,
        )
        if expected is None:
            continue

        _validate_tool_call_list(
            expected.get("tool_calls"),
            f"{session_path}.expected.tool_calls",
            errors,
        )
        _validate_tool_call_list(
            expected.get("forbidden_tool_calls"),
            f"{session_path}.expected.forbidden_tool_calls",
            errors,
        )
        _validate_count(
            expected.get("final_memory_count"),
            f"{session_path}.expected.final_memory_count",
            errors,
        )
        _string_list_field(
            expected,
            "answer_traits",
            f"{session_path}.expected",
            errors,
            required=False,
        )

    consolidation = scenario.get("post_session_consolidation")
    if consolidation is not None:
        consolidation_path = f"{path}.post_session_consolidation"
        consolidation_object = _validate_object(
            consolidation, consolidation_path, errors
        )
        if consolidation_object is None:
            return
        expected = _validate_object(
            consolidation_object.get("expected"),
            f"{consolidation_path}.expected",
            errors,
        )
        if expected is not None:
            _validate_count(
                expected.get("final_memory_count"),
                f"{consolidation_path}.expected.final_memory_count",
                errors,
            )
            _validate_memory_content_expectation(
                expected.get("final_memories"),
                f"{consolidation_path}.expected.final_memories",
                errors,
            )


def _validate_memories(
    value: Any,
    path: str,
    errors: list[str],
    *,
    field: str = "initial_memories",
) -> set[str]:
    memory_path = f"{path}.{field}"
    if not isinstance(value, list):
        errors.append(f"{memory_path} must be a list.")
        return set()

    memory_ids: set[str] = set()
    for index, memory in enumerate(value):
        item_path = f"{memory_path}[{index}]"
        if not isinstance(memory, dict):
            errors.append(f"{item_path} must be an object.")
            continue

        memory_id = _string_field(memory, "id", item_path, errors)
        if memory_id in memory_ids:
            errors.append(f"{item_path}.id duplicates memory id '{memory_id}'.")
        memory_ids.add(memory_id)
        _string_field(memory, "kind", item_path, errors)
        _string_field(memory, "content", item_path, errors)
        _optional_confidence(memory, item_path, errors)

    return memory_ids


def _validate_turns(data: dict[str, Any], path: str, errors: list[str]) -> None:
    turns = data.get("turns")
    if not isinstance(turns, list) or not turns:
        errors.append(f"{path}.turns must be a non-empty list.")
        return

    for turn_index, turn in enumerate(turns):
        turn_path = f"{path}.turns[{turn_index}]"
        if not isinstance(turn, dict):
            errors.append(f"{turn_path} must be an object.")
            continue

        role = turn.get("role")
        if role not in {"user", "assistant"}:
            errors.append(f"{turn_path}.role must be 'user' or 'assistant'.")
        _string_field(turn, "content", turn_path, errors)


def _validate_injected_memory_expectation(
    value: Any,
    known_memory_ids: set[str],
    path: str,
    errors: list[str],
    *,
    require_known_include: bool,
) -> None:
    expectation = _validate_object(value, path, errors)
    if expectation is None:
        return

    for field in ("include", "exclude"):
        ids = expectation.get(field, [])
        if not isinstance(ids, list):
            errors.append(f"{path}.{field} must be a list.")
            continue
        for memory_id in ids:
            if not isinstance(memory_id, str):
                errors.append(f"{path}.{field} contains a non-string id.")
            elif (
                require_known_include
                and field == "include"
                and memory_id not in known_memory_ids
            ):
                errors.append(
                    f"{path}.{field} references unknown memory id '{memory_id}'."
                )

    max_count = expectation.get("max_count")
    if max_count is not None and (
        not isinstance(max_count, int) or isinstance(max_count, bool) or max_count < 0
    ):
        errors.append(f"{path}.max_count must be a non-negative integer.")


def _validate_memory_content_expectation(
    value: Any,
    path: str,
    errors: list[str],
) -> None:
    if value is None:
        return
    expectation = _validate_object(value, path, errors)
    if expectation is None:
        return

    _validate_regex_expectations(
        expectation.get("should_match"),
        f"{path}.should_match",
        errors,
        require_label=True,
    )
    _validate_regex_expectations(
        expectation.get("should_not_match"),
        f"{path}.should_not_match",
        errors,
        require_label=False,
    )


def _validate_tool_call_list(value: Any, path: str, errors: list[str]) -> None:
    if value is None:
        return
    if not isinstance(value, list):
        errors.append(f"{path} must be a list.")
        return

    for index, tool_call in enumerate(value):
        tool_path = f"{path}[{index}]"
        if not isinstance(tool_call, dict):
            errors.append(f"{tool_path} must be an object.")
            continue

        name = _string_field(tool_call, "name", tool_path, errors)
        if name and name not in TOOL_NAMES:
            errors.append(f"{tool_path}.name must be one of {sorted(TOOL_NAMES)}.")

        arguments = tool_call.get("arguments")
        if arguments is not None:
            _validate_tool_arguments(arguments, f"{tool_path}.arguments", errors)


def _validate_tool_arguments(value: Any, path: str, errors: list[str]) -> None:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object.")
        return

    for field in ("kind", "memory_id", "confidence"):
        if field in value and not isinstance(value[field], str):
            errors.append(f"{path}.{field} must be a string.")

    for field in ("content_regex", "reason_regex", "memory_id_regex"):
        if field in value:
            pattern = _string_field(value, field, path, errors)
            if pattern:
                _validate_regex(pattern, f"{path}.{field}", errors)


def _validate_regex_expectations(
    expectations: Any,
    path: str,
    errors: list[str],
    *,
    require_label: bool,
) -> None:
    if expectations is None:
        return
    if not isinstance(expectations, list):
        errors.append(f"{path} must be a list.")
        return

    for index, expectation in enumerate(expectations):
        expectation_path = f"{path}[{index}]"
        if not isinstance(expectation, dict):
            errors.append(f"{expectation_path} must be an object.")
            continue

        if require_label:
            _string_field(expectation, "label", expectation_path, errors)
        if "kind" in expectation and not isinstance(expectation["kind"], str):
            errors.append(f"{expectation_path}.kind must be a string.")
        pattern = _string_field(expectation, "regex", expectation_path, errors)
        if pattern:
            _validate_regex(pattern, f"{expectation_path}.regex", errors)


def _validate_count(value: Any, path: str, errors: list[str]) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object.")
        return

    for field in ("min", "max"):
        count = value.get(field)
        if count is not None and (
            not isinstance(count, int) or isinstance(count, bool) or count < 0
        ):
            errors.append(f"{path}.{field} must be a non-negative integer.")

    minimum = value.get("min")
    maximum = value.get("max")
    if isinstance(minimum, int) and isinstance(maximum, int) and minimum > maximum:
        errors.append(f"{path}.min cannot exceed max.")


def _validate_id_references(
    value: Any,
    known_ids: set[str],
    path: str,
    errors: list[str],
) -> None:
    if not isinstance(value, list):
        errors.append(f"{path} must be a list.")
        return

    for memory_id in value:
        if not isinstance(memory_id, str):
            errors.append(f"{path} contains a non-string id.")
        elif memory_id not in known_ids:
            errors.append(f"{path} references unknown memory id '{memory_id}'.")


def _scenario_type(data: dict[str, Any], path: str, errors: list[str]) -> str:
    value = _string_field(data, "type", path, errors)
    if value and value not in SCENARIO_TYPES:
        errors.append(f"{path}.type must be one of {sorted(SCENARIO_TYPES)}.")
        return ""
    return value


def _validate_object(value: Any, path: str, errors: list[str]) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object.")
        return None
    return value


def _optional_confidence(data: dict[str, Any], path: str, errors: list[str]) -> None:
    confidence = data.get("confidence")
    if confidence is not None and not isinstance(confidence, str):
        errors.append(f"{path}.confidence must be a string.")


def _validate_regex(pattern: str, path: str, errors: list[str]) -> None:
    try:
        re.compile(pattern)
    except re.error as error:
        errors.append(f"{path} is invalid: {error}")


def _string_field(
    data: dict[str, Any],
    field: str,
    path: str,
    errors: list[str],
) -> str:
    value = data.get(field)
    if isinstance(value, str) and value:
        return value

    errors.append(f"{path}.{field} must be a non-empty string.")
    return ""


def _string_list_field(
    data: dict[str, Any],
    field: str,
    path: str,
    errors: list[str],
    *,
    required: bool = True,
) -> list[str]:
    value = data.get(field)
    if value is None and not required:
        return []
    if (
        isinstance(value, list)
        and (value or not required)
        and all(isinstance(item, str) for item in value)
    ):
        return value

    errors.append(f"{path}.{field} must be a non-empty list of strings.")
    return []


def _load_yaml_object(path: Path) -> Any:
    with path.open(encoding="utf-8") as file:
        return yaml.safe_load(file)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect and validate Memori benchmark scenarios."
    )
    parser.add_argument(
        "command",
        choices=("summary", "validate"),
        nargs="?",
        default="summary",
    )
    parser.add_argument(
        "--benchmark-dir",
        type=Path,
        default=DEFAULT_BENCHMARK_DIR,
        help="Directory containing benchmark scenario YAML files.",
    )
    args = parser.parse_args()

    data = load_benchmark(args.benchmark_dir)
    errors = validate_benchmark(data)

    if args.command == "validate":
        if errors:
            for error in errors:
                print(f"ERROR: {error}")
            raise SystemExit(1)
        print(f"OK: {args.benchmark_dir}")
        return

    print(scenario_summary(data))
    if errors:
        print("")
        print("Validation errors:")
        for error in errors:
            print(f"- {error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
