# AGENTS.md

This application is a pnpm monorepo with the following packages (not exhaustive):

- packages/core - Core logic for the application (to run in Node).
- packages/contract - Contract models to be shared between the core and the UI.
- apps/ui - UI for the application (Electron).

There is no network backend. The backend is the Electron Node process, where most of business logic happens.

The app is a Git UI optimized for the stacked PRs workflow.

## General rules

- ALWAYS run `pnpm typecheck` before finishing a task to ensure no type errors are introduced.
- NEVER cast to `as any` unless it's absolutely necessary. Prefer:
  1. using type guards.
  2. casting to narrower types.
  3. using `as unknown as` only as a last resort, and add a comment explaining why it's the only way.
