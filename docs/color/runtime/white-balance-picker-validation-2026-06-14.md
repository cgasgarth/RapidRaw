# White Balance Picker Validation

- Issue: #91 `color(wb): add white balance picker tests`
- Scope: runtime picker math extraction and fixture validation
- Status: implementation-backed validation

## Contract

The white balance picker samples a local RGB patch, converts the averaged sRGB
values to linear light, computes temperature and tint corrections, and clamps
the resulting sliders to the existing `-100..100` adjustment range.

The picker math is centralized in `src/utils/whiteBalancePicker.ts` so UI clicks
and validation fixtures exercise the same implementation path.

## Fixture Coverage

`fixtures/color/adjustments/white-balance-picker-fixtures.json` covers:

- neutral gray samples that leave sliders unchanged;
- blue-biased samples that produce a warm correction;
- warm magenta samples that clamp both sliders at the lower bound.

## Validation

Run:

```sh
bun run check:white-balance-picker
```

The check uses Zod schemas for fixture shape and picker input validation, then
compares computed temperature, tint, and diagnostic deltas against committed
expected values.
