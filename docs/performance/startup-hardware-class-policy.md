# Startup hardware-class policy

`scripts/benchmarks/startup-native.ts` always retains 30 cold starts, 30 warm starts, and one degraded start. Every run must preserve trace/PID identity, phase ordering, interactive-before-heavy-service causality, editor-demand single flight, and explicit degraded receipts.

The default `default-macos-arm64` class is the representative Apple-silicon product contract: p95 first paint 750 ms, Rust-entry-to-visible 250 ms, Rust-entry-to-interactive 750 ms, and response 100 ms.

GitHub-hosted `macos-14` is explicitly classified as `github-hosted-macos-arm64`. Its stable visible and response limits remain 250 ms and 100 ms; its observed WebKit/WindowServer floor uses a bounded 2,000 ms interactive p95. Cold interactive p95 must also remain at or below `warm p95 × 1.25 + 100 ms`.

A hosted runner that misses any distribution limit repeats one complete, independent 30-pair cohort. The second cohort retains every absolute and cold/warm limit unchanged; a repeated miss fails. Trace, ordering, and receipt failures never retry. This separates transient shared-host WebKit/WindowServer contention from a reproducible product regression without deleting outliers or widening the product budget.

The workflows pass the class explicitly. Missing input selects the representative default; unknown values fail closed. Benchmark output records the selected class so a hosted-runner receipt cannot be mistaken for representative-hardware proof.
