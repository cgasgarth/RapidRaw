# Assertion Narrowing Lint

- Issue: #1321
- Candidate rule: `@typescript-eslint/no-unsafe-type-assertion`
- Status: evaluated, not globally enabled yet

Raw `as Foo` assertions can still hide unsafe narrowing even after `as any` and `as unknown as` are banned. This rule blocks type assertions that narrow a value to a less-safe type without a guard.

Allowed cases still include widening, `as const`, and assertions that TypeScript can prove are not unsafe. Boundary payloads should use Zod schemas or typed adapters instead of trust-based downcasts.

Probe result: full-repo ESLint reported 51 violations. The largest classes were CSS style-object assertions, generic record narrowing, console method narrowing, and AI patch narrowing. This is useful but too noisy for an immediate global PR gate.

Rollout path:

- Keep the existing AST guard for `as any` and `as unknown as`.
- Fix assertion clusters with real guards, Zod schemas, typed adapter functions, or `satisfies`.
- Re-probe `@typescript-eslint/no-unsafe-type-assertion` after the clusters are removed.
- Enable the rule globally only when `bun run lint` passes without new broad suppressions.
