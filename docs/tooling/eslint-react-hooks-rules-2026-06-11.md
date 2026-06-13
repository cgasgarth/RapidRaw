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
- `react-hooks/static-components` is enforced as an error after moving inherited
  nested component definitions to stable module-level components.
- `react-hooks/refs` is enforced as an error after moving inherited render-time
  ref reads into effects, event handlers, state, or memoized values.
- `react-hooks/set-state-in-effect` is enforced as an error after deferring or
  deriving inherited synchronous effect state writes.

## Legacy Hook Fences

The first hooks recommended run found 107 problems. The React and hooks configs
are enabled now. `react-hooks/exhaustive-deps`, `react-hooks/purity`,
`react-hooks/preserve-manual-memoization`, `react-hooks/immutability`,
`react-hooks/static-components`, `react-hooks/refs`, and
`react-hooks/set-state-in-effect` have since been promoted to hard gates.

Resolved hook fences:

| Former Count | Rule                                      | Resolution                                                         |
| -----------: | ----------------------------------------- | ------------------------------------------------------------------ |
|            4 | `react-hooks/exhaustive-deps`             | Enabled as an error after dependency cleanup.                      |
|            1 | `react-hooks/purity`                      | Enabled as an error after thumbnail hook cleanup.                  |
|            2 | `react-hooks/preserve-manual-memoization` | Enabled as an error after preserving inherited manual memoization. |
|            6 | `react-hooks/immutability`                | Enabled as an error after callback and ref-state cleanup.          |
|           10 | `react-hooks/static-components`           | Enabled as an error after nested component definitions were moved. |
|           32 | `react-hooks/refs`                        | Enabled as an error after render-time ref reads were removed.      |
|           48 | `react-hooks/set-state-in-effect`         | Enabled as an error after state/effect cleanup.                    |

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
