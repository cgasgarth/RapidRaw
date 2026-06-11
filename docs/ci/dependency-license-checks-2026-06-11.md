# Dependency License Checks

Issue: #45

## Contract

Pull request CI runs dependency license checks for JavaScript and Rust
dependencies. These checks are metadata gates for package dependency graphs; they
do not replace release artifact notices, fixture provenance, model provenance,
LUT/profile provenance, or bundled binary notice generation.

## JavaScript

JavaScript dependency license auditing uses
`license-checker-rseidelsohn` 5.0.1 through a RawEngine-owned wrapper:

```sh
bun run check:licenses:js
```

The wrapper reads `docs/ci/dependency-license-policy.json`, validates that policy
with Zod, scans installed `node_modules`, and fails on:

- unknown license expressions
- unreviewed license expressions outside the global allowlist
- package-specific reviewed exceptions whose license metadata changes
- missing license files without an explicit package exception
- stale package exceptions that no longer match the installed dependency graph

Current reviewed JavaScript exceptions cover weak-copyleft, attribution-data, and
dual-license metadata such as `MPL-2.0`, `Python-2.0`, `CC-BY-*`, SPDX metadata
packages, Tauri dual-license packages, and SWC native packages.

## Rust

Rust dependency license auditing uses `cargo-deny` 0.19.8:

```sh
bun run check:licenses:rust
```

The policy lives in `src-tauri/deny.toml`. The default allowlist covers
permissive, weak-copyleft, Unicode, and public-domain style licenses currently
present in the Rust dependency graph.

Current explicit Rust exceptions:

- `jxl-encoder` and `jxl-encoder-simd`: `AGPL-3.0-only`, compatible with
  RawEngine's AGPL distribution model and kept explicit because the crates also
  advertise commercial-license alternatives.
- `rawler`: `LGPL-2.1`, sourced from the RapidRAW DngLab git dependency. The
  upstream crate metadata uses deprecated `LGPL-2.1` instead of
  `LGPL-2.1-only`, so `cargo-deny` reports a parse warning while still passing
  the reviewed exception.

Do not add another exception without a GitHub issue, product-scope rationale,
verification evidence, and exit criteria.

## CI

The required PR aggregate includes:

- `license: JavaScript dependencies`
- `license: Rust dependencies`

These jobs run in parallel with frontend, docs, security, actionlint, and Rust
jobs.

## Validation

Run these commands before merging dependency license check changes:

```sh
bun install --frozen-lockfile
bun run check:licenses:js
bun run check:licenses:rust
bun run check:actions
bun run check:action-pins
bun run docs:check
git diff --check
```

`bun run check:licenses:rust` requires `cargo-deny` 0.19.8 to be installed
locally, or it can be validated through the GitHub Actions Rust license job.
