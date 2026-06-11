# ESLint Accessibility Rules

Issue: #33

## Contract

Accessibility linting uses the official `eslint-plugin-jsx-a11y` flat
recommended config for JSX and TSX files.

## Scope

This step starts with the recommended rule set. The strict rule set should wait
until recommended coverage is stable and any required UI component conventions
are documented.

## Legacy Fences

The first accessibility recommended run found 140 problems. The recommended
config is enabled now, but high-volume legacy rule families remain fenced so
they can be fixed in focused UI PRs.

| Count | Rule                                              | Follow-Up Path                       |
| ----: | ------------------------------------------------- | ------------------------------------ |
|    63 | `jsx-a11y/no-static-element-interactions`         | #535 interactive element semantics   |
|    53 | `jsx-a11y/click-events-have-key-events`           | #534 keyboard handlers and roles     |
|    13 | `jsx-a11y/no-autofocus`                           | #536 focus management                |
|     9 | `jsx-a11y/no-noninteractive-element-interactions` | #537 noninteractive listener cleanup |

Small GPS map findings were fixed in this PR by adding an iframe title and an
accessible label to the map link overlay.

## Validation

Run these commands before merging accessibility lint changes:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run docs:check
```
