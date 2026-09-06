# Squill development commands

.PHONY: check type-check lint test build dev

check: type-check lint test build

type-check:
	cd frontend && npm run type-check

lint:
	cd frontend && npm run lint

test:
	cd frontend && npm run test:run

build:
	cd frontend && npm run build

dev:
	cd frontend && npm run dev
