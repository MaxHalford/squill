# Contributing to Squill

First off, thank you for considering contributing to Squill!

## Prerequisites

- [bun](https://bun.sh/) (v1.0+)
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [prek](https://github.com/j178/prek) (pre-commit hooks)
- Python 3.14+
- Node.js 18+ (for some tooling)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-org/squill.git
cd squill
```

### 2. Install frontend dependencies

```bash
cd frontend
bun install
```

### 3. Install backend dependencies

```bash
cd backend
uv sync
cd ..
```

### 4. Set up environment variables

```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your configuration
```

### 5. Install pre-commit hooks

```bash
prek install
```

## Running locally

### Frontend

```bash
cd frontend
bun run dev
```

The frontend will be available at http://localhost:5173

### Backend

```bash
cd backend
uv run uvicorn main:app --reload
```

The API will be available at http://localhost:8000

## Code quality

We use automated tools to maintain code quality:

- **ruff** - Python linting and formatting
- **ty** - Python type checking
- **TypeScript** - Frontend type checking

### Run linters manually

```bash
# Backend (from project root)
prek run --all-files

# Frontend
bun run type-check
```

## LLM benchmarks

There are benchmark scripts to test AI code-fixing performance.

```sh
cd backend
python -m scripts.benchmark_fixer
```

## Need help?

Open an issue if you have questions or run into problems.
