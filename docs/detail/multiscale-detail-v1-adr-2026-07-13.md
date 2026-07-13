# Multiscale detail V1 ADR

Status: accepted for new edits; legacy behavior remains available.

## Decision

`multiscale_v1` uses a four-band, source-resolution-normalized Laplacian decomposition built from the renderer's existing 1, 3.5, 8, and 40 reference-pixel low-pass products. Bands are Finest (source−L1), Fine (L1−L3.5), Medium (L3.5−L8), and Coarse (L8−L40); L40 is the unchanged residual. Zero gains therefore reconstruct exactly without another pass. Effective radii scale by `min(target width, target height) / 1080`, and tile halo is the ceiling of the largest active radius.

The decomposition is computed once per source/geometry/target/device identity. Global and masked gains reuse it; gain-only changes do not change its identity. Default creative detail is AP1-luminance-oriented and reconstructs RGB by a shared luminance ratio, avoiding independent-channel hue rotation. An advanced chroma-detail control can mix at most 20% of bounded RGB-band detail while renormalizing AP1 luminance; its default is zero. Positive Finest, Fine, and Medium gains receive shadow/noise confidence gating. Explicit halo and ringing controls bound total luminance overshoot.

Sharpness maps 72/28% to Finest/Fine, Texture maps 60/40% to Fine/Medium, Clarity maps 68/32% to Medium/Coarse, and Structure maps to Coarse. These are versioned macros over the same bands, never separate high-pass applications. Capture preprocessing, creative detail, and output-recipe sharpening have distinct placement identities: `capture_correction_detail_v1` after highlight reconstruction, `creative_multiscale_detail_v1` after primary denoise, and recipe-bound `output_sharpen_after_resize_v1` after final resize. Placement validation rejects reused identities, zero targets, or ambiguous anchors.

The CPU implementation uses the same separable Gaussian kernel, radius rounding, RGBA16F rounding boundary, AP1 coefficients, gain mapping, confidence model, and chroma reconstruction as WGSL. Its halo-aware tiled executor compiles radii from the full target and extracts the largest-radius neighborhood around every tile, so the retained tile interiors match the untiled result without seams.

## Alternatives

- À trous wavelets offer strong shift invariance but require more intermediate surfaces and wider export halos for the current renderer.
- Guided and edge-aware pyramids reduce halos intrinsically but add parameter-dependent decomposition identity, complicating gain-only cache reuse.
- Anisotropic diffusion is flexible but iterative, more expensive, and harder to keep CPU/WGPU/tile deterministic.
- A conventional downsampled Laplacian pyramid is memory-efficient but introduces resampling phase and tile-boundary concerns.

The undecimated four-band Laplacian is the smallest vertical replacement that guarantees reconstruction, shares current WGPU resources, and permits a scalar reference. A later process version may replace the decomposition without changing legacy or V1 receipts.

## Compatibility and proof

Absent or `legacy_v1` settings execute the prior sharpness, clarity, and structure paths unchanged. Sidecars opt in explicitly and invalid settings are quarantined atomically. Programmatic coverage includes scalar and RGB identity, impulse/ramp/checker/star/slanted-edge/frequency fixtures, numeric halo/noise/chroma bounds, CPU tiled seam equality, shader ABI and compilation, active-pass/cache behavior, and global/local WGPU execution.

The private Alaska RAW gate decodes `_DSC7505.ARW` through the production loader and writes ignored neutral, legacy, and multiscale TIFFs plus a numeric report. The 1200×800 proof changed 1.651% of evaluated pixels while reducing mean shadow-flat delta from 7.57257 legacy code values to 0.000163 and strong-edge delta from 159.7417 to 16.5791; distinct output hashes and the unchanged source hash are asserted. These artifacts are local-only and are never committed. Final completion still requires the same process identity through corrected app preview and export after its typed-graph dependency lands.
