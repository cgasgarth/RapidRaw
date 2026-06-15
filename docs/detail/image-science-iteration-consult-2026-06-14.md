# Image Science Iteration Consult

- Date: 2026-06-14
- ChatGPT project: RapidRaw
- Status: accepted as planning guidance; not runtime proof.
- Runtime status: advisory only. This document does not close deblur, denoise,
  sharpening, color-science, AI-denoise, or app-server runtime issues.

## Accepted Guidance

- Rank the science roadmap as color correctness first, noise model second,
  detail/sharpening separation third, AI denoise fourth, and deblur/lens
  deconvolution last.
- Treat each area as iterative: contract, deterministic fixtures, runtime
  implementation, preview/export parity, real-image proof, then threshold
  tightening.
- Use explicit maturity labels in issues and PRs: contracted, synthetic-proven,
  real-image-reviewed, runtime-apply-capable, and mature.
- Keep runtime feature issues open until the feature can process representative
  images end to end with preserved validation evidence.

## Area Guidance

Color science:

- Freeze a typed color-pipeline contract before tuning looks.
- Keep scene-linear math ahead of tone/gamut/output transforms.
- Add or tighten ColorChecker, gray-ramp, chromatic adaptation, preview/export
  parity, and DeltaE00 gates.
- Prove maturity with multiple cameras, illuminants, skin, saturated colors,
  shadow pushes, and tagged exports.

Denoise:

- Add a camera/ISO-aware Poisson-Gaussian noise model before deep runtime
  denoise claims.
- Separate hot-pixel repair, chroma denoise, luma denoise, demosaic behavior,
  and sharpening interactions.
- Use synthetic fixtures for early gates, then private real high-ISO crop
  ledgers for maturity.
- Track SNR/noise sigma reduction, edge MTF loss, chroma blotches, color drift,
  texture retention, and preview/export parity.

AI denoise:

- Start provenance-first: model id, model hash, input hash, output hash, tile
  size, overlap, compute backend, and runtime status.
- Prefer deterministic tiled residual-model proof before heavier transformer or
  generative approaches.
- Treat hallucination-prone denoise/deblur as advisory or explicitly creative
  until real-image proof supports a stronger claim.

Detail and sharpening:

- Keep capture sharpening, creative detail, wavelet/detail-by-scale, and output
  sharpening as separate operations.
- Gate halos, edge displacement, noise amplification, color drift, and
  export-size behavior separately.

Deblur and lens deconvolution:

- Start with known-PSF Wiener/Tikhonov or damped Richardson-Lucy references.
- Use lens/profile-gated center, mid-frame, and corner fixtures before any blind
  deblur claim.
- Avoid one-click "auto deblur" maturity claims until real handheld proof exists.
- Gate ringing, noise amplification, color edge displacement, tile edges, and
  preview/export parity.

App-server agent:

- Expose typed, auditable measurement, preview, dry-run apply, queue, compare,
  and provenance tools.
- Keep subjective look decisions, blind deblur, hallucination-prone AI recovery,
  and destructive replacements advisory or approval-gated.
- Route agent actions through the same command layer as the UI with dry-run,
  approval, cancellation, replay, and audit logs.

## Rejected Or Deferred

- Do not use display-space/sRGB math as the primary color pipeline.
- Do not close runtime quality issues with plan-only, schema-only, dry-run-only,
  or synthetic-only evidence.
- Do not use proprietary camera profiles, film looks, or Capture One/Adobe assets.
- Do not make diffusion/generative denoise or blind deblur the first trusted
  correction path.
- Do not let app-server tools bypass typed command schemas or provenance.
