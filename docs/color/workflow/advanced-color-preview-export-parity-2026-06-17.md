# Advanced Color Preview/Export Parity

Issue: #1336 `color(runtime): advanced editor preview/export parity audit`

Runtime status: one parity gap fixed. This slice promotes RGB Color Balance from
UI/TypeScript runtime proof into the shared GPU preview/export path. It does not
claim the full Capture One-class color workflow complete; that remains #1249.

## Current Advanced Color Status

| Surface              | Preview/export runtime status                         | Validation                                                                                    |
| -------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Curves               | GPU preview/export path                               | `check:color-abi`                                                                             |
| Levels               | GPU preview/export path                               | `check:levels-runtime`, `check:color-preview-export-parity`                                   |
| Channel Mixer        | GPU preview/export path                               | `check:channel-mixer`, `check:color-preview-export-parity`                                    |
| RGB Color Balance    | GPU preview/export path                               | `check:color-balance-rgb`, `check:color-preview-export-parity`                                |
| Black & White Mixer  | GPU preview/export path                               | `check:black-white-mixer`, `check:color-adjustment-abi-parity`                                |
| Selective Color      | Range/falloff/mask proof; not full GPU runtime parity | `check:selective-color-ranges`, `check:selective-color-falloff`, `check:selective-color-mask` |
| Skin Tone Uniformity | Fixture proof; not full GPU runtime parity            | `check:skin-tone-uniformity`                                                                  |

## Fixed Gap

Before this slice, RGB Color Balance had UI controls and TypeScript fixture
proof, but no `GlobalAdjustments` field or WGSL application in the shared
preview/export shader path. Preview and export therefore ignored the control.

This slice adds:

- `ColorBalanceRgbSettings` to Rust and WGSL adjustment structs;
- JSON parsing from `colorBalanceRgb`;
- `apply_color_balance_rgb` in WGSL, using the same shadow/midtone/highlight
  luma weighting and optional luminance preservation as the TypeScript runtime;
- CPU/GPU parity fixture coverage and shader-function hashing for the new WGSL
  function.
- a #1877 apply artifact report at
  `docs/validation/proofs/color/color-balance-rgb-apply-proof-2026-06-18.json` with
  tonal-region weights, applied offsets, and output deltas.

## Remaining Gaps

- Black & White Mixer now has GPU preview/export integration and a runtime
  apply artifact report.
- Selective Color needs full pixel-path parity beyond range/falloff fixtures.
- Skin Tone Uniformity needs runtime image proof against representative portrait
  fixtures.
- Final color workflow proof remains #1249.

## Validation

- `bun run check:color-balance-rgb`
- `bun run check:black-white-mixer`
- `bun run check:color-preview-export-parity`
- `bun run check:color-abi`
- `bun run check:types`
- `bun run check:lint -- src/utils/color/runtime/colorCpuGpuParity.ts tests/integration/checks/color/check-color-adjustment-abi-parity.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --features required-ci`
