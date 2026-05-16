from __future__ import annotations

from benchmark.loader import load_scenarios


def main() -> None:
    scenarios = load_scenarios()
    print(f"OK: {len(scenarios)} scenarios")


if __name__ == "__main__":
    main()
