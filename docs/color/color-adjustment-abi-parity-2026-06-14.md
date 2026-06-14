# Color Adjustment ABI Parity

RawEngine sends `AllAdjustments` from Rust into the WGPU shader as a storage
buffer. The Rust `repr(C)` structs and the WGSL structs must stay in the same
field order with the same field types or color operations can silently read the
wrong values.

`bun run check:color-abi` compares these Rust and WGSL structs:

- `Point`
- `HslColor`
- `ColorGradeSettings`
- `ColorCalibrationSettings`
- `GlobalAdjustments`
- `MaskAdjustments`
- `AllAdjustments`

The check is intentionally fast and is included in `check:quick`. It validates
the CPU-to-GPU adjustment contract for core color controls such as exposure,
contrast, HSL, curves, color grading, color calibration, tonemapper mode, and
mask-local adjustments.

This is ABI parity validation. It does not replace rendered image CPU/GPU pixel
parity tests, which still need live GPU output fixtures.
