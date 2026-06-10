# RapidRAW Script And CI Entrypoint Audit

- Audit date: 2026-06-10
- Issue: #20 `tooling(scripts): audit RapidRAW package scripts and CI entrypoints`
- Repository: `cgasgarth/RapidRaw`
- Baseline commit before this audit: `a4f408a`

## Purpose

This document maps the current RapidRAW package scripts, config files, and
GitHub Actions entrypoints before RawEngine migrates frontend execution toward
Bun and tightens TypeScript, ESLint, hooks, and CI quality gates.

The audit is intentionally descriptive. It does not change package management,
workflow behavior, lint rules, TypeScript settings, or Tauri build behavior.

## Package Manager State

| Item                    | Current value              | Notes                                      |
| ----------------------- | -------------------------- | ------------------------------------------ |
| `packageManager` field  | Not set                    | Must be decided before Bun CI hardening.   |
| Primary lockfile        | `package-lock.json`        | npm lockfile v3 is the only lockfile.      |
| Bun lockfile            | Not present                | Planned by #21/#22.                        |
| CI frontend install     | `npm ci` and `npm install` | Mixed between validation and build paths.  |
| GitHub Actions Node use | Node `22`                  | Used by validation and reusable app build. |

## `package.json` Scripts

| Script         | Command                              | Current role                                       | Baseline status |
| -------------- | ------------------------------------ | -------------------------------------------------- | --------------- |
| `dev`          | `vite`                               | Vite dev server used by Tauri `beforeDevCommand`.  | Serves on 1420. |
| `build`        | `vite build`                         | Frontend production build and Tauri `beforeBuild`. | Passing.        |
| `tauri`        | `tauri`                              | Generic Tauri CLI passthrough.                     | Not gated.      |
| `start`        | `tauri dev`                          | Local desktop dev app entrypoint.                  | Not gated.      |
| `typecheck`    | `tsc --noEmit`                       | TypeScript validation.                             | Failing, #283.  |
| `lint`         | `eslint .`                           | ESLint validation.                                 | Failing, #286.  |
| `lint:fix`     | `eslint . --fix`                     | Local lint autofix.                                | Not gated.      |
| `format`       | `prettier --write .`                 | Whole-repo formatting write.                       | Not gated.      |
| `format:check` | `prettier --check .`                 | Prettier validation.                               | Failing, #289.  |
| `i18n:extract` | `i18next-cli extract`                | Translation extraction write.                      | Not gated.      |
| `i18n:check`   | `i18next-cli extract --ci --dry-run` | Translation extraction drift check.                | Passing.        |
| `i18n:lint`    | `i18next-cli lint`                   | Hardcoded-string scan.                             | Failing, #285.  |

`package.json` does not currently define a single `check`, `check:quick`, test,
visual, fixture, or app-smoke command. Those should be added as explicit
contracts instead of making contributors memorize workflow internals.

## Frontend Config Entrypoints

| Config              | Used by                                         | Notes                                                                                      |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `vite.config.js`    | `dev`, `build`, Tauri                           | Dev server uses strict port `1420`; `TAURI_DEV_HOST` controls host/HMR.                    |
| `tsconfig.json`     | `typecheck`, ESLint future project-service work | `strict` is already enabled; additional strict options are planned in #24-#27.             |
| `eslint.config.js`  | `lint`, `lint:fix`                              | Flat config with JS recommended, TypeScript recommended, React plugin, and i18next plugin. |
| `i18next.config.ts` | `i18n:*`                                        | Extracts `en`, `de`, `pl`, `zh-CN` strings from `src/**/*.{ts,tsx}`.                       |

Important current gaps:

- ESLint is not yet type-aware through project service.
- React hooks, accessibility, import/boundary, async-safety, and zero-warning
  policies are not yet enforced.
- `format` and `format:check` are whole-repo commands; changed-file local hooks
  may need narrower wrappers to stay fast.

## Tauri And Vite Entrypoints

`src-tauri/tauri.conf.json` currently wires Tauri to npm scripts:

