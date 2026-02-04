#!/usr/bin/env python
"""
Benchmark CLI for the AI SQL line fixer.

Usage:
    cd backend
    python -m scripts.benchmark_fixer
    python -m scripts.benchmark_fixer --model gpt-4o
    python -m scripts.benchmark_fixer --scenarios scripts/benchmark_scenarios/
    python -m scripts.benchmark_fixer typo_function_name_bigquery missing_comma_postgres
    python -m scripts.benchmark_fixer --verbose --retries 2
"""

import argparse
import statistics
import sys
import time
from pathlib import Path

import dotenv
import yaml
from services.ai_fixer import FixError, FixResponse, suggest_fix_core

dotenv.load_dotenv()

# ---------------------------------------------------------------------------
# ANSI colours
# ---------------------------------------------------------------------------

GREEN = "\033[32m"
RED = "\033[31m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


# ---------------------------------------------------------------------------
# Apply fix & check result
# ---------------------------------------------------------------------------


def apply_fix(query: str, result: FixResponse) -> str:
    """Apply a FixResponse to the original query, returning the corrected query."""
    lines = query.split("\n")

    if result.action == "replace":
        if 1 <= result.line_number <= len(lines):
            lines[result.line_number - 1] = result.suggestion
    elif result.action == "insert":
        pos = min(result.line_number - 1, len(lines))
        lines.insert(pos, result.suggestion)

    return "\n".join(lines)


def normalize_query(query: str) -> str:
    """Strip trailing whitespace per line and trailing blank lines."""
    lines = [line.rstrip() for line in query.split("\n")]
    # Remove trailing empty lines
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def check_expectations(
    query: str, result: FixResponse, expected: dict
) -> list[str]:
    """Compare the corrected query against the expected query. Returns list of failures."""
    failures: list[str] = []

    if expected.get("no_relevant_fix"):
        if not result.no_relevant_fix:
            failures.append("expected no_relevant_fix, but got a fix")
        return failures

    if result.no_relevant_fix:
        failures.append("expected a fix, but got no_relevant_fix")
        return failures

    corrected = normalize_query(apply_fix(query, result))
    expected_query = normalize_query(expected["query"])

    if corrected != expected_query:
        failures.append("corrected query does not match expected")
        failures.append(f"  expected:\n{expected_query}")
        failures.append(f"  got:\n{corrected}")

    return failures


# ---------------------------------------------------------------------------
# Scenario runner
# ---------------------------------------------------------------------------


def run_scenario(
    scenario: dict,
    model: str | None,
    retries: int,
    verbose: bool,
) -> tuple[bool, list[str], float, FixResponse | None]:
    """Run a single scenario. Returns (passed, failures, elapsed_seconds, result)."""
    inp = scenario["input"]
    expected = scenario["expected"]

    failures: list[str] = []
    result: FixResponse | None = None
    elapsed = 0.0

    for attempt in range(1 + retries):
        t0 = time.perf_counter()
        try:
            result = suggest_fix_core(
                query=inp["query"],
                error_message=inp["error_message"],
                database_dialect=inp["database_dialect"],
                schema_context=inp.get("schema_context"),
                sample_queries=inp.get("sample_queries"),
                model=model,
                metadata={"source": "benchmark"},
                use_cache=False,
            )
            failures = check_expectations(inp["query"], result, expected)
        except FixError as e:
            failures = [f"FixError: {e.message}"]
        except Exception as e:
            failures = [f"Exception: {e}"]
        elapsed = time.perf_counter() - t0

        if not failures:
            if attempt > 0 and verbose:
                print(f"    {DIM}(passed on retry {attempt + 1}/{1 + retries}){RESET}")
            break

    return (len(failures) == 0, failures, elapsed, result)


# ---------------------------------------------------------------------------
# Stats formatting
# ---------------------------------------------------------------------------


