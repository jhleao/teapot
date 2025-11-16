# Shared Code Directory

This directory contains code that is shared between the Electron main process (Node.js) and the renderer process (Chromium).

## Structure

```
src/shared/
├── types/          # TypeScript type definitions and interfaces
│   ├── ui.ts      # UI-related types (UiStack, UiCommit, UiBranch)
│   ├── git.ts     # Git-related types (Repo, Commit, Branch, etc.)
│   └── index.ts   # Re-exports all types
└── utils/          # Shared utility functions (if needed)
```

## Usage

Import shared types using the `@shared` path alias:

```typescript
// In main process
import type { UiStack } from '@shared/types'

// In renderer process
import type { UiStack, UiCommit } from '@shared/types'
```

## Important Notes

1. **Only pure TypeScript**: This directory should only contain code that works in both Node.js and browser environments. Avoid Node.js-specific APIs (like `fs`, `path`, etc.) or browser-specific APIs (like `window`, `document`, etc.) unless they're properly abstracted.

2. **Type-only imports**: When importing types, use `import type` to ensure they're stripped at runtime and don't cause bundling issues.

3. **Path aliases**: The `@shared/*` alias is configured in:
   - `tsconfig.node.json` (for main process)
   - `tsconfig.web.json` (for renderer process)
   - `electron.vite.config.ts` (for Vite bundling)

4. **Utilities**: If you need to add shared utility functions, place them in `src/shared/utils/` and ensure they work in both environments.
