# Dependency Version Audit

Issue: #973

## Contract

RawEngine keeps dependency freshness visible before package work starts. The
audit reports current installed versions, latest compatible versions, latest
stable minor targets, latest stable major targets, and required major migration
issue tracking for package ecosystems that can be queried deterministically.

## Commands

Run the compact local summary:

```sh
bun run deps:audit
```

Render the full Markdown report:

```sh
bun scripts/checks/audit-dependency-versions.ts --format=markdown
```

Run ecosystem-specific reports:

```sh
bun run deps:audit:js
bun run deps:audit:rust
```

Run check mode:

```sh
bun run deps:audit:check
```

Check mode does not mutate lockfiles. It fails only when the report discovers a
major or Cargo semver-breaking migration candidate that is missing from
`docs/ci/dependency-version-major-issues.json`.

## Major Issue Policy

Major tracking data lives in
`docs/ci/dependency-version-major-issues.json`. The audit validates this file
with Zod before running and renders each candidate as one of:

- `#<number> (<status>)` when the migration is tracked;
- `missing issue` when a follow-up issue must be created.

Known tracked major issues when this audit landed:

- #945 `deps(major): migrate npm/eslint to 10`
- #946 `deps(major): migrate npm/@eslint/js to 10`
- #959 `deps(major): migrate cargo/glam to 0.33`
- #960 `deps(major): migrate cargo/imageproc to 0.27`
- #963 `deps(major): migrate cargo/nalgebra to 0.35`

When a new major candidate appears, create the issue first, then add it to the
policy file in the same PR or a small follow-up PR.

## Coverage

The first dependency version audit covers:

- JavaScript and Bun package dependencies from `package.json` and `bun.lock`;
- Rust crates from `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`;
- Cargo `0.x` semver-incompatible minor and selected patch jumps as
  major-style migration candidates.

Related freshness checks:

- GitHub Action current pins and latest upstream tags are checked by
  `bun run check:action-pins:latest`.
- The scheduled dependency-version workflow requests Markdown explicitly and
  writes full JavaScript and Rust reports to GitHub step summaries.
- Node, Bun, Tauri, Rust toolchain, and validation CLI freshness should remain
  visible through package rows where they are represented in `package.json` or
  through dedicated follow-up issues when they are not package-resolvable.

## Latest Refresh

Refreshed on June 18, 2026 with:

```sh
bun run deps:audit:check
bun scripts/checks/audit-dependency-versions.ts --format=markdown
```

Result:

- JavaScript/Bun packages checked: 52.
- Rust/Cargo crates checked: 69.
- Major or semver-breaking migrations found: 0.
- Missing major migration issues: 0.
- Skipped non-registry dependencies: 1 (`rawler`, git dependency).

No new major-version migration issues were required in this refresh.

## Validation

Before merging changes to the audit command or policy, run:

```sh
bun install --frozen-lockfile
bun run deps:audit:check
bun run deps:audit:js
bun run deps:audit:rust
bun run check:unsafe-casts
bun run check:lint -- scripts/checks/audit-dependency-versions.ts
bun run docs:check
git diff --check
```
