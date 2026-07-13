# Validation DAG

RawEngine validation is declared in `scripts/validation/manifest.ts` and executed by the same planner locally and in CI.

## Confidence modes

- `commit`: staged affected static checks and focused tests; the precommit hook runs this after the mutating lint/fix phase.
- `push`: affected integration, build, browser, and native closure relative to `origin/main`.
- `pr`: affected fast-feedback closure in CI; protected-branch jobs still enforce the broad required matrix.
- `full`: every non-release node with no result reuse. A scheduled workflow runs this weekly to detect selector/cache gaps.
- `release`: every declared node, including release-only proofs.

Use `bun run validate:commit`, `validate:push`, `validate:pr`, `validate:full`, or `validate:release`. Add `--explain-cache`, `--no-cache`, or `--verify-cache` when invoking `scripts/validation/run.ts` directly.

## Correctness and cache policy

The fix stage completes before a frozen source snapshot is hashed. Ownership classes propagate through schema, frontend, native, workflow, and dependency edges; unknown paths conservatively select broad validation. Keys bind node definitions, source content, dependency identities, platform/toolchains, features, and an environment allowlist.

Only successful, unexpired records are reused. Declared producer outputs are content-hashed and bound to the producing key; corrupt, missing, or same-size modified artifacts force execution. Cacheable identical nodes use cross-worktree single-flight. Native-heavy, browser, and network work also take stable shared class leases regardless of cache policy. Cancellation terminates process groups and releases cache/class leases in reverse order.

Run `bun run validate:benchmark` for the 100-change executable replay and `bun run validate:benchmark:real` for the bounded real-command legacy/full/affected parity benchmark.

## Acceptance receipt

On the implementation head, frozen legacy full validation completed in 19,297 ms (61,260 ms child CPU, 2,557,706,240-byte peak child RSS, 24 processes). DAG full no-cache completed in 19,625 ms (64,180 ms child CPU, 2,616,639,488-byte peak child RSS, 29 nodes and one shared build). Every result passed and the built `dist` content identity matched exactly.

| Affected scenario | Cold wall | Child CPU | Peak child RSS | Processes | Warm wall / cache hits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Docs | 511 ms | 1,970 ms | 197,918,720 | 2 | 280 ms / 2 |
| TypeScript component | 17,415 ms | 45,810 ms | 2,465,005,568 | 12 | 374 ms / 12 |
| Schema | 17,580 ms | 46,080 ms | 2,623,422,464 | 12 | 387 ms / 12 |
| Rust leaf | 2,221 ms | 3,070 ms | 198,361,088 | 9 | 353 ms / 9 |
| Workflow | 13,015 ms | 8,320 ms | 223,657,984 | 6 | 321 ms / 6 |
| Dependency | 17,816 ms | 47,640 ms | 2,521,104,384 | 18 | 443 ms / 18 |
| Mixed | 18,707 ms | 51,080 ms | 2,599,452,672 | 18 | 447 ms / 18 |

Cold TypeScript, schema, dependency, and mixed changes remain near full-gate wall time because their conservative ownership closure intentionally retains broad confidence. The material common-path gain is avoiding unrelated work for docs/Rust changes and reusing content-identical results: all seven warm scenarios required zero child processes or builds and completed in under 450 ms. This receipt does not claim a broad cold speedup where the measurements do not show one.
