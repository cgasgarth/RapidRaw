# TypeScript Control-Flow Flags

Status: compiler hardening.

## Scope

- Enables `noImplicitReturns`.
- Enables `noFallthroughCasesInSwitch`.
- Sets `allowUnreachableCode` to `false`.
- Sets `allowUnusedLabels` to `false`.
- Applies the flags to the app and RawEngine schema package tsconfigs.

## Rejected For This Slice

- `skipLibCheck: false`: deferred as likely dependency declaration noise.
- `noUnusedLocals` and `noUnusedParameters`: ESLint unused-variable policy is the chosen lower-noise gate.

## Validation

- `bun run check:types`
- `bun run schema:types`
- `bun run check:lint`
