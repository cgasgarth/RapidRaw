# Super-Resolution Conservative Output Policy

- Date: 2026-06-13
- Issue: #198 `sr(policy): define conservative professional output policy`
- Milestone: 13: Super-Resolution
- Scope: policy gates for professional super-resolution output.

## Decision

RawEngine super-resolution must default to conservative professional output.
The default mode may improve sampling, reduce noise through multi-frame
agreement, and recover detail that is supported by aligned source evidence. It
must not invent subject detail, texture, text, pores, eyelashes, fabric weave,
license plates, product markings, or fine edges that are not supported by the
input frames.

Aggressive or model-based synthesis can be added later, but it must be an
explicitly selected mode with visible labeling, artifact provenance, and
separate validation. Professional defaults stay conservative even when a model
backend is available.

## Mode Contract

Super-resolution has three policy modes:

- `conservative`: professional default. Multi-image evidence is preferred.
  Single-image output is limited to interpolation, demosaic-aware resampling,
  denoise-aware sharpening, and detail preservation that does not synthesize new
  semantic content.
- `standard`: allows stronger reconstruction when registration confidence,
  source overlap, and texture evidence pass validation gates. It may use learned
  priors only when the output is labeled as reconstructed and when artifact
  review passes.
- `aggressive`: creative or restoration-oriented. It may hallucinate plausible
  detail only after explicit opt-in, must never be the default, and must carry
  model/backend provenance and warnings.

The UI, API, and app-server tools must expose the selected mode. A missing mode
must be interpreted as `conservative` for backward compatibility.

## Policy Decision Vocabulary

Dry-run and apply paths should use the same decision vocabulary:

- `accepted`: final render is allowed with the requested mode and scale.
- `accepted_with_warnings`: final render is allowed, but warnings must be shown
  in UI, API, sidecar, and app-server responses.
- `preview_only`: a preview can be rendered, but final output is blocked until
  the user changes settings or accepts a different mode.
- `blocked`: no output should be rendered because the result would be
  misleading, unbounded, or missing required provenance.

Warning and block codes must be stable enum-like values once introduced. UI text
can change, but agent tools, fixtures, and sidecars need durable codes for
replay and regression testing.

## Accept, Warn, And Block Rules

Conservative output is accepted only when:

- requested scale is within the current validated engine limit;
- every source image is readable and tied to a stable source reference;
- source edit graph revisions and RAW/default-processing assumptions are
  captured;
- multi-image alignment reaches the required confidence threshold, when more
  than one frame is used;
- output dimensions and memory estimate fit the configured budget;
- crop comparisons show no new semantic structures at 100 percent and 200
  percent review zoom;
- edge and texture review does not show zippering, double edges, checkerboard
  patterns, waxy texture, or model-like fabricated microdetail.

Conservative output should warn, but still allow preview, when:

- frame count is lower than the recommended count;
- source overlap is partial but useful;
- low-texture regions limit measurable improvement;
- motion or parallax may create local artifacts;
- high ISO noise may be amplified;
- the memory estimate is near the budget but below the blocking threshold.

Conservative output must block final render when:

- the requested scale exceeds validated limits;
- a lower conservative scale is available but the requested scale would require
  synthetic detail;
- source alignment confidence is below threshold;
- source graph revisions cannot be recorded;
- required source files, virtual copies, or sidecars are missing;
- predicted peak memory exceeds budget;
- artifact review detects hallucinated subject detail or misleading text/edge
  reconstruction;
- a model backend is required to produce the requested output but the request is
  still labeled `conservative`.

When possible, blocks should offer a safer downgrade: lower scale, fewer source
frames, preview-only output, or switching from aggressive/model-based output
back to conservative multi-image reconstruction.

## Derived Artifact Requirements

Super-resolution results are derived editable artifacts, not anonymous exports.
The artifact record must include:

- artifact ID, family `super_resolution`, schema version, and creation time;
- output artifact handle, dimensions, content hash, and storage kind;
- source image references, including image path, stable image ID when known,
  virtual-copy ID when present, source index, source role, and RAW defaults;
- source content hashes and source edit graph revisions once available;
- selected policy mode, scale factor, quality preference, and alignment mode;
- decision status, warning codes, block codes, and accepted downgrade settings
  when the user chose a safer alternative;
- engine ID, engine version, backend type, and model ID/version when a model is
  involved;
- dry-run plan ID/hash used for approval;
- alignment metrics, overlap coverage, rejected-frame list, and local confidence
  map handle when produced;
- validation summary, warning codes, and human review status;
- stale state and invalidation reasons.

Artifacts become stale when any source file, source sidecar, virtual copy,
source edit graph revision, scale factor, policy mode, alignment settings,
detail settings, engine version, model version, or output handle changes.

## Validation Gates

Every implementation PR that changes conservative output quality must provide
validation evidence. The minimum evidence set is:

- resolution chart fixture with source manifest, scale factor, output
  dimensions, 100 percent crops, and 200 percent crops;
- real-photo fixture with fine texture, edges, shadows, and low-detail regions;
- multi-image alignment report with confidence score, overlap coverage,
  rejected frames, and warning codes;
- edge artifact review covering high-contrast lines, diagonals, text, and
  repeating patterns;
