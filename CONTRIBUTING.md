# Contributing to Squill

First off, thank you for considering contributing to Squill!

## Prerequisites

- [bun](https://bun.sh/) (v1.0+)
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [prek](https://github.com/j178/prek) (pre-commit hooks)
- Python 3.14+
- Node.js 18+ (for some tooling)

## Setup

```bash
# Clone the repo
git clone https://github.com/MaxHalford/squill
cd squill

# Frontend dependencies
cd frontend && bun install && cd ..

# Backend dependencies
cd backend && uv sync && cd ..

# Environment variables
cp backend/.env.example backend/.env  # then edit with your config

# Install pre-commit hooks
prek install
```

## Running locally

### Frontend

```bash
cd frontend
bun run dev
```

The frontend will be available at [http://localhost:5173](http://localhost:5173)

### Backend

```bash
cd backend
uv run uvicorn main:app --reload
```

The API will be available at [http://localhost:8000](http://localhost:8000)

## Testing

```bash
# Backend tests
cd backend && uv run pytest

# Frontend tests
cd frontend && bun run test:run

# Watch mode (frontend)
cd frontend && bun run test
```

## LLM benchmarks

There are benchmark scripts to test AI code-fixing performance.

```sh
cd backend
python -m scripts.benchmarks.hex_remover
```

## Useful links

- https://github.com/settings/developers

## Need help?

Open an issue if you have questions or run into problems.
