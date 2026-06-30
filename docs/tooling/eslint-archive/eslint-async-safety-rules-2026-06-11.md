# ESLint Async Safety Rules

Issue: #35

## Contract

Async safety linting uses the type-aware `@typescript-eslint` strict rule set.
This PR turns on the lowest-risk async rule that can pass after small local
cleanup and records the remaining high-volume promise rules for focused
follow-up work.

## Enabled Now

`@typescript-eslint/require-await` is enabled as an error. The first run found
three functions that were marked `async` without awaiting:

- `src/window/TitleBar.tsx`
- `src/components/panel/right/PresetsPanel.tsx`

Those functions were made synchronous in this PR.

## Legacy Fences

The first async-safety measurement found larger promise handling families that
need focused UI and event-handler cleanup PRs.

| Count | Rule                                      | Follow-Up Path                |
| ----: | ----------------------------------------- | ----------------------------- |
|   126 | `@typescript-eslint/no-floating-promises` | #546 floating promise cleanup |
|   134 | `@typescript-eslint/no-misused-promises`  | #547 async UI handler cleanup |

The highest-volume files from the first measurement were:

- `src/components/panel/SettingsPanel.tsx`
- `src/App.tsx`
- `src/components/modals/LensCorrectionModal.tsx`
- `src/hooks/useAppContextMenus.ts`
- `src/hooks/useAppInitialization.ts`
- `src/window/TitleBar.tsx`

## Validation

Run these commands before merging async safety lint changes:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run check:lint-escapes
bun run docs:check
```
