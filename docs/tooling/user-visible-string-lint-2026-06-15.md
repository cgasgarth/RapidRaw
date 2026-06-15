# User-Visible String Lint

- Issue: #1316
- Rule: `i18next/no-literal-string`
- Decision: enable as an error with `markupOnly: false`.

## Probe

Two stricter settings were tested:

1. Current markup-focused coverage promoted from warning to error.
2. Broad coverage with `markupOnly: false`.

Both passed `bun run check:lint` with zero findings, so the stricter rule can run
in the normal zero-warning ESLint gate.

`bun run i18n:lint` and `bun run check:i18n` also pass, so the previous
hardcoded-string debt referenced in older baseline docs is no longer current.

## Policy

New user-visible strings should use i18n resources unless they are explicit
technical constants, data values, identifiers, or ignored attributes listed in
`eslint.config.js`.

The broad rule remains intentionally paired with the existing attribute allowlist
for styling, SVG, form metadata, IDs, values, and other non-copy props.

## Validation

- `bun run check:lint`
- `bun run check:i18n`
- `bun run i18n:lint`