def format_latency_stats(latencies: list[float]) -> str:
    """Format latency statistics."""
    if not latencies:
        return "  (no data)"

    sorted_l = sorted(latencies)
    n = len(sorted_l)

    # p95: index at 95th percentile
    p95_idx = min(int(n * 0.95), n - 1)

    lines = [
        f"  min    {sorted_l[0]:.2f}s",
        f"  max    {sorted_l[-1]:.2f}s",
        f"  mean   {statistics.mean(sorted_l):.2f}s",
        f"  median {statistics.median(sorted_l):.2f}s",
    ]
    if n >= 3:
        lines.append(f"  p95    {sorted_l[p95_idx]:.2f}s")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark CLI for the AI SQL line fixer"
    )
    parser.add_argument(
        "names",
        nargs="*",
        help="Run only these scenarios by filename (without extension)",
    )
    parser.add_argument(
        "--scenarios",
        type=str,
        default=str(Path(__file__).parent / "benchmark_scenarios"),
        help="Path to directory of YAML scenario files (default: scripts/benchmark_scenarios/)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Override OpenAI model (e.g. gpt-4o, gpt-4o-mini, gpt-4.1-nano)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show full AI responses for each scenario",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=0,
        help="Number of retries per scenario on failure (default: 0, max: 5)",
    )
    args = parser.parse_args()
    args.retries = min(args.retries, 5)

    # Load scenarios from directory
    scenarios_path = Path(args.scenarios)
    if not scenarios_path.exists() or not scenarios_path.is_dir():
        print(f"{RED}Error: scenario directory not found: {scenarios_path}{RESET}")
        sys.exit(1)

    all_yaml_files = sorted(scenarios_path.glob("*.yaml")) + sorted(scenarios_path.glob("*.yml"))
    if not all_yaml_files:
        print(f"{RED}Error: no .yaml files found in {scenarios_path}{RESET}")
        sys.exit(1)

    # Filter by exact filename (without extension) if provided
    if args.names:
        available = {yf.stem: yf for yf in all_yaml_files}
        unknown = [name for name in args.names if name not in available]
        if unknown:
            print(f"{RED}Error: unknown scenarios: {', '.join(unknown)}{RESET}")
            print(f"Available: {', '.join(sorted(available))}")
            sys.exit(1)
        yaml_files = [available[name] for name in args.names]
    else:
        yaml_files = all_yaml_files

    scenarios: list[dict] = []
    for yf in yaml_files:
        with open(yf) as f:
            data = yaml.safe_load(f)
        if data and "input" in data and "expected" in data:
            data["name"] = yf.stem
            scenarios.append(data)

    if not scenarios:
        print(f"{RED}Error: no valid scenarios found in {scenarios_path}{RESET}")
        sys.exit(1)

    # Header
    from services.ai_fixer import DEFAULT_MODEL

    model_display = args.model or DEFAULT_MODEL
    print(f"\n{BOLD}=== AI Fixer Benchmark ==={RESET}")
    print(f"Model: {model_display}")
    print(f"Running {len(scenarios)} scenario{'s' if len(scenarios) != 1 else ''}...\n")

    # Run scenarios
    passed = 0
    failed = 0
    latencies: list[float] = []
    total_t0 = time.perf_counter()

    for scenario in scenarios:
        name = scenario["name"]
        ok, failures, elapsed, result = run_scenario(
            scenario, args.model, args.retries, args.verbose
        )
        latencies.append(elapsed)

        if ok:
            passed += 1
            print(f"  {GREEN}[PASS]{RESET} {name} {DIM}({elapsed:.2f}s){RESET}")
        else:
            failed += 1
            print(f"  {RED}[FAIL]{RESET} {name} {DIM}({elapsed:.2f}s){RESET}")
            for f_msg in failures:
                print(f"    {RED}- {f_msg}{RESET}")

        if args.verbose and result:
            print(f"    {DIM}{result.model_dump_json(indent=2)}{RESET}")

    total_elapsed = time.perf_counter() - total_t0

    # Summary
    print(f"\n{BOLD}Results:{RESET} ", end="")
    if failed == 0:
        print(f"{GREEN}{passed}/{passed + failed} passed{RESET}")
    else:
        print(f"{GREEN}{passed} passed{RESET}, {RED}{failed} failed{RESET}")

    # Latency stats
    print(f"\n{BOLD}Latency:{RESET}")
    print(format_latency_stats(latencies))

    print(f"\nTotal time: {total_elapsed:.2f}s\n")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
