# Rust Feature Matrix

- Issue: #1327
- Workflow: `.github/workflows/panorama-opencv-spike.yml`
- Gate: scheduled and manual, not ordinary PR

The required PR Rust checks stay on `--no-default-features --features required-ci` to keep pull requests fast and avoid platform dependency churn.

The weekly Rust feature matrix installs OpenCV on macOS and runs:

```sh
cargo check --locked --all-targets --all-features
cargo test --locked --all-targets --all-features opencv_spike -- --nocapture
```

This is the only workflow currently allowed to use `--all-features`. If new optional features are added, keep this matrix as the first scheduled detector before promoting any optional-feature gate to ordinary PR CI.
