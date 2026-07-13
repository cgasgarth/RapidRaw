# White Balance Runtime Validation

- Issues: #91, #5402
- Contract: `rapidraw.white_balance.v1`
- Status: runtime implementation with programmatic fixtures

## Runtime Contract

Technical white balance is stored as an illuminant, not a red/blue slider:

- modes: As Shot, Auto, Kelvin/Duv, chromaticity picker, and preset;
- coordinates: Kelvin, signed CIE 1960 UCS Duv, and CIE 1931 xy;
- adaptation: CAT16 compiled in `f64` to an AP1 scene-linear matrix;
- placement: the technical matrix is the first scene-linear shader color node;
- creative warmth/tint: a later node, including lossless migration of legacy
  `temperature` and `tint` sidecars.

The neutral picker uses the IEC sRGB transfer function, maps the sampled patch
to chromaticity, resolves its nearest Planckian CCT/Duv, and writes a typed
technical-WB command. Its receipt records coordinates, preview identity,
clipped channels, sample count, and confidence. Auto WB robustly rejects dark,
clipped, and saturated samples before estimating a median neutral.

Camera dual-illuminant interpolation uses the same physical model. It projects
the camera neutral implied by as-shot gains between the calibration matrices'
predicted white responses in log-chroma space; the former blue/red ratio CCT
authority is removed.

## Programmatic Proof

- TS fixtures cover A, D50, D55, D65, D75, off-locus Duv, identity, legacy
  migration, picker diagnostics, and clipped confidence.
- Rust tests cover CAT16/AP1 identity and finiteness, camera-neutral projection,
  invalid fail-safe behavior, robust Auto sample rejection, and typed receipts.
- The production WGSL ABI test and native shader construction cover the exact
  matrix carried by preview and export; both use `AllAdjustments` parsing.
- Adjustment fingerprints include the nested technical state, invalidating
  preview/export/thumbnail artifacts when illuminant identity changes.

Run focused proof with:

```sh
bun test tests/pure-ts/color/white-balance-illuminant.test.ts
bun tests/integration/checks/check-white-balance-picker-fixtures.ts
cargo test --manifest-path src-tauri/Cargo.toml --features required-ci,tauri-test,validation-harness white_balance --lib
```

Private Alaska RAW validation is runtime-only and writes reports outside the
repository. Source RAW files and generated artifacts must never be committed.
