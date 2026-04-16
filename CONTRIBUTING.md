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

## Releasing the desktop app

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml) on GitHub Actions and published to [Releases](https://github.com/MaxHalford/squill/releases). Each tag produces macOS (arm64), Windows, and Linux bundles.

### Philosophy

The **web app is bleeding-edge** — deployed continuously from `main`, whatever's there is what users get. The **desktop app is versioned** — users on a tagged release know exactly what code they're running, and it doesn't change under them until they update.

### Version format

Standard [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH** — bug fixes, no behavioural change (`0.1.0 → 0.1.1`)
- **MINOR** — new features, backwards-compatible (`0.1.1 → 0.2.0`)
- **MAJOR** — breaking changes or milestone releases (`0.x → 1.0.0`)

Stay in `0.x` until we're confident the UX is stable enough to commit to it. `1.0.0` is a statement.

### Release steps

1. Bump the version in two places (they must match the tag):
   - `frontend/src-tauri/tauri.conf.json` → `"version"`
   - `frontend/src-tauri/Cargo.toml` → `version`

2. Commit, tag, push:

   ```bash
   git add -A && git commit -m "Release 0.2.0"
   git tag v0.2.0
   git push origin main v0.2.0
   ```

3. The workflow runs (~15–25 min across the three platforms) and creates a **draft** release with all bundles attached. The release body is auto-compiled from every `frontend/src/data/changelog/YYYY-MM-DD.md` entry whose date is **after** the previous tag's commit date — so the web changelog doubles as desktop release notes, zero extra work.

4. Review the draft on GitHub Releases. Tweak the compiled notes if needed, then click **Publish**.

### Testing the workflow

Before your first real tag, trigger a throwaway run to catch config issues:

```bash
git tag v0.0.1-test
git push origin v0.0.1-test
# ... workflow runs, produces draft release
# delete the draft and the tag afterwards:
git push --delete origin v0.0.1-test
git tag -d v0.0.1-test
```

Or use the **Run workflow** button in the Actions tab (`workflow_dispatch`).

### Signing (not set up)

All bundles currently ship **unsigned**. Users see a Gatekeeper / SmartScreen warning on first launch. The release notes tell them how to bypass it. If we later pay for an Apple Developer account ($99/yr) or a Windows code-signing cert, secrets slot into the `tauri-action` step without changing the rest of the workflow.

## Useful links

- https://github.com/settings/developers
- https://console.cloud.google.com/auth/overview?project=squill-482710

## Need help?

Open an issue if you have questions or run into problems.
