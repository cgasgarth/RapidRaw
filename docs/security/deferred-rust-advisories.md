# Deferred Rust Advisories

This register documents Rust dependency advisories that are known, verified, and not yet remediated. Entries here are not false positives and must not be treated as fixed until their exit criteria pass.

## GHSA-wrw7-89jp-8q8g: `glib` VariantStrIter unsoundness

Status: blocked / deferred
Canonical issue: #262
Dependabot alert: #2
Manifest: `src-tauri/Cargo.lock`
Current vulnerable package: `glib 0.18.5`
Patched version: `glib >= 0.20.0`
Current audit handling: `bun run check:security:rust` validates
`docs/security/rust-advisory-waivers.json`, then ignores only
`RUSTSEC-2024-0429` while keeping new RustSec vulnerability advisories blocking.

### Reason For Deferral

RawEngine is currently macOS-first. The vulnerable `glib` package is present in the all-target Cargo lockfile through the Linux GTK/WebKit/Tauri/wry dependency path, while macOS target-filtered dependency graphs do not resolve `glib`.

The narrow update path is blocked because the current GTK/WebKit stack is on the `gtk-rs` `0.18` generation:

- Direct Linux dependencies include `gtk = "0.18.2"` and `webkit2gtk = "=2.0.2"`.
- `cargo update -p glib --precise 0.20.0 --dry-run` fails because `gtk v0.18.2` requires `glib = "^0.18"`.
- `wry v0.55.1`, `tauri-runtime-wry v2.11.2`, and `tauri v2.11.2` also participate in the Linux GTK/WebKit graph.

Do not attempt broad Linux GTK/WebKit dependency churn inside a small security patch while Linux packaging is outside the current product scope.

### Current Verification Evidence

Run from `src-tauri`:

```sh
cargo tree --locked --target all -i glib
cargo tree --locked --target aarch64-apple-darwin -i glib
cargo tree --locked --target x86_64-apple-darwin -i glib
cargo metadata --locked --format-version 1 --filter-platform aarch64-apple-darwin
cargo metadata --locked --format-version 1 --filter-platform x86_64-apple-darwin
cargo update -p glib --precise 0.20.0 --dry-run
```

Expected current result:

- all-target graph shows `glib v0.18.5`
- both macOS target `cargo tree` commands print `warning: nothing to print.`
- both macOS target metadata commands succeed
- the `glib 0.20.0` dry-run fails on `gtk v0.18.2`

### Exit Criteria

This advisory is remediated only when all of the following are true:

- `cargo tree --locked --target all -i glib` shows no vulnerable `glib`, or only `glib >= 0.20.0`.
- `cargo metadata --locked --format-version 1` succeeds with no vulnerable all-target `glib` dependency.
- Product-critical macOS Rust checks pass.
- The remediation reaches `main`.
- Dependabot alert #2 closes as fixed.

### Revisit Triggers

Revisit this deferral before any of the following:

- Linux builds or Linux packaging become product-relevant again.
- Any additional Rust advisory needs an ignore entry.
- Tauri/wry offers a narrow upgrade path that moves the Linux GTK/WebKit stack to `glib >= 0.20.0`.
- Warning-level RustSec debt becomes a required CI gate.

Candidate future investigation:

```sh
cd src-tauri
cargo update -p glib --precise 0.20.0 --dry-run
cargo update -p tauri -p tauri-build -p tauri-plugin-dialog -p tauri-plugin-fs -p tauri-plugin-os -p tauri-plugin-process -p tauri-plugin-shell -p tauri-plugin-single-instance -p wry --dry-run
```

If the Tauri/wry dry-run requires broad unrelated Linux stack churn, keep this blocked until Linux support is in scope.

## RUSTSEC-2026-0194 / RUSTSEC-2026-0195: `quick-xml` parser denial of service

Status: partially remediated / deferred
Canonical issue: #4773
Manifest: `src-tauri/Cargo.lock`
Current vulnerable packages: `quick-xml 0.37.5`, `quick-xml 0.39.4`
Patched version: `quick-xml >= 0.41.0`
Current audit handling: `bun run check:security` validates
`docs/security/rust-advisory-waivers.json`, then ignores only the ledger-backed
`RUSTSEC-2026-0194` and `RUSTSEC-2026-0195` entries while keeping new RustSec
vulnerability advisories blocking.

### Reason For Deferral

Direct RawEngine `quick-xml` usage is updated to `0.41.0`. The remaining
vulnerable versions are transitive:

- `quick-xml 0.37.5` through `little_exif 0.6.23`
- `quick-xml 0.39.4` through `plist 1.9.0`, reached by Tauri packages

Current narrow update checks show no compatible cargo update path:

```sh
cd src-tauri
cargo update -p little_exif --dry-run
cargo update -p plist --dry-run
cargo update -p quick-xml@0.37.5 --precise 0.41.0 --dry-run
```

The `quick-xml@0.37.5` precise update fails because `little_exif 0.6.23`
requires `quick-xml = "^0.37.5"`. `little_exif` and `plist` are already at their
latest compatible versions in this lockfile.

### Exit Criteria

This advisory pair is remediated only when all of the following are true:

- `cargo audit --ignore RUSTSEC-2024-0429` passes without ignoring
  `RUSTSEC-2026-0194` or `RUSTSEC-2026-0195`.
- `cargo tree -i quick-xml@0.37.5` and `cargo tree -i quick-xml@0.39.4` no
  longer show vulnerable dependency paths, or those paths use `quick-xml >= 0.41.0`.
- Product-critical macOS Rust checks pass.
- The remediation reaches `main`.
