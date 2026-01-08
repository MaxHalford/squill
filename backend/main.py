import os
import textwrap

import duckdb
import openai
import pandas as pd
import pydantic
from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI()


@app.get("/")
def root():
    return {"message": "hello free world"}

OPENAI_CLIENT = openai.OpenAI()
OPENAI_MODEL = "gpt-4o-2024-08-06"


class QueryLineFix(pydantic.BaseModel):
    line_number: int
    suggestion: str


def suggest_query_line_fix(
    query: str,
    error_message: str,
    database_flavor: str,
) -> QueryLineFix:
    user_prompt = f"""
    QUERY:
    {prepend_line_numbers(query)}

    ERROR:
    {error_message}
    """
    user_prompt = textwrap.dedent(user_prompt)

    return OPENAI_CLIENT.responses.parse(
        model=OPENAI_MODEL,
        input=[
            {
                "role": "user",
                "content": user_prompt,
            },
            {
                "role": "system",
                "content": f"You are an expert in {database_flavor} SQL. The following query has an issue in it. The exact error message has been provided. Suggest a fix to solve the issue. Provide the line number and the replacement line.",
            },
        ],
        text_format=QueryLineFix,
    )


def prepend_line_numbers(query: str) -> str:
    lines = query.split("\n")
    return "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))


def main():
    # Create dummy pandas tables
    users = pd.DataFrame({"user_id": [1, 2, 3], "name": ["Alice", "Bob", "Charlie"]})

    orders = pd.DataFrame(
        {
            "order_id": [101, 102, 103],
            "user_id": [1, 2, 1],
            "amount": [50.0, 75.0, 120.0],
        }
    )

    query = """
SELECT u.name, o.order_id, o.amount
FROM users u
JOIN orders o ON u.user_id = o.user_id
ORDER B o.order_id
    """

    try:
        result = duckdb.sql(query).df()
    except Exception as e:
        print(e)
        result = suggest_query_line_fix(
            query=query,
            error_message=str(e),
            database_flavor="duckdb",
        )
        print("Suggested fix:")
        print(result.output_parsed)
        return

    print(result)


if __name__ == "__main__":
    main()
