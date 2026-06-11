# Optional Platform Build Matrix

Issue: #52 `ci(matrix): add optional inherited platform build matrix`

RawEngine is macOS-first. Required PR validation uses the stable
`PR CI / required` aggregate gate, and full macOS package builds run on `main`.
Inherited RapidRAW platform rows for Windows, Linux, and Android are preserved as
manual, non-required signal through `.github/workflows/optional-platform-builds.yml`.

## Current Required Coverage

- PRs: `Baseline Validation` with `PR CI / required`.
- App-impacting PRs: `macOS app no-bundle smoke` is included in the aggregate
  gate by changed-path routing.
- `main`: `CI Build` runs macOS Apple Silicon and Intel package builds.

## Optional Rows

The optional matrix can be manually dispatched for:

- Windows x64 NSIS package
- Windows ARM64 NSIS package
- Ubuntu 22.04 x64
- Ubuntu 22.04 ARM64
- Ubuntu 24.04 x64
- Ubuntu 24.04 ARM64
- Android ARM64

These rows are not branch-protection requirements. They are intended to make
unsupported or currently slow inherited paths observable before any promotion to
required checks.

## Promotion Policy

Do not promote an optional row to required status until:

- the row is green on repeated manual or scheduled runs;
- artifact naming and failure diagnostics are understood;
- platform-specific dependency/security issues are triaged;
- `RAW_EDITOR_PLAN.md` and the relevant GitHub issue identify the new required
  gate and validation evidence.

## Known Follow-Ups

- Android Gradle caching should be added only after Android build behavior is
  stable enough to evaluate cache benefit.
- Linux GTK/WebKit dependency updates remain linked to the deferred Rust `glib`
  advisory work.
- Additional required platform coverage beyond macOS remains out of scope until
  RawEngine's macOS-first editor path is stable.
