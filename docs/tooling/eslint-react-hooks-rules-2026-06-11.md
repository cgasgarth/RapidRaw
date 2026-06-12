# ESLint React And Hooks Rules

Issue: #32

## Contract

React linting uses the official `eslint-plugin-react` flat recommended config
and JSX runtime config. Hooks linting uses the official
`eslint-plugin-react-hooks` flat recommended config.

## TypeScript Overrides

- `react/prop-types` stays disabled because component props are typed with
  TypeScript.
- `react/react-in-jsx-scope` and `react/jsx-uses-react` are disabled by the JSX
  runtime config.
- `react-hooks/exhaustive-deps` is enforced as an error after the focused
  dependency-array cleanup.
- `react-hooks/purity` is enforced as an error after moving inherited impure
  hook construction out of hook bodies.
- `react-hooks/preserve-manual-memoization` is enforced as an error after
  preserving the inherited folder-toggle and mask-overlay memoization patterns.
- `react-hooks/immutability` is enforced as an error after moving inherited
  recursive callbacks and ref state consumption behind stable local functions.

## Legacy Hook Fences

The first hooks recommended run found 107 problems. The React and hooks configs
are enabled now. `react-hooks/exhaustive-deps`, `react-hooks/purity`, and
`react-hooks/preserve-manual-memoization`, and `react-hooks/immutability` have
since been promoted to hard gates. The remaining high-volume React compiler rule
families stay fenced so they can be fixed in focused PRs.

| Count | Rule                              | Follow-Up Path                 |
| ----: | --------------------------------- | ------------------------------ |
|    48 | `react-hooks/set-state-in-effect` | #526 state/effect cleanup      |
|    32 | `react-hooks/refs`                | #527 ref render-access cleanup |
|    10 | `react-hooks/static-components`   | #530 nested/static cleanup     |

Resolved hook fences:

| Former Count | Rule                                      | Resolution                                                         |
| -----------: | ----------------------------------------- | ------------------------------------------------------------------ |
|            4 | `react-hooks/exhaustive-deps`             | Enabled as an error after dependency cleanup.                      |
|            1 | `react-hooks/purity`                      | Enabled as an error after thumbnail hook cleanup.                  |
|            2 | `react-hooks/preserve-manual-memoization` | Enabled as an error after preserving inherited manual memoization. |
|            6 | `react-hooks/immutability`                | Enabled as an error after callback and ref-state cleanup.          |

Small React recommended findings were fixed in this PR by removing unused
default React imports and assigning display names to memoized components.

## Validation

Run these commands before merging React and hooks lint changes:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run check:lint-escapes
bun run docs:check
```
