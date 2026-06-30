# ESLint Accessibility Rules

Issue: #33

## Contract

Accessibility linting uses the official `eslint-plugin-jsx-a11y` flat
recommended config for JSX and TSX files.

## Scope

This step starts with the recommended rule set. The strict rule set should wait
until recommended coverage is stable and any required UI component conventions
are documented.

## Enforced Interaction Rules

The first accessibility recommended run found 140 problems. The recommended
config is enabled now, and the largest legacy interaction rule families have
been burned down and promoted into the blocking lint gate.

| Rule                                              | Status               |
| ------------------------------------------------- | -------------------- |
| `jsx-a11y/no-static-element-interactions`         | Enforced as an error |
| `jsx-a11y/click-events-have-key-events`           | Enforced as an error |
| `jsx-a11y/no-autofocus`                           | Enforced as an error |
| `jsx-a11y/no-noninteractive-element-interactions` | Enforced as an error |

Small GPS map findings were fixed in this PR by adding an iframe title and an
accessible label to the map link overlay.

## Validation

Run these commands before merging accessibility lint changes:

```sh
bun install --frozen-lockfile
bun run check:a11y
bun run check:lint
bun run docs:check
```

## Focused Pass

Issue #244 adds `check:a11y` as a fast accessibility pass. It verifies the
blocking JSX accessibility rule severities, runs focused lint over key modal and
right-panel surfaces, and checks that primary modal dialogs keep `role="dialog"`,
`aria-modal`, and `aria-labelledby` contracts.
