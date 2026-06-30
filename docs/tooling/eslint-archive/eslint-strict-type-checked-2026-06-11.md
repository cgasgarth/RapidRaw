# ESLint Strict Type-Checked Rules

Issue: #31

## Contract

TypeScript linting uses `typescript-eslint` strict type-checked rules. This is
the strict preset family intended for teams comfortable with TypeScript and
typed linting, and it builds on the parser project service enabled by #30.

## Scope

This step intentionally changes only the TypeScript preset family. React,
accessibility, import boundary, and async-safety rule expansions remain separate
follow-up issues so each PR stays reviewable.

## Legacy Fences

The first strict type-checked run found 2,317 errors. The strict preset is
enabled now. Several formerly fenced high-volume rule families have since been
promoted to hard gates after focused cleanup PRs. Remaining fenced families
should continue to be enabled one rule family at a time.

| Count | Rule                                                        | Follow-Up Path                       |
| ----: | ----------------------------------------------------------- | ------------------------------------ |
|   134 | `@typescript-eslint/no-misused-promises`                    | #35 async UI handler wrappers        |
|   126 | `@typescript-eslint/no-floating-promises`                   | #35 async safety issue               |
|   112 | `@typescript-eslint/no-unsafe-member-access`                | #520 schema/parser hardening         |
|   108 | `@typescript-eslint/no-unsafe-assignment`                   | #520 schema/parser hardening         |
|    48 | `@typescript-eslint/no-unnecessary-type-assertion`          | #520 redundant assertion cleanup     |
|    40 | `@typescript-eslint/no-unsafe-argument`                     | #520 schema/parser hardening         |
|    39 | `@typescript-eslint/no-unsafe-enum-comparison`              | #520 enum and state model cleanup    |
|    37 | `@typescript-eslint/no-non-null-assertion`                  | #519 DOM/ref guards                  |
|    32 | `@typescript-eslint/no-deprecated`                          | #523 Zod v4 schema API modernization |
|    28 | `@typescript-eslint/use-unknown-in-catch-callback-variable` | #522 error handling normalization    |

The remaining strict findings each had 21 or fewer hits and should be included
with the closest cleanup family when practical.

Resolved strict fences:

| Former Count | Rule                                               | Resolution                                       |
| -----------: | -------------------------------------------------- | ------------------------------------------------ |
|          597 | `@typescript-eslint/no-confusing-void-expression`  | Enabled as an error after callback cleanup.      |
|          526 | `@typescript-eslint/no-unnecessary-condition`      | Enabled as an error after nullability cleanup.   |
|          233 | `@typescript-eslint/restrict-template-expressions` | Enabled as an error after formatting cleanup.    |
|          186 | `@typescript-eslint/unbound-method`                | Enabled as an error after callback-type cleanup. |

## Validation

Run these commands before merging strict type-checked lint changes:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run check:lint-escapes
bun run docs:check
```
