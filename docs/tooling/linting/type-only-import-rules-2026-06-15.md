# Type-Only Import Rules

- Issue: #1310
- Candidate rules:
  - `@typescript-eslint/consistent-type-imports`
  - `@typescript-eslint/consistent-type-exports`
  - `@typescript-eslint/no-import-type-side-effects`
- Status: evaluated, not globally enabled yet

The type-only lint subset was probed against full-repo ESLint. It found 140 auto-fixable violations, mostly imports where values are only used as types and inline `type` specifiers that leave runtime side-effect imports behind.

This is valuable but too much import churn for a mixed-purpose PR. Enable the rules in a dedicated cleanup PR that runs `bun eslint . --fix`, reviews the import-only diff, then keeps the rules in the zero-warning lint gate.

`verbatimModuleSyntax` was also probed but not enabled. Current root package/module settings make TypeScript treat source files as CommonJS under that flag, producing broad `TS1295`/`TS1287` failures. Enabling it should be handled with a dedicated ESM/package-config migration, not mixed into the lint-rule PR.
