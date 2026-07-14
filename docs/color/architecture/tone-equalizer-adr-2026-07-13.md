# Scene-referred tone equalizer ADR

Status: accepted for edit-graph process V2. Issue: [#5408](https://github.com/cgasgarth/RapidRaw/issues/5408).

## Decision

RapidRaw V2 uses one nine-zone, scene-linear tone equation for advanced zone edits and the familiar Brightness, Contrast, Highlights, Shadows, Whites, and Blacks controls. V1 sidecars retain the legacy Basic path until the user explicitly edits a V2-only control.

The coordinate is AP1 luminance expressed in stops around the view's declared middle grey:

```text
EV = log2(max(AP1_luminance(scene_rgb), 1e-8) / middle_grey)
```

Negative and effectively black coordinates are identity. Applying a zone offset scales all RGB channels by the same `2^offset`, preserving neutral and chromatic relationships without an output-domain clamp.

## Bands and Basic macros

V1 fixes nine Gaussian/RBF centers at `[-8, -6, …, +8] EV`, scaled around a persisted pivot and range. Normalized weights form a partition of unity; band values and their combined result are bounded to ±4 stops.

Basic controls compile into deterministic support curves over those same bands. Blacks and Whites emphasize the two ends; Shadows and Highlights emphasize lower- and upper-middle zones; Contrast is symmetric around pivot; Brightness has broad midtone support. Advanced values add to the compiled macro curve once—there is no second Basic tone pass in V2.

## Guidance, caching, and local layers

A separable Gaussian scene-luminance surface supplies large-radius guidance. Edge refinement blends the filtered EV coordinate back toward source EV according to local source/guidance disagreement, limiting cross-edge halos while retaining smooth large-area control. CPU and WGPU use the same radius, coordinate, and equation.

Guidance identity depends on source, geometry, process version, and bounded radius—not band values. Band-only interaction therefore reuses the blur graph. Local layers reuse the same guidance surface and blend their band and macro parameters by the authoritative mask influence. Tile halo is the largest active global/local guidance radius, capped at 64 pixels at the reference scale.

## Auto placement, picker, and diagnostics

Auto Place analyzes a bounded scene-linear thumbnail with robust 1st/99th percentiles and a median pivot. Raster inputs are decoded from sRGB before analysis. Results and picker samples carry exact source identity/fingerprint plus graph revision/fingerprint; stale results are discarded.

The picker samples the same f16-rounded Gaussian guidance as rendering. A click selects the strongest contributing band; vertical drag distributes one committed EV delta through all nine authoritative weights. Diagnostics expose zone false color, selected-band weight, source-versus-filtered maps, and source black/highlight clipping.

## Validation contract

Completion requires mathematical identity/continuity/weight tests, bounded corrupt-state parsing, persisted-schema tests, UI interaction tests, exact point/full-surface Gaussian equivalence, CPU/Metal stage and full global/local/LUT parity, cache-identity and tile-halo tests, plus visible RAW preview/export validation. Private RAW inputs and generated artifacts are never committed.
