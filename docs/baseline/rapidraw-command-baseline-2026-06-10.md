# RapidRAW Command Baseline

- Snapshot date: 2026-06-10
- Issue: #16 `baseline(build): run existing RapidRAW install lint test and build commands`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw`
- Baseline commit: `ab11a91`

## Purpose

This document records the command-level state of the RapidRAW fork before RawEngine
starts changing lint, type, build, and CI behavior. It is intentionally factual:
passing commands are candidates for immediate quality gates, failing commands are
tracked as debt, and warnings are turned into explicit follow-up work instead of
being hidden in terminal output.

## Command Summary

| Command                                                    | Directory   | Result | Notes                                              | Follow-up |
| ---------------------------------------------------------- | ----------- | ------ | -------------------------------------------------- | --------- |
| `npm ci`                                                   | repo root   | Pass   | Installed 402 packages, audited 403, 0 vulns       |           |
| `npm run build`                                            | repo root   | Pass   | Vite build succeeds with large chunk warning       | #288      |
| `npm run typecheck`                                        | repo root   | Fail   | Existing TypeScript compiler debt                  | #283      |
| `npm run lint`                                             | repo root   | Fail   | Existing ESLint debt: 858 reported problems        | #286      |
| `npm run format:check`                                     | repo root   | Fail   | Existing Prettier debt in 17 files                 | #289      |
| `npm run i18n:check`                                       | repo root   | Pass   | Translation extraction dry-run succeeds            |           |
| `npm run i18n:lint`                                        | repo root   | Fail   | Existing hardcoded-string debt: 36 reported issues | #285      |
| `cargo fmt -p RapidRAW -- --check`                         | `src-tauri` | Pass   | Rust formatting is currently clean                 |           |
| `cargo check`                                              | `src-tauri` | Pass   | Build check passes with 17 warnings                | #287      |
| `cargo clippy --all-targets --all-features -- -D warnings` | `src-tauri` | Fail   | Current warnings become 19 hard failures           | #287      |

`package.json` does not define a frontend `test` script at this baseline. Test
coverage work should add explicit scripts before CI treats frontend tests as a
required gate.

## Frontend Install

Command:

```sh
npm ci
```

Result: pass.

Observed output:

- 402 packages installed.
- 403 packages audited.
- `npm audit` found 0 vulnerabilities.
- npm warned that install scripts for `@swc/core`, `esbuild`, and `fsevents`
  were not run until explicitly approved.

This is a usable install baseline, but RawEngine should still move toward Bun
support as planned in #21 and #22.

## Frontend Build

Command:

```sh
npm run build
```

Result: pass.

Observed output:

- Vite completed the production build.
- Generated assets included:
  - `dist/index.html`
  - `dist/assets/index-BUZ59h1y.css`
  - `dist/assets/index-D_k3vgVg.js`
- Vite warned that some chunks are larger than 500 kB after minification.
- Node emitted `[DEP0205] DeprecationWarning: The punycode module is deprecated`.

Follow-up #288 tracks the first bundle-size policy decision so build warnings do
not become invisible background noise.

## TypeScript

Command:

```sh
npm run typecheck
```

Result: fail, exit code 2.

Representative failure categories:

- Implicit `any` and type inference gaps in editor components such as
  `Curves.tsx`.
- Typed i18next key mismatches.
- `Uint8Array<ArrayBufferLike>` values not assignable to `BlobPart` in collage
  and preset code paths.
- `ButtonProps` missing a `tabIndex` prop used by `ConfirmModal.tsx`.
- Missing declarations for `react-image-crop` and
  `react-image-crop/dist/ReactCrop.css`.
- Nullable and undefined settings mismatches across editor, image canvas,
  library, mask, and metadata code paths.
- `import.meta` rejected in a CommonJS output context in `frontendLogBridge.ts`.

Follow-up #283 tracks making `npm run typecheck` pass before stricter TypeScript
compiler options are enabled.

## ESLint

Command:

```sh
npm run lint
```

Result: fail, exit code 1.

Observed output:

- 858 total problems.
- 813 errors.
- 45 warnings.

Dominant failure categories:

- `@typescript-eslint/no-explicit-any`.
- `prefer-const`.
- `@typescript-eslint/no-unsafe-function-type`.
- Unused variables and imports.
- One `i18next/no-literal-string` issue in `src/window/TitleBar.tsx`.

