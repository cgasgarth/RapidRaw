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
- `react-hooks/exhaustive-deps` remains fenced until the dependency-array
  inventory is fixed in a focused follow-up.

## Legacy Hook Fences

The first hooks recommended run found 107 problems. The React and hooks configs
are enabled now, but high-volume React compiler rule families remain fenced so
they can be fixed in focused PRs.

| Count | Rule                                      | Follow-Up Path                 |
| ----: | ----------------------------------------- | ------------------------------ |
|    48 | `react-hooks/set-state-in-effect`         | #526 state/effect cleanup      |
|    32 | `react-hooks/refs`                        | #527 ref render-access cleanup |
|    10 | `react-hooks/static-components`           | #530 nested/static cleanup     |
|     6 | `react-hooks/immutability`                | #529 hook mutation cleanup     |
|     2 | `react-hooks/preserve-manual-memoization` | #529 memo preservation         |
|     1 | `react-hooks/purity`                      | #529 render purity cleanup     |

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
