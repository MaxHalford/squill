#!/usr/bin/env python
"""
Benchmark for the Hex remover (AI SQL fixer).

Usage:
    cd backend
    python -m scripts.benchmarks.hex_remover
    python -m scripts.benchmarks.hex_remover --model gpt-4o
    python -m scripts.benchmarks.hex_remover --scenarios scripts/benchmarks/hex_remover_scenarios/
    python -m scripts.benchmarks.hex_remover typo_function_name_bigquery missing_comma_postgres
    python -m scripts.benchmarks.hex_remover --verbose --retries 2
"""

import time
from pathlib import Path

import sqlglot
from scripts.benchmarks.common import build_arg_parser, load_scenarios, run_benchmark
from services.hex_remover import (
    DEFAULT_MODEL,
    FixError,
    FixResponse,
    suggest_fix_core,
)

DEFAULT_SCENARIOS = Path(__file__).parent / "hex_remover_scenarios"

# ---------------------------------------------------------------------------
# Apply fix & check result
# ---------------------------------------------------------------------------

DIALECT_MAP = {
    "bigquery": "bigquery",
    "postgres": "postgres",
    "duckdb": "duckdb",
    "snowflake": "snowflake",
}


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


def normalize_sql(query: str, dialect: str) -> str:
    """Parse and regenerate SQL via SQLGlot to get a canonical form."""
    sqlglot_dialect = DIALECT_MAP.get(dialect, dialect)
    return sqlglot.transpile(
        query.strip(), read=sqlglot_dialect, write=sqlglot_dialect, pretty=True
    )[0]


def check_expectations(
    query: str, result: FixResponse, expected: dict, dialect: str
) -> list[str]:
    """Compare the corrected query against the expected query using SQLGlot."""
    failures: list[str] = []

    if expected.get("no_relevant_fix"):
        if not result.no_relevant_fix:
            failures.append("expected no_relevant_fix, but got a fix")
        return failures

    if result.no_relevant_fix:
        failures.append("expected a fix, but got no_relevant_fix")
        return failures

    corrected_raw = apply_fix(query, result)
    expected_raw = expected["query"]

    try:
        corrected_norm = normalize_sql(corrected_raw, dialect)
        expected_norm = normalize_sql(expected_raw, dialect)
    except Exception:
        corrected_norm = corrected_raw.strip()
        expected_norm = expected_raw.strip()

    if corrected_norm != expected_norm:
        failures.append("corrected query does not match expected")
        failures.append(f"  expected:\n{expected_norm}")
        failures.append(f"  got:\n{corrected_norm}")

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
    """Run a single hex-remover scenario."""
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
            failures = check_expectations(
                inp["query"], result, expected, inp["database_dialect"]
            )
        except FixError as e:
            failures = [f"FixError: {e.message}"]
        except Exception as e:
            failures = [f"Exception: {e}"]
        elapsed = time.perf_counter() - t0

        if not failures:
            from scripts.benchmarks.common import DIM, RESET

            if attempt > 0 and verbose:
                print(f"    {DIM}(passed on retry {attempt + 1}/{1 + retries}){RESET}")
            break

    return (len(failures) == 0, failures, elapsed, result)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = build_arg_parser(
        description="Benchmark for the Hex remover (AI SQL fixer)",
        default_scenarios=DEFAULT_SCENARIOS,
    )
    args = parser.parse_args()
    args.retries = min(args.retries, 5)

    scenarios = load_scenarios(
        Path(args.scenarios),
        names=args.names or None,
    )

    run_benchmark(
        title="Hex remover benchmark",
        default_model=DEFAULT_MODEL,
        scenarios=scenarios,
        runner=run_scenario,
        model=args.model,
        retries=args.retries,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
