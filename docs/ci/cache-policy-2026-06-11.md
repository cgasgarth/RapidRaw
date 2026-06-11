# GitHub Actions Cache Policy

Issue: #50 `ci(cache): add Bun Cargo Tauri and build caches`

RawEngine uses dependency-oriented caches to speed up CI while keeping build
outputs reproducible and reviewable. Caches should make repeated builds faster;
artifacts should preserve review or failure evidence.

## Current Caches

| Cache                     | Location                                  | Paths                                                        | Key axes                                           | Notes                                                          |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| Bun package cache         | `.github/actions/setup-bun-deps`          | `~/.bun/install/cache`                                       | OS, runner arch, `bun.lock`, `package.json`        | Do not cache `node_modules`.                                   |
| Rust/Cargo cache          | `Swatinem/rust-cache`                     | `src-tauri` workspace dependency and target cache            | OS/platform, runner arch, target, mobile/desktop   | Do not add a second broad `src-tauri/target` cache.            |
| ONNX runtime binary cache | `actions/cache`                           | ONNX runtime files under `src-tauri/resources` and Android   | OS, runner arch, target, mobile/desktop, build.rs  | Restore only inside the same target/mobile axis.               |
| actionlint Go cache       | `.github/workflows/lint.yml`              | `~/go/pkg/mod`, `~/.cache/go-build`                          | OS, runner arch, actionlint command owner workflow | Tooling-only cache for the `go run ... actionlint` validation. |
| Build/release artifacts   | `.github/workflows/build.yml`             | Platform package outputs and release metadata                | Artifact names, not cache keys                     | Preserve outputs as artifacts; do not restore them as caches.  |
| Failure diagnostics       | `.github/workflows/build.yml`, `lint.yml` | Focused logs, summaries, and build-script outputs on failure | Artifact names, not cache keys                     | Short-lived debug evidence only.                               |

## Key Rules

- Include OS and runner architecture in binary/tool caches.
- Include target triple when cache contents are target-specific.
- Include the mobile/desktop axis for Tauri desktop versus Android work.
- Restore keys may drop dependency hashes, but must not drop OS, architecture,
  target, or mobile/desktop axes.
- Version cache key families with a `vN-` prefix when changing key semantics.
- Prefer step summaries that report exact hit/miss status for `actions/cache`
  steps.

## Do Not Cache

- `node_modules`
- Broad `src-tauri/target/**` trees outside `Swatinem/rust-cache`
- Tauri `.app`, `.dmg`, `.apk`, `.aab`, `.deb`, `.rpm`, `.AppImage`, or release
  upload staging outputs
- signing material, keychains, Android keystores, tokens, or release secrets
- fixture images or raw photo assets without fixture manifest and license review

## Follow-Up Candidates

- Add Android Gradle cache only after Android build gates are stable. Cache
  Gradle wrapper/modules, not `src-tauri/gen/android/app/build`.
- Evaluate `sccache` for Rust/Tauri builds separately from cache-key hygiene.
- Add cache metrics or periodic cache-size review if GitHub cache churn becomes
  visible.
