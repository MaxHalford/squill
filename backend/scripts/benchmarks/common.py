"""Shared benchmark infrastructure.

Provides YAML scenario loading, CLI argument parsing, the run loop,
and result formatting — reused by each feature-specific benchmark.
"""

import argparse
import statistics
import sys
from collections.abc import Callable
from pathlib import Path

import yaml

# ---------------------------------------------------------------------------
# ANSI colours
# ---------------------------------------------------------------------------

GREEN = "\033[32m"
RED = "\033[31m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

# A scenario runner receives (scenario_dict, model, retries, verbose) and
# returns (passed, failure_messages, elapsed_seconds, optional_result_for_verbose).
ScenarioRunner = Callable[
    [dict, str | None, int, bool],
    tuple[bool, list[str], float, object | None],
]


# ---------------------------------------------------------------------------
# Scenario loading
# ---------------------------------------------------------------------------


def load_scenarios(
    scenarios_path: Path,
    names: list[str] | None = None,
) -> list[dict]:
    """Load YAML scenario files from *scenarios_path*.

    If *names* is given, only those scenario stems are loaded (error on unknown).
    """
    if not scenarios_path.exists() or not scenarios_path.is_dir():
        print(f"{RED}Error: scenario directory not found: {scenarios_path}{RESET}")
        sys.exit(1)

    all_yaml_files = sorted(scenarios_path.glob("*.yaml")) + sorted(
        scenarios_path.glob("*.yml")
    )
    if not all_yaml_files:
        print(f"{RED}Error: no .yaml files found in {scenarios_path}{RESET}")
        sys.exit(1)

    if names:
        available = {yf.stem: yf for yf in all_yaml_files}
        unknown = [name for name in names if name not in available]
        if unknown:
            print(f"{RED}Error: unknown scenarios: {', '.join(unknown)}{RESET}")
            print(f"Available: {', '.join(sorted(available))}")
            sys.exit(1)
        yaml_files = [available[name] for name in names]
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

    return scenarios


# ---------------------------------------------------------------------------
# Stats formatting
# ---------------------------------------------------------------------------


def format_latency_stats(latencies: list[float]) -> str:
    """Format latency statistics for display."""
    if not latencies:
        return "  (no data)"

    sorted_l = sorted(latencies)
    n = len(sorted_l)
    p95_idx = min(int(n * 0.95), n - 1)

    lines = [
        f"  min     {sorted_l[0]:.2f}s",
        f"  max     {sorted_l[-1]:.2f}s",
        f"  mean    {statistics.mean(sorted_l):.2f}s",
        f"  median  {statistics.median(sorted_l):.2f}s",
    ]
    if n >= 3:
        lines.append(f"  p95     {sorted_l[p95_idx]:.2f}s")
    lines.append(f"  total   {sum(sorted_l):.2f}s")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI + run loop
# ---------------------------------------------------------------------------


def build_arg_parser(
    description: str, default_scenarios: Path
) -> argparse.ArgumentParser:
    """Create a standard benchmark CLI argument parser."""
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "names",
        nargs="*",
        help="Run only these scenarios by filename (without extension)",
    )
    parser.add_argument(
        "--scenarios",
        type=str,
        default=str(default_scenarios),
        help=f"Path to scenario directory (default: {default_scenarios})",
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
    return parser


def run_benchmark(
    *,
    title: str,
    default_model: str,
    scenarios: list[dict],
    runner: ScenarioRunner,
    model: str | None,
    retries: int,
    verbose: bool,
) -> None:
    """Run all scenarios, print results, and exit with appropriate code."""
    model_display = model or default_model
    print(f"\n{BOLD}=== {title} ==={RESET}")
    print(f"Model: {model_display}")
    print(f"Running {len(scenarios)} scenario{'s' if len(scenarios) != 1 else ''}...\n")

    passed = 0
    failed = 0
    latencies: list[float] = []

    for scenario in scenarios:
        name = scenario["name"]
        ok, failures, elapsed, result = runner(scenario, model, retries, verbose)
        latencies.append(elapsed)

        if ok:
            passed += 1
            print(f"  {GREEN}[PASS]{RESET} {name} {DIM}({elapsed:.2f}s){RESET}")
        else:
            failed += 1
            print(f"  {RED}[FAIL]{RESET} {name} {DIM}({elapsed:.2f}s){RESET}")
            for f_msg in failures:
                print(f"    {RED}- {f_msg}{RESET}")

        if verbose and result:
            from pydantic import BaseModel

            if isinstance(result, BaseModel):
                print(f"    {DIM}{result.model_dump_json(indent=2)}{RESET}")
            else:
                print(f"    {DIM}{result}{RESET}")

    # Summary
    print(f"\n{BOLD}Accuracy:{RESET} ", end="")
    if failed == 0:
        print(f"{GREEN}{passed}/{passed + failed} passed{RESET}")
    else:
        print(f"{GREEN}{passed} passed{RESET}, {RED}{failed} failed{RESET}")

    print(f"\n{BOLD}Latency:{RESET}")
    print(format_latency_stats(latencies))

    sys.exit(0 if failed == 0 else 1)
