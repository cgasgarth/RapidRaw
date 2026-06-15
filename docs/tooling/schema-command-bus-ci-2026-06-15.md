# Schema Command Bus CI

- Issue: #1323
- Required PR job: `schemas: edit command bus`
- Validation command: `bun run schema:command-bus`

The PR baseline now runs generated type drift, RawEngine schema package checks, and edit command bus checks as separate parallel jobs. This is stricter than a path-gated schema-only job: schema drift and command-bus mismatches are caught on every PR while still starting at the beginning of the workflow.

Schema parity is contract proof only. Passing this job does not prove that a UI feature is end-to-end complete; runtime apply, preview/export parity, and app-server coverage need their own executable checks.