| Tauri field          | Current value           | Migration implication                        |
| -------------------- | ----------------------- | -------------------------------------------- |
| `beforeDevCommand`   | `npm run dev`           | Must move or adapt when Bun becomes primary. |
| `devUrl`             | `http://localhost:1420` | Matches Vite server port.                    |
| `beforeBuildCommand` | `npm run build`         | Must move or adapt when Bun becomes primary. |
| `frontendDist`       | `../dist`               | Produced by `vite build`.                    |

#18 recorded that the Vite browser surface currently loads but does not mount the
React app outside Tauri because `TitleBar` calls Tauri window APIs immediately.
The real visual harness is tracked by #292.

## Rust Entrypoints

| Command                                                    | Current role                   | Baseline status                            |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| `cargo fmt -p RapidRAW -- --check`                         | Rust formatting check.         | Passing.                                   |
| `cargo check`                                              | macOS Rust compile check.      | Passing.                                   |
| `cargo clippy --all-targets --all-features -- -D warnings` | Rust lint with warnings fatal. | Failing locally, non-blocking in CI, #287. |

Rust commands are run from `src-tauri`. The package declares `rust-version =
"1.95"`, and GitHub Actions uses `actions-rust-lang/setup-rust-toolchain@v1`.

## GitHub Actions Entrypoints

| Workflow                        | Trigger                              | Primary entrypoints                                                                                                                                                           | Current gate behavior                                                                                                          |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/lint.yml`    | push to `main`, pull request, manual | `npm ci`, `npm run build`, `npm run i18n:check`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run i18n:lint`, `cargo fmt`, `cargo check`, `cargo clippy` | Passing baseline commands are blocking; known debt commands are visible but non-blocking until #283/#285/#286/#287/#289 close. |
| `.github/workflows/pr-ci.yml`   | pull request                         | reusable `build.yml` with `macos-14`/`aarch64-apple-darwin`                                                                                                                   | Apple Silicon macOS app packaging is blocking.                                                                                 |
| `.github/workflows/build.yml`   | workflow call                        | `npm install`, `rustup target add`, `tauri-apps/tauri-action`, Android `npx tauri android build`                                                                              | Reusable package build workflow.                                                                                               |
| `.github/workflows/ci.yml`      | push to `main`                       | reusable `build.yml` matrix for Windows, macOS, Linux, Android                                                                                                                | Inherited full matrix still present.                                                                                           |
| `.github/workflows/release.yml` | GitHub release creation              | reusable `build.yml` matrix for Windows, macOS, Linux, Android                                                                                                                | Release packaging matrix still inherited.                                                                                      |

## Workflow Findings

- `lint.yml` now uses `npm ci`; `build.yml` still uses `npm install`.
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
| `check:lint`      | ESLint-only validation.                    | #29-#37, #286 |
| `check:format`    | Formatting check.                          | #289          |
| `check:i18n`      | i18n extract and hardcoded-string checks.  | #285          |
| `check:rust`      | Rust fmt/check/clippy bundle.              | #43, #287     |
| `build:frontend`  | Frontend Vite production build.            | #288          |
| `build:app:macos` | macOS Tauri app package smoke.             | #52           |

## Bun Migration Notes

Before #21/#22 change install or script execution:

- Decide and set the `packageManager` field.
- Generate and review a Bun lockfile without deleting `package-lock.json` until
  Bun CI is green.
- Keep Tauri `beforeDevCommand` and `beforeBuildCommand` aligned with whatever
  package manager is authoritative.
- Convert `build.yml`, `lint.yml`, `pr-ci.yml`, and local docs together so
  package-manager behavior is not split across npm and Bun.
- Preserve npm fallback only if explicitly documented as a transition path.

## Follow-Up Tracking

- #21 and #22 own Bun package-manager and CI execution migration.
- #23-#28 own TypeScript compiler strictness.
- #29-#37 and #286 own ESLint hardening and current lint debt.
- #38-#41 own local check scripts and hooks.
- #42-#46 own CI quality, Rust, security, license, and docs gates.
- #52 owns inherited platform matrix review, including Intel macOS and the
  `builds-args`/`matrix.args` mismatch.
