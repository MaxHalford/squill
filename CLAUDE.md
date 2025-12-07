# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Technology stack

- Frontend: Vue.js with TypeScript
- Build tool: Vite
- Runtime: bun.js

## Features

- This app is a web-based interface for querying and exploring databases.
- The user can connect to multiple databases.
- The app is meant to be used by data analysts and data scientists.
- The main functionality is to query databases using SQL, but also to explore database schemas visually.

## UI/UX

- The app is intended to look and feel like an operating system:
  - There is a menu bar at the top.
  - The user can move, resize, add, delete windows.
  - The user can drag around the canvas by maintaining left click and dragging.
  - The user can write queries into SQL editor windows, and execute them.
  - We're going for a minimalist retro look, using a limited color palette and simple shapes.
- Use the semantic design system in style.css for consistent styling.

## Code style and guidelines

- Don't hesitate to refactor and improve the structure as needed.
- It's important to keep the code clean, simple, and maintainable.
- Work smart. When debugging, take a step back and think deeply about what might be going wrong. When something is not working as intended, add logging to check your assumptions.
- You can use the Playwright MCP for testing
- The app is expected to be used in a desktop web browser.
- Always use plan mode, and don't mind asking for clarifications.
- Use bun.js to run commands, e.g. `bun run type-check` to type-check the code.
- Use modern CSS features
