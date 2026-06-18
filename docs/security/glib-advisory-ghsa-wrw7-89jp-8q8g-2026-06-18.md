# glib Advisory GHSA-wrw7-89jp-8q8g

Tracking issue: #262

## Status

Accepted blocker for the current macOS-first RawEngine scope.

The vulnerable `glib` crate is present in `src-tauri/Cargo.lock`, but it is not
resolved for the macOS target graph. It is pulled by Linux GTK/WebKit crates in
the all-target graph. The current waiver remains bounded by review and expiry
dates in `docs/security/rust-advisory-waivers.json`.

## Evidence

macOS target graph:

```sh
cargo tree --target aarch64-apple-darwin -i glib
```

Result: no dependency path printed.

All-target graph:

```sh
cargo tree --target all -i glib
```

Result: `glib v0.18.5` is pulled through Linux GTK/WebKit paths including
`gtk v0.18.2`, `webkit2gtk v2.0.2`, `wry v0.55.1`, and `tauri v2.11.2`.

Smallest direct update attempt:

```sh
cargo update -p glib --precise 0.20.0
```

Result:

```text
error: failed to select a version for the requirement `glib = "^0.18"`
candidate versions found which didn't match: 0.20.0
required by package `gtk v0.18.2`
```

Audit gate:

```sh
bun run check:security:rust
```

Result: passes with the bounded `RUSTSEC-2024-0429` waiver.

## Decision

Do not force a GTK/WebKit migration into the macOS-first product lane for this
advisory. Revisit when the waiver review date approaches, when Tauri/Wry move
their Linux GTK stack to compatible patched crates, or when Linux support
becomes active product scope.
