# Deferred Rust Advisories

This register documents Rust dependency advisories that are known, verified, and not yet remediated. Entries here are not false positives and must not be treated as fixed until their exit criteria pass.

## GHSA-wrw7-89jp-8q8g: `glib` VariantStrIter unsoundness

Status: blocked / deferred
Canonical issue: #262
Dependabot alert: #2
Manifest: `src-tauri/Cargo.lock`
Current vulnerable package: `glib 0.18.5`
Patched version: `glib >= 0.20.0`
Current audit handling: `bun run check:security:rust` ignores only `RUSTSEC-2024-0429`
while keeping new RustSec advisories blocking.

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

Candidate future investigation:

```sh
cd src-tauri
cargo update -p glib --precise 0.20.0 --dry-run
cargo update -p tauri -p tauri-build -p tauri-plugin-dialog -p tauri-plugin-fs -p tauri-plugin-os -p tauri-plugin-process -p tauri-plugin-shell -p tauri-plugin-single-instance -p wry --dry-run
```

If the Tauri/wry dry-run requires broad unrelated Linux stack churn, keep this blocked until Linux support is in scope.