Follow-up #286 tracks bringing the current lint baseline to zero before
warnings are made fatal and stricter type-aware rules are added.

## Prettier

Command:

```sh
npm run format:check
```

Result: fail, exit code 1.

Prettier reported formatting differences in 17 files:

- `.github/ISSUE_TEMPLATE/bug_template.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/pull_request_template.md`
- `index.html`
- `packaging/cargo-sources.json`
- `packaging/node-sources.json`
- `RAW_EDITOR_PLAN.md`
- `src/components/panel/editor/overlays/CompositionOverlays.tsx`
- `src/components/ui/GlobalTooltip.tsx`
- `src/hooks/useAppInitialization.ts`
- `src/hooks/useExportSettings.ts`
- `src/styles.css`
- `src/utils/CollageVariants.tsx`
- `src/utils/frontendLogBridge.ts`
- `src/utils/mask/maskUtils.ts`
- `tsconfig.json`

Follow-up #289 tracks a behavior-preserving formatting PR.

## i18n

Command:

```sh
npm run i18n:check
```

Result: pass.

Command:

```sh
npm run i18n:lint
```

Result: fail, exit code 1.

Observed output:

- 36 potential hardcoded-string issues.

Representative locations:

- `src/window/TitleBar.tsx`: close, minimize, maximize, and `RapidRAW` labels.
- `SettingsPanel.tsx`: technical/provider names such as `rawler`, `lensfun`,
  `NegPy`, `LaMa`, `SAM 2`, and `U-2-Net`.
- Preview labels across editing modals, including `Transform Preview`,
  `Stitched Panorama`, `Source preview`, `Preview`, `Lens Correction Preview`,
  `Merged HDR`, `Denoised`, `Original`, and `Selected preview`.

Follow-up #285 tracks making i18n lint pass while preserving correct handling for
product names, model names, and non-translatable technical tokens.

## Rust Format And Check

Command:

```sh
cargo fmt -p RapidRAW -- --check
```

Result: pass.

Command:

```sh
cargo check
```

Result: pass.

Observed output:

- `RapidRAW` compiled successfully from `src-tauri`.
- The build script found an existing valid ONNX Runtime library and skipped
  download.
- Rust emitted 17 warnings.

Representative warning categories:

- `unexpected_cfgs` warnings from the Objective-C `msg_send!` macro in
  `src/window_customizer.rs`.
- Unused `mut` bindings and an unused `saved_state` in `src/lib.rs`.
- Direct cast of a function item into an integer for the SIGABRT handler.

## Rust Clippy

Command:

```sh
cargo clippy --all-targets --all-features -- -D warnings
```

Result: fail, exit code 101.

Observed output:

- 19 errors were reported before compilation stopped.
- The same Objective-C macro `unexpected_cfgs` warnings become hard failures
  under `-D warnings`.
- Additional hard failures include unused `mut` bindings, an unused
  `saved_state`, collapsible nested `if` statements in macOS file-open handling,
  and the SIGABRT handler function cast.

Follow-up #287 tracks making Rust Clippy pass with warnings denied and without
weakening lint policy globally.

## Baseline Debt Issues Created

- #283 `validation(types): fix current RapidRAW typecheck failures`
- #285 `validation(i18n): fix current hardcoded-string lint failures`
- #286 `validation(lint): fix current RapidRAW ESLint failures`
- #287 `validation(rust): fix current cargo clippy warnings-as-errors failures`
- #288 `validation(build): define Vite bundle budget for current large chunks`
- #289 `validation(format): normalize current RapidRAW Prettier failures`

These issues are assigned to milestone `1: Shift-Left Quality Foundation`
because they block turning the existing commands into strict required gates.

## Immediate Gate Recommendation

Safe to enforce after this baseline:

- `npm ci`
- `npm run build`, with the current large-chunk warning tracked by #288.
- `npm run i18n:check`
- `cargo fmt -p RapidRAW -- --check`
- `cargo check`, with current warnings tracked by #287.

Not safe to enforce as required yet at the initial baseline capture:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run i18n:lint`
- `cargo clippy --all-targets --all-features -- -D warnings`

The non-enforceable commands should still run in CI as visible, non-blocking
baseline jobs until their follow-up issues are closed. Follow-up hardening
removed the temporary frontend `continue-on-error` wrappers after typecheck,
format, and i18n lint became clean.
