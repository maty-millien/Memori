from __future__ import annotations

from benchmark.loader import load_scenarios
from benchmark.scenarios import validate_scenarios


def main() -> None:
    scenarios = load_scenarios()
    errors = validate_scenarios(scenarios)

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)
    print(f"OK: {len(scenarios)} scenarios")


if __name__ == "__main__":
    main()
