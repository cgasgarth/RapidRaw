# RapidRAW Baseline Snapshot

Snapshot date: 2026-06-10  
Issue: #15 `baseline(upstream): record RapidRAW upstream commit and dependency state`

## Repository State

| Item                            | Value                                        |
| ------------------------------- | -------------------------------------------- |
| Fork repository                 | `cgasgarth/RapidRaw`                         |
| Upstream repository             | `CyberTimon/RapidRAW`                        |
| Local checkout                  | `/Users/cgas/Documents/RawEngine/RapidRaw`   |
| Fork `main` SHA at snapshot     | `0b6b7f34072f262a257f625c086fa7c98fb4f27d`   |
| Upstream `main` SHA at snapshot | `66c8dcd2309c63d9e16c20abefb329c51991636b`   |
| `origin` remote                 | `https://github.com/cgasgarth/RapidRaw.git`  |
| `upstream` remote               | `https://github.com/CyberTimon/RapidRAW.git` |

The fork is intentionally ahead of upstream with RawEngine planning, governance, security, and dependency-security commits. Upstream syncs should happen through pull requests.

## Local Toolchain Observed

| Tool                    | Version                                 |
| ----------------------- | --------------------------------------- |
| Node.js                 | `v26.3.0`                               |
| npm                     | `11.16.0`                               |
| Rust                    | `rustc 1.92.0 (ded5c06cf 2025-12-08)`   |
| Cargo                   | `cargo 1.92.0 (344c4567c 2025-10-21)`   |
| Rustup active toolchain | `stable-aarch64-apple-darwin (default)` |

Notes:

- `src-tauri/Cargo.toml` declares `rust-version = "1.95"`, which is newer than the local Rust toolchain observed by `rustc --version`.
- `cargo check` invoked from `src-tauri` downloaded and used toolchain `1.95.0-aarch64-apple-darwin` during the Rust dependency validation pass.

## Frontend Package State

| Item                   | Value                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager lock   | `package-lock.json`                                                                                                                    |
| Lockfile version       | `3`                                                                                                                                    |
| `packageManager` field | Not set                                                                                                                                |
| Package scripts        | `dev`, `build`, `tauri`, `start`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `i18n:extract`, `i18n:check`, `i18n:lint` |

Key runtime dependencies:

- React `^19.2.6`
- React DOM `^19.2.6`
- Tauri API `^2.11.0`
- Tauri plugins for dialog, OS, process, and shell
- Vite `^8.0.12`
- TypeScript `^6.0.0`
- ESLint `^9.39.2`
- `typescript-eslint` `^8.59.3`
- Prettier `^3.8.3`
- Tailwind CSS `^4.3.0`
- `@clerk/react` `^6.6.2`
- `framer-motion` `^12.38.0`
- `konva` `^10.3.0`
- `lucide-react` `^1.14.0`
- `zustand` `^5.0.13`

Known frontend observations from early security validation:

- `npm ci` passed after the `js-cookie` security update.
- `npm audit` reported zero npm vulnerabilities after PR #2.
- `npm run build` passed after PR #2.
- `npm run typecheck` currently fails on existing project-wide TypeScript debt.
- `npm run lint` currently fails on existing project-wide lint debt.
- `npm run format:check` currently fails on existing formatting debt.

Detailed command capture and upstream debt issue creation belong to #16 and #19.

## Rust And Tauri State

Important `src-tauri/Cargo.toml` entries:

- Package name: `RapidRAW`
- Edition: `2024`
- Rust version: `1.95`
- Tauri: `2.11`
- Tauri build: `2.6`
- WGPU: `29.0`
- ORT: `=2.0.0-rc.10`
- Raw loader: `rawler` from `https://github.com/CyberTimon/RapidRAW-DngLab.git`
- macOS private API feature enabled through Tauri.
- Linux target dependencies include `gtk = "0.18.2"` and `webkit2gtk = "=2.0.2"`.

Rust security/dependency observations:

- `tar` was updated to `0.4.46` by PR #264, fixing GHSA-3pv8-6f4r-ffg2.
- `cargo tree -i tar` shows `tar v0.4.46` through `ort-sys -> ort -> RapidRAW`.
- `cargo check` passed from `src-tauri` after the `tar` update, with existing warnings in RapidRAW code.
- `glib v0.18.5` remains in the all-target Linux GTK/webkit dependency graph and is tracked by #262.
- `cargo update -p glib --precise 0.20.0 --dry-run` fails because `gtk 0.18.2` requires `glib ^0.18`.
- The `glib` alert is currently marked blocked because fixing it likely requires a Linux GTK/webkit/Tauri dependency strategy change, not a safe lockfile-only patch.

## Existing GitHub Workflows

Workflow files at snapshot:

- `.github/workflows/build.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/lint.yml`
- `.github/workflows/pr-ci.yml`
- `.github/workflows/release.yml`

Current workflow shape:

- `pr-ci.yml` runs the reusable build workflow on pull requests across Windows, macOS, Linux, and Android matrix entries.
- `ci.yml` runs the same build matrix on pushes to `main`.
- `release.yml` builds release assets on GitHub release creation.
- `lint.yml` runs frontend format, frontend lint, i18n check, cargo fmt, and cargo clippy.
- Frontend format, frontend lint, and i18n checks in `lint.yml` are currently marked `continue-on-error: true`; this does not meet the future RawEngine shift-left quality target.
- The build workflow uses Node `22` in GitHub Actions.
- The lint workflow uses Node `20` in GitHub Actions.
- The local observed Node version is `26.3.0`.

## Open Baseline Follow-Ups

- #16 should run and record the existing RapidRAW install, lint, typecheck, test, Rust, and build commands.
- #17 should create a minimal CI mirror of existing upstream commands before stricter gates are introduced.
- #18 should capture representative baseline screenshots and render outputs.
- #19 should create or update issues for upstream baseline failures found during #16 and #18.

## Snapshot Commands Used

```sh
git rev-parse HEAD
git fetch upstream main --depth=1
git rev-parse upstream/main
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
node -e '/* package.json and package-lock inspection */'
sed -n '1,150p' src-tauri/Cargo.toml
cargo tree -i tar
cargo tree -i glib --target all
find .github/workflows -maxdepth 1 -type f -print
```
