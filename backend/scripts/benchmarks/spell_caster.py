#!/usr/bin/env python
"""
Benchmark for the Spell caster (AI SQL rewriter).

Usage:
    cd backend
    python -m scripts.benchmarks.spell_caster
    python -m scripts.benchmarks.spell_caster --model gpt-4o
    python -m scripts.benchmarks.spell_caster --scenarios scripts/benchmarks/spell_caster_scenarios/
    python -m scripts.benchmarks.spell_caster add_where_clause_postgres add_group_by_bigquery
    python -m scripts.benchmarks.spell_caster --verbose --retries 2
"""

import time
from pathlib import Path

import sqlglot
from scripts.benchmarks.common import build_arg_parser, load_scenarios, run_benchmark
from services.spell_caster import (
    DEFAULT_MODEL,
    SpellError,
    SpellResponse,
    cast_spell_core,
)

DEFAULT_SCENARIOS = Path(__file__).parent / "spell_caster_scenarios"

# ---------------------------------------------------------------------------
# Check result
# ---------------------------------------------------------------------------

DIALECT_MAP = {
    "bigquery": "bigquery",
    "postgres": "postgres",
    "duckdb": "duckdb",
    "snowflake": "snowflake",
}


def normalize_sql(query: str, dialect: str) -> str:
    """Parse and regenerate SQL via SQLGlot to get a canonical form."""
    sqlglot_dialect = DIALECT_MAP.get(dialect, dialect)
    return sqlglot.transpile(
        query.strip(), read=sqlglot_dialect, write=sqlglot_dialect, pretty=True
    )[0]


def check_expectations(
    result: SpellResponse, expected: dict, dialect: str
) -> list[str]:
    """Compare the rewritten query against the expected query using SQLGlot."""
    failures: list[str] = []

    rewritten_raw = result.rewritten_query
    expected_raw = expected["query"]

    try:
        rewritten_norm = normalize_sql(rewritten_raw, dialect)
        expected_norm = normalize_sql(expected_raw, dialect)
    except Exception:
        rewritten_norm = rewritten_raw.strip()
        expected_norm = expected_raw.strip()

    if rewritten_norm != expected_norm:
        failures.append("rewritten query does not match expected")
        failures.append(f"  expected:\n{expected_norm}")
        failures.append(f"  got:\n{rewritten_norm}")

    return failures


# ---------------------------------------------------------------------------
# Scenario runner
# ---------------------------------------------------------------------------


def run_scenario(
    scenario: dict,
    model: str | None,
    retries: int,
    verbose: bool,
) -> tuple[bool, list[str], float, SpellResponse | None]:
    """Run a single spell-caster scenario."""
    inp = scenario["input"]
    expected = scenario["expected"]

    failures: list[str] = []
    result: SpellResponse | None = None
    elapsed = 0.0

    for attempt in range(1 + retries):
        t0 = time.perf_counter()
        try:
            result = cast_spell_core(
                query=inp["query"],
                instruction=inp["instruction"],
                database_dialect=inp["database_dialect"],
                schema_context=inp.get("schema_context"),
                model=model,
                metadata={"source": "benchmark"},
                use_cache=False,
            )
            failures = check_expectations(result, expected, inp["database_dialect"])
        except SpellError as e:
            failures = [f"SpellError: {e.message}"]
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
        description="Benchmark for the Spell caster (AI SQL rewriter)",
        default_scenarios=DEFAULT_SCENARIOS,
    )
    args = parser.parse_args()
    args.retries = min(args.retries, 5)

    scenarios = load_scenarios(
        Path(args.scenarios),
        names=args.names or None,
    )

    run_benchmark(
        title="Spell caster benchmark",
        default_model=DEFAULT_MODEL,
        scenarios=scenarios,
        runner=run_scenario,
        model=args.model,
        retries=args.retries,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