- texture preservation review covering skin, hair, foliage, fabric, and product
  surfaces as applicable to the fixture;
- memory and time budget estimate plus observed runtime for the fixture machine;
- derived-artifact sidecar roundtrip proving provenance survives reload/save;
- API replay fixture proving dry-run and apply commands produce equivalent
  policy decisions.

Thresholds should be named in code and calibrated by fixtures. The first
implementation can begin with conservative named thresholds rather than claiming
universal numeric values, but every threshold must have fixture evidence and a
documented rationale before it gates final render.

Chart validation should favor measurable improvement without false confidence:
line pairs, slanted edges, and crops should show whether real sampling improves.
Real-photo validation should decide whether the result remains photographically
honest, not only whether it looks sharper.

## Fixture Provenance

Super-resolution fixtures must follow the same provenance discipline as
Negative Lab fixtures:

- every fixture needs a source manifest, license/rights status, allowed
  validation use, and claim eligibility;
- unknown-rights fixtures can be used only for private/manual exploration and
  must not be used for public quality claims or committed raster payloads;
- chart fixtures should document chart type, capture method, lens/camera
  metadata when known, lighting, and expected stress case;
- real-photo fixtures should state why the subject category matters for SR
  review, such as skin, hair, foliage, fabric, architecture, text, high ISO
  noise, or handheld motion.

## Chart Metrics

The first chart fixture set should include:

- slanted-edge MTF chart;
- Siemens star or radial zone plate;
- line-pair chart near Nyquist;
- checkerboard and diagonal edges;
- fine text;
- moire or aliasing stress pattern;
- flat/noise patch for invented texture detection.

Chart review should record:

- MTF50/MTF30 change versus baseline upscale;
- line-pair resolvability;
- false-detail rate beyond source support;
- ringing overshoot and undershoot;
- chroma/luma edge displacement;
- aliasing or moire amplification;
- texture/noise power-spectrum delta in flat regions.

Conservative SR must block when an apparent chart improvement is caused by
sharpening halos, ringing, aliasing, or invented periodic detail.

## Real-Photo Metrics

The first real-photo fixture set should include:

- skin and hair;
- foliage;
- fabric;
- architecture, text, or signage;
- wildlife fur or feathers when available;
- high-ISO/noisy images;
- handheld burst motion;
- tripod or pixel-shift-like shifted sequence;
- panorama-overlap SR case.

Real-photo fixtures are necessary perceptual gates, not standalone proof of
non-hallucination. They should catch failures that charts miss, while chart
fixtures carry the measurable false-detail burden.

## Memory And Runtime Policy

Super-resolution can exceed panorama memory because it may combine source
decodes, alignment fields, confidence maps, masks, and a larger output canvas.
Dry-run preflight must fail closed:

- `memoryBudgetRatio <= 0.70`: allow.
- `0.70 < memoryBudgetRatio <= 1.00`: warn; final apply must run as a
  background job.
- `memoryBudgetRatio > 1.00`: block final apply.

Preview/dry-run must not write durable derived artifacts. Full apply should
record estimated and actual runtime/peak memory once runtime measurement exists.
CI should begin with small deterministic fixtures; large SR performance fixtures
can start as nightly/manual until the runtime is stable enough for required CI.

## API And Agent Requirements

API tools must separate planning from mutation:

- dry-run returns policy mode, scale factor, estimated dimensions, memory/time
  estimates, alignment confidence, warning codes, and block reasons;
- apply requires an accepted dry-run plan hash for final output;
- final output records provenance and validation summary in the derived artifact;
- app-server tools must present warnings and block reasons directly to the
  agent instead of hiding them in logs;
- aggressive/model-based output requires an explicit mode field and cannot be
  invoked by omitting policy settings.

Agent-facing tools should prefer conservative mode unless the user explicitly
asks for creative restoration or generated detail.

## Risk Register

Future implementation PRs must avoid these failure modes:

- presenting model-generated detail as measured photographic detail;
- storing only the final raster without source provenance;
- allowing UI defaults and app-server defaults to diverge;
- changing warning or block codes without fixture updates;
- accepting a dry-run plan after source files, sidecars, virtual copies, edit
  graphs, engine versions, or model versions change;
- comparing only whole-image sharpness metrics while missing local artifacts;
- validating only chart fixtures and skipping real photographic texture;
- optimizing for preview speed in a way that hides final-render differences;
- permitting aggressive mode through a missing, unknown, or forward-compatible
  mode value;
- shipping a model-backed path without model ID, version, prompt/settings, and
  backend provenance.

## Deferred Work

This policy does not choose the final SR algorithm, OpenCV/Metal/backend stack,
model provider, or UI layout. Follow-up issues should implement:

- schema hardening so `aggressive_preview_only` cannot be applied as a final
  mutation (#1026);
- explicit single-image versus multi-image mode schemas;
- alignment and frame rejection strategy;
- detail reconstruction strategy;
- artifact schema extension for SR-specific metrics;
- resolution chart and real-photo fixture manifests;
- UI review flow for crop comparisons and warning decisions;
- app-server SR dry-run and apply tools;
- performance budget tests.

## Validation

Required local checks for this policy slice:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
