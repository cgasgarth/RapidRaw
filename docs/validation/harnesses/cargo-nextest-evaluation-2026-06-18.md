# Cargo Nextest Evaluation

Tracking issue: #1313

## Decision

Do not add `cargo-nextest` to PR gates right now.

`cargo-nextest` works locally, but the measured win is not enough to justify a
new required tool in the current PR lane. The Rust suite is compile-bound on a
cold run, while warm `cargo test` is already faster than the warm nextest run in
this repo snapshot.

## Evidence

Machine: local macOS arm64.

Tool check:

```sh
cargo search cargo-nextest --limit 1
```

Result: `cargo-nextest = "0.9.137"`.

Prebuilt binary source:

```sh
gh release view cargo-nextest-0.9.137 --repo nextest-rs/nextest --json tagName,assets
```

Result: release `cargo-nextest-0.9.137` includes
`cargo-nextest-0.9.137-universal-apple-darwin.tar.gz`.

Cold-ish baseline after local branch changes:

```sh
date +%s && bun run check:rust:test && date +%s
```

Result: 68 seconds, passed.

Warm nextest run with downloaded prebuilt binary:

```sh
PATH=/tmp/rawengine-nextest:$PATH cargo nextest run --locked --all-targets --no-default-features --features required-ci
```

Result: 80 tests passed in 3 seconds wall time.

Warm current repo command:

```sh
date +%s && bun run check:rust:test && date +%s
```

Result: 1 second, passed.

## Follow-Up

Revisit nextest only if Rust test count grows enough that warm `cargo test`
runtime becomes meaningful, or if CI logs show repeated Rust test failure
diagnostics that nextest would materially improve.

If revisited, keep it out of the required PR gate until a CI-side timing run
shows net benefit after binary install/cache overhead.
