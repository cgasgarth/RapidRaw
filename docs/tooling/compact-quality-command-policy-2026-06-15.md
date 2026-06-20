# Compact Quality Command Policy

- Issue: #1325
- Validation command: `bun run check:compact-commands`

Quality gates should not flood local or CI logs by default. Package scripts that run noisy tools such as ESLint, TypeScript, Prettier, cargo checks, cargo audit, cargo deny, Bun audit, or actionlint must use `scripts/run-compact-command.ts`, `scripts/run-compact-checks.ts`, or delegate to another package script that does.

Workflow `run` commands are parsed from YAML. Raw workflow commands are allowed only when listed in `tests/integration/checks/check-compact-quality-commands.ts` with a bounded-output reason, such as Rust-only CI paths that intentionally avoid installing Bun.

New quality commands should prefer compact wrappers. If a raw command is necessary, add a narrow allowlist entry with a reason that explains why output remains bounded.
