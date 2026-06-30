# RapidRAW Script And CI Entrypoint Audit

- Audit date: 2026-06-10
- Issue: #20 `tooling(scripts): audit RapidRAW package scripts and CI entrypoints`
- Repository: `cgasgarth/RapidRaw`
- Baseline commit before this audit: `a4f408a`
- Last updated by: #22 `tooling(bun): migrate frontend CI install and script execution to Bun`

## Purpose

This document maps the current RapidRAW package scripts, config files, and
GitHub Actions entrypoints as RawEngine migrates frontend execution toward Bun
and tightens TypeScript, ESLint, hooks, and CI quality gates.

The audit is intentionally descriptive. Behavior-changing PRs should update it
when package management, workflow behavior, lint rules, TypeScript settings, or
Tauri build behavior changes.

## Package Manager State

| Item                    | Current value                   | Notes                                                        |
| ----------------------- | ------------------------------- | ------------------------------------------------------------ |
| `packageManager` field  | `bun@1.3.13`                    | Bun is the declared frontend package manager.                |
| Primary lockfile        | `bun.lock`                      | Bun text lockfile is the frontend CI source of truth.        |
| CI frontend install     | `bun install --frozen-lockfile` | Used by validation and reusable app-build paths.             |
| GitHub Actions Node use | None in project-authored steps  | Workflow helpers run through Bun instead of installing Node. |

## `package.json` Scripts

| Script            | Command                              | Current role                                                                                                             | Baseline status |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `dev`             | `vite`                               | Vite dev server used by Tauri `beforeDevCommand`.                                                                        | Serves on 1420. |
| `build`           | `vite build`                         | Frontend production build and Tauri `beforeBuild`.                                                                       | Passing.        |
| `tauri`           | `tauri`                              | Generic Tauri CLI passthrough.                                                                                           | Not gated.      |
| `start`           | `tauri dev`                          | Local desktop dev app entrypoint.                                                                                        | Not gated.      |
| `start:native-qa` | `bun scripts/start-native-qa-app.ts` | Builds and opens a uniquely named `RawEngine QA Current.app` bundle that Computer Use can attach to for native macOS QA. | Manual QA.      |
| `typecheck`       | `tsc --noEmit`                       | TypeScript validation.                                                                                                   | Failing, #283.  |
| `lint`            | `eslint .`                           | ESLint validation.                                                                                                       | Failing, #286.  |
| `lint:fix`        | `eslint . --fix`                     | Local lint autofix.                                                                                                      | Not gated.      |
| `format`          | `prettier --write .`                 | Whole-repo formatting write.                                                                                             | Not gated.      |
| `format:check`    | `prettier --check .`                 | Prettier validation.                                                                                                     | Failing, #289.  |
| `i18n:extract`    | `i18next-cli extract`                | Translation extraction write.                                                                                            | Not gated.      |
| `i18n:check`      | `i18next-cli extract --ci --dry-run` | Translation extraction drift check.                                                                                      | Passing.        |
| `i18n:lint`       | `i18next-cli lint`                   | Hardcoded-string scan.                                                                                                   | Failing, #285.  |

`package.json` does not currently define a single `check`, `check:quick`, test,
visual, fixture, or app-smoke command. Those should be added as explicit
contracts instead of making contributors memorize workflow internals.

## Frontend Config Entrypoints

| Config              | Used by                                  | Notes                                                                                              |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `vite.config.js`    | `dev`, `build`, Tauri                    | Dev server uses strict port `1420`; `TAURI_DEV_HOST` controls host/HMR.                            |
| `tsconfig.json`     | `typecheck`                              | `strict` and additional strict compiler options are enabled.                                       |
| `biome.json`        | `lint`, `lint:fix`, `format`             | Biome linting and formatting configuration.                                                        |
| `i18next.config.ts` | `i18n:*`                                 | Extracts `en`, `de`, `pl`, `zh-CN` strings from `src/**/*.{ts,tsx}`.                               |

Important current gaps:

- Some deeper architectural checks remain outside the fast lint gate and should
  be handled by focused feature or hardening PRs.

## Tauri And Vite Entrypoints

`src-tauri/tauri.conf.json` currently wires Tauri to npm scripts:

| Tauri field          | Current value           | Migration implication                      |
| -------------------- | ----------------------- | ------------------------------------------ |
| `beforeDevCommand`   | `bun run dev`           | Bun is the primary frontend script runner. |
| `devUrl`             | `http://localhost:1420` | Matches Vite server port.                  |
| `beforeBuildCommand` | `bun run build`         | Bun is the primary frontend script runner. |
| `frontendDist`       | `../dist`               | Produced by `vite build`.                  |

#18 recorded that the Vite browser surface currently loads but does not mount the
React app outside Tauri because `TitleBar` calls Tauri window APIs immediately.
The real visual harness is tracked by #292.

## Rust Entrypoints

| Command                                                                                           | Current role                   | Baseline status             |
| ------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------- |
| `cargo fmt -p RapidRAW -- --check`                                                                | Rust formatting check.         | Passing.                    |
| `cargo check --locked --no-default-features --features required-ci`                               | macOS Rust compile check.      | Passing.                    |
| `cargo clippy --locked --all-targets --no-default-features --features required-ci -- -D warnings` | Rust lint with warnings fatal. | Passing and blocking in CI. |
| `cargo test --locked --all-targets --no-default-features --features required-ci --no-fail-fast`   | macOS Rust test gate.          | Passing and blocking in CI. |

