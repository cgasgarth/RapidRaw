# User-Visible String Lint

- Issue: #1316
- Rule: i18n extraction/lint coverage for user-visible strings.
- Decision: keep user-visible copy gated through the standard local and CI quality commands.

## Probe

Two stricter settings were tested:

1. Current markup-focused coverage promoted from warning to error.
2. Broad coverage with `markupOnly: false`.

Both passed the lint and i18n gates with zero findings, so broad string coverage can run in the normal quality gate.

`bun run i18n:lint` and `bun run check:i18n` also pass, so the previous
hardcoded-string debt referenced in older baseline docs is no longer current.

## Policy

New user-visible strings should use i18n resources unless they are explicit technical constants, data values, identifiers, or ignored non-copy attributes.

The broad rule remains intentionally paired with the existing attribute allowlist
for styling, SVG, form metadata, IDs, values, and other non-copy props.

## Validation

- `bun run lint`
- `i18next-cli extract --ci --dry-run`
