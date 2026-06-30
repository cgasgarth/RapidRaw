# Rust Unused Dependency Gate Evaluation

Issue: #1294

Command evaluated:

```sh
cargo install cargo-machete --locked --version 0.9.2
(cd src-tauri && cargo machete --with-metadata)
```

Findings:

- `futures-util` was unused.
- `os_info` was unused.
- `tauri-build` is used from `build.rs`, but cargo-machete reports it as unused; it is ignored in Cargo metadata.
- `kamadak-exif` needs `--with-metadata` because the crate is imported as `exif`.

Decision: keep cargo-machete out of the PR gate for now because installing the binary adds non-trivial setup time. The configured command is stable locally and should be reconsidered for CI after a cached install path exists.
