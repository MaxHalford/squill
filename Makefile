# Squill development commands

.PHONY: check type-check lint test build dev

check: type-check lint test build

type-check:
	npm run type-check

lint:
	npm run lint

test:
	npm run test:run

build:
	npm run build

dev:
	npm run dev
