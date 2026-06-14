# Super-Resolution Resolution Chart Fixture Manifest

- Date: 2026-06-13
- Issue: #201 `validation(sr): add resolution chart fixtures`
- Milestone: 13: Super-Resolution
- Scope: planned public fixture manifest entries for SR chart validation.

## Purpose

Super-resolution needs deterministic chart fixtures before any implementation
can claim professional detail improvement. This slice adds planned manifest
entries only. It does not add raster payloads, generators, downloads, CI jobs,
or quality thresholds.

## Planned Entries

The public fixture manifest now reserves these project-generated fixtures:

- `synthetic.sr.slanted-edge-mtf.v0`
- `synthetic.sr.radial-zone-plate.v0`
- `synthetic.sr.line-pair-nyquist.v0`
- `synthetic.sr.false-texture-flat-patch.v0`

Each entry is `status: "planned"` and `class: "synthetic"`. The entries are
safe for a public repository because they describe future project-generated
fixtures without committing image payloads.

## Required Activation Evidence

A future PR may promote an entry from `planned` only after it supplies:

- generator implementation or approved source acquisition;
- expected SHA-256 and size;
- dimensions, bit depth, color profile, and media type;
- chart metric thresholds;
- expected warning codes;
- validation command;
- reviewer sign-off.

## Chart Coverage

The planned set covers:

- slanted-edge MTF50/MTF30 measurement;
- radial and line-pair stress near Nyquist;
- diagonal/checkerboard/periodic aliasing behavior;
- flat/noise patch detection for invented texture.

This is not enough to validate SR alone. It must be paired with real-photo crop
fixtures, edge artifact review, texture preservation review, and memory/time
budget validation.

## Validation Commands

Required local checks for this slice:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
