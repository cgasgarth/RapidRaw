# ESLint Escape Hatches

Issue: #37

RawEngine allows lint escape hatches only when they are narrow, documented, and
auditable.

## Policy

- Use `eslint-disable-next-line`, not file-wide or block-wide disables.
- Include explicit rule names.
- Include a descriptive `-- reason` explaining the temporary boundary.
- Remove stale disables; ESLint reports unused disable directives as errors.

The repository check scans parsed comment tokens, not raw source lines, so
strings and ordinary code text cannot satisfy or trip the policy.

## Validation

```sh
bun tests/integration/checks/check-eslint-escape-hatches.ts --self-test
bun run check:lint-escapes
```

`.github/workflows/lint.yml` runs this as `frontend: lint escape hatch policy`
and includes it in `PR CI / required`.