Rust commands are run from `src-tauri`. The package declares `rust-version =
"1.95"`, and GitHub Actions uses `actions-rust-lang/setup-rust-toolchain@v1`.
Required Rust checks use the explicit `required-ci` feature set; optional native
backend spikes must use separate manual or nightly lanes.

## GitHub Actions Entrypoints

| Workflow                        | Trigger                              | Primary entrypoints                                                                                                                                                                                                | Current gate behavior                                                                                                          |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/lint.yml`    | push to `main`, pull request, manual | `bun install --frozen-lockfile`, `bun run build`, `bun run i18n:check`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run i18n:lint`, `cargo fmt`, `cargo check`, `cargo clippy`, `cargo test` | Passing baseline commands are blocking; known debt commands are visible but non-blocking until #283/#285/#286/#287/#289 close. |
| `.github/workflows/pr-ci.yml`   | pull request                         | reusable `build.yml` with `macos-14`/`aarch64-apple-darwin`                                                                                                                                                        | Apple Silicon macOS app packaging is blocking.                                                                                 |
| `.github/workflows/build.yml`   | workflow call                        | `bun install --frozen-lockfile`, `rustup target add`, `tauri-apps/tauri-action`, Android `bun run tauri android build`                                                                                             | Reusable package build workflow.                                                                                               |
| `.github/workflows/ci.yml`      | push to `main`                       | reusable `build.yml` matrix for Windows, macOS, Linux, Android                                                                                                                                                     | Inherited full matrix still present.                                                                                           |
| `.github/workflows/release.yml` | GitHub release creation              | reusable `build.yml` matrix for Windows, macOS, Linux, Android                                                                                                                                                     | Release packaging matrix still inherited.                                                                                      |

## Workflow Findings

- Frontend CI and reusable app-build install paths now use
  `bun install --frozen-lockfile`.
- Frontend script execution in CI and Tauri config now uses `bun run ...`.
- Workflow helper scripts now run through Bun, including Android release asset
  version extraction and the inherited Android packaging command. Android matrix
  behavior remains deferred to #52.
- `pr-ci.yml` has been narrowed to Apple Silicon macOS for required PR app
  packaging. The inherited full platform matrix is deferred to #52.
- `ci.yml` and `release.yml` still contain inherited Windows, Intel macOS,
  Linux, and Android matrices. These should be reviewed before they become hard
  RawEngine quality gates.
- `ci.yml` and `release.yml` use `builds-args` in Windows matrix entries, while
  the reusable workflow call passes `build-args: ${{ matrix.args }}`. That means
  the Windows bundle args may not be passed as intended. Track this with the
  broader inherited matrix work (#52) unless it blocks a nearer CI issue.
- Reusable `build.yml` depends on `tauri-apps/tauri-action` pinned to a commit.
  That is good for reproducibility, but the comment says it follows a `dev`
  branch change for `assetNamePattern`. Revisit when release hardening starts.
- `build.yml` has `upload-artifacts` as an input but does not currently branch on
  it; artifact upload is controlled by release/mobile/platform conditions.

## Recommended Command Contracts

Future PRs should add named scripts so local and CI behavior can converge:

| Proposed command  | Purpose                                    | Related issue |
| ----------------- | ------------------------------------------ | ------------- |
| `check:quick`     | Fast local pre-commit/pre-push validation. | #38, #41      |
| `check`           | Full local PR mirror for ordinary changes. | #38           |
| `check:types`     | TypeScript-only validation.                | #23-#28, #283 |
| `lint`            | Biome lint validation.                     | #29-#37, #286 |
| `check:format`    | Formatting check.                          | #289          |
| `check:i18n`      | i18n extract and hardcoded-string checks.  | #285          |
| `check:rust`      | Rust fmt/check/clippy bundle.              | #43, #287     |
| `check:security`  | JS and Rust dependency vulnerability gate. | #44, #262     |
| `build:frontend`  | Frontend Vite production build.            | #288          |
| `build:app:macos` | macOS Tauri app package smoke.             | #52           |

## Bun Migration Notes

#21 established the package-manager baseline:

- `packageManager` points at Bun.
- `bun.lock` exists and is verified by CI.
- `package-lock.json` has been removed; `bun.lock` is the only frontend
  dependency lockfile.

#22 migrates compatible frontend CI install and script execution:

- Frontend validation jobs use `oven-sh/setup-bun@v2`.
- Frontend validation jobs install with `bun install --frozen-lockfile`.
- Frontend validation jobs execute package scripts with `bun run ...`.
- Tauri `beforeDevCommand` and `beforeBuildCommand` execute through Bun.
- Reusable package builds install frontend dependencies through Bun before
  Tauri packaging.
- Project-authored workflow helper scripts run through Bun instead of invoking
  `node` or `npx` directly.

## Follow-Up Tracking

- #21 and #22 own Bun package-manager and CI execution migration.
- #23-#28 own TypeScript compiler strictness.
- #29-#37 and #286 own ESLint hardening and current lint debt.
- #38-#41 own local check scripts and hooks.
- #42-#46 own CI quality, Rust, security, license, and docs gates.
- #52 owns inherited platform matrix review, including Intel macOS and the
  `builds-args`/`matrix.args` mismatch.
