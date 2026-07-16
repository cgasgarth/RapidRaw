# TypeScript 7 Compiler Configuration

- Current-state audit: 2026-07-16
- Compiler: TypeScript `7.0.2`
- Package/runtime: Bun
- Canonical command: `bun run typecheck`

## Supported Compiler Surface

RawEngine has one TypeScript lane. TypeScript 7 is the direct compiler dependency,
the compiler invoked by every project, and the only compiler represented in the
lockfile. There is no previous-compiler package, command, configuration, workflow,
shim, alias, or documentation lane.

The shared `tsconfig.base.json` owns the strict policy for application, schema,
script, and test projects:

| Option                               | Required value |
| ------------------------------------ | -------------- |
| `strict`                             | `true`         |
| `exactOptionalPropertyTypes`         | `true`         |
| `noUncheckedIndexedAccess`           | `true`         |
| `noImplicitOverride`                 | `true`         |
| `noPropertyAccessFromIndexSignature` | `true`         |
| `noUncheckedSideEffectImports`       | `true`         |
| `noFallthroughCasesInSwitch`         | `true`         |
| `noImplicitReturns`                  | `true`         |
| `allowUnreachableCode`               | `false`        |
| `allowUnusedLabels`                  | `false`        |
| `module`                             | `preserve`     |
| `moduleResolution`                   | `bundler`      |
| `moduleDetection`                    | `force`        |
| `verbatimModuleSyntax`               | `true`         |
| `target`                             | `esnext`       |
| `noEmit`                             | `true`         |

These settings match Bun's TypeScript runtime model: Bun executes source directly,
while the compiler performs strict analysis without emitting JavaScript.

## Runtime Boundaries

- `tsconfig.json` covers browser production source with DOM libraries and no Bun
  ambient globals.
- `packages/rawengine-schema/tsconfig.json` keeps the portable schema package free
  of host-runtime ambient globals.
- `scripts/tsconfig.json` covers Bun-executed scripts with explicit Bun types.
- `tests/pure-ts/ci/tsconfig.json` covers every `tests/pure-ts/**/*.test.ts` and
  `tests/pure-ts/**/*.test.tsx` file plus its imported graph with explicit Bun and
  DOM types.

The full test project is discovered semantically from the compiler configuration
and compared with Bun's repository glob, so a newly added TypeScript test cannot
silently fall outside strict checking.

## Required Gates

`bun run typecheck` runs the application, schema, and complete Bun-test projects in
parallel. The same command is required by staged precommit validation, pull-request
validation, and non-canceling main validation. The complete Bun suite continues to
use Bun's native worker scheduling; no serial compatibility shard exists.

## Validation

```sh
bun node_modules/typescript/bin/tsc --version
bun run typecheck
bun test
bun run lint
bun run format:check
```

The TypeScript runtime-boundary tests additionally verify the installed compiler,
direct dependency peer support, project ambient boundaries, complete test-tree
coverage, and absence of superseded compiler lanes.
