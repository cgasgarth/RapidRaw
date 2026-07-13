# Multiscale detail V1 ADR

Status: accepted for new edits; legacy behavior remains available.

## Decision

`multiscale_v1` uses a four-band, source-resolution-normalized Laplacian decomposition built from the renderer's existing 1, 3.5, 8, and 40 reference-pixel low-pass products. Bands are Finest (source−L1), Fine (L1−L3.5), Medium (L3.5−L8), and Coarse (L8−L40); L40 is the unchanged residual. Zero gains therefore reconstruct exactly without another pass. Effective radii scale by `min(target width, target height) / 1080`, and tile halo is the ceiling of the largest active radius.

The decomposition is computed once per source/geometry/target/device identity. Global and masked gains reuse it; gain-only changes do not change its identity. Default creative detail is AP1-luminance-oriented and reconstructs RGB by a shared luminance ratio, avoiding independent-channel hue rotation. An advanced chroma-detail control can mix at most 20% of bounded RGB-band detail while renormalizing AP1 luminance; its default is zero. Positive fine-band gains receive shadow/noise confidence gating. Explicit halo and ringing controls bound total luminance overshoot.

Sharpness maps 72/28% to Finest/Fine, Texture maps 60/40% to Fine/Medium, Clarity maps 68/32% to Medium/Coarse, and Structure maps to Coarse. These are versioned macros over the same bands, never separate high-pass applications. Capture preprocessing and output-recipe sharpening remain separate stages.

## Alternatives

- À trous wavelets offer strong shift invariance but require more intermediate surfaces and wider export halos for the current renderer.
- Guided and edge-aware pyramids reduce halos intrinsically but add parameter-dependent decomposition identity, complicating gain-only cache reuse.
- Anisotropic diffusion is flexible but iterative, more expensive, and harder to keep CPU/WGPU/tile deterministic.
- A conventional downsampled Laplacian pyramid is memory-efficient but introduces resampling phase and tile-boundary concerns.

The undecimated four-band Laplacian is the smallest vertical replacement that guarantees reconstruction, shares current WGPU resources, and permits a scalar reference. A later process version may replace the decomposition without changing legacy or V1 receipts.

## Compatibility and proof

Absent or `legacy_v1` settings execute the prior sharpness, clarity, and structure paths unchanged. Sidecars opt in explicitly and invalid settings are quarantined atomically. Required proof covers scalar identity/macro/protection limits, shader ABI and compilation, active-pass/cache behavior, global/local execution, save/reopen, and pixel-different RAW preview/export output.
