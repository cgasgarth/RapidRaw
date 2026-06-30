# Bun Test Harness

Use `bun test` for pure TypeScript logic when the target is deterministic, fast, and benefits from multiple named assertions. Good targets include schema packages, command buses, math helpers, parsing helpers, and small utility modules.

Keep `tests/integration/checks/check-*.ts` for repository policy checks, fixture manifest scans, multi-process validation, external CLIs, generated artifact comparisons, or checks that need custom compact failure output.

Initial adopted command:

```sh
bun run check:pure-ts-tests
```

This command is part of `check:quick` so PRs catch pure TypeScript regressions early. It is unit/contract evidence only; it does not prove runtime image editing behavior or UI workflows.
