# Squill — development commands
#
# Usage:
#   make test                 # run all tests
#   make test-frontend        # frontend type-check + unit tests
#   make build-rust           # build the Rust backend
#   make docker-build         # build the Rust backend Docker image

# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

.PHONY: test test-frontend build-rust docker-build

## Run all tests
test: test-frontend

## Build the Rust backend
build-rust:
	cd backend && cargo build

## Run frontend type-check + unit tests
test-frontend:
	cd frontend && bun run type-check && bun run test:run

## Build the Rust backend Docker image
docker-build:
	cd backend && docker build -t squill-server .
