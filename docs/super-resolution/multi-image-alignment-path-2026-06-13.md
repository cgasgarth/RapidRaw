# Super-Resolution Multi-Image Alignment Path

- Date: 2026-06-13
- Issue: #199 `sr(align): add multi-image alignment path`
- Milestone: 13: Super-Resolution
- Scope: first alignment contract for burst and shifted-frame
  super-resolution.

## Decision

RawEngine multi-image super-resolution should begin with a conservative
alignment path that estimates whether source frames can support a higher
resolution output before any detail reconstruction runs. Alignment is a
preflight gate, not an implementation detail hidden inside rendering.

The first path should support handheld bursts and tripod micro-shift sets. It
does not need to solve every panorama, parallax, rolling-shutter, subject-motion,
or model-based reconstruction case before the UI exists.

## Inputs

The alignment path consumes `computationalMerge.createSuperResolution` commands
with:

- every source using role `sr_frame`;
- stable `sourceIndex` values;
- source image paths and image IDs when known;
- virtual-copy IDs when present;
- RAW defaults and color-space hints;
- selected alignment mode;
- policy/detail mode and output scale.

The command should reject duplicate source indexes before any image loading.
Source ordering must be deterministic so dry-run, apply, and app-server replay
can compare plans.

## Alignment Modes

Mode behavior:

- `auto`: choose the safest validated mode from source geometry and preflight
  cost. The resolved mode must be recorded in the plan.
- `translation`: for tripod micro-shift or very small handheld movement with
  low rotation and low parallax.
- `homography`: for planar scenes or small viewpoint changes where global
  perspective is a better fit.
- `optical_flow`: for local handheld motion when the implementation can emit a
  confidence map and reject unreliable regions.
- `none`: preview-only comparison mode. It must not produce a conservative final
  render above 1x scale.

Conservative professional output should prefer `translation` or `homography`
when they explain the source set. `optical_flow` is allowed only when local
confidence, rejected regions, and artifact review are recorded.

## Preflight Stages

The dry-run path should produce these stages:

1. Source validation: source count, readability, stable refs, dimensions, RAW
   defaults, and virtual-copy identity.
2. Frame normalization: preview decode, shared orientation, lens correction
   policy, color-space assumptions, and exposure compatibility.
3. Feature/texture analysis: enough stable structure to estimate alignment and
   enough high-frequency texture to justify the requested scale.
4. Pairwise alignment: candidate transforms from each non-reference frame to
   the reference frame.
5. Frame rejection: exclude frames that reduce confidence or introduce motion
   artifacts.
6. Plan synthesis: selected reference frame, resolved alignment mode, accepted
   frames, rejected frames, confidence metrics, warning/block codes, memory
   estimate, and scale recommendation.

The dry-run plan hash must cover all settings that affect alignment decisions.

## Metrics

The plan should report:

- accepted frame count and rejected frame count;
- reference frame index;
- resolved alignment mode;
- global alignment confidence;
- overlap coverage ratio;
- expected detail gain ratio;
- rejected-frame reasons;
- local confidence map handle, when produced;
- motion/parallax risk;
- edge artifact risk;
- memory and runtime estimate.

These metrics should be available to UI, app-server tools, sidecars, and
validation fixtures.

## Accept, Warn, And Block Rules

Accept when:

- at least two frames survive rejection;
- alignment confidence meets the conservative threshold;
- overlap covers the output crop needed for the requested scale;
- expected detail gain supports the requested scale;
- predicted memory fits the budget.

Warn when:

- only the minimum frame count survives;
- alignment is strong globally but weak in local regions;
- expected detail gain is below the user-requested scale but above a safer
  downgrade scale;
- motion/parallax risk is present but contained;
- preview alignment may differ from final full-resolution alignment.

Block final conservative render when:

- fewer than two frames survive rejection;
- `none` is selected above 1x;
- confidence is below threshold;
- expected detail gain is insufficient and no safer downgrade is accepted;
- local confidence maps show large unreliable regions;
- source files or source edit graph revisions cannot be captured;
- memory estimate exceeds budget.

## Validation

Required validation for the first implementation:

- synthetic translated frame pair;
- synthetic rotated/perspective pair;
- handheld burst real-photo fixture;
- tripod micro-shift fixture when available;
- rejected-frame fixture with one bad frame;
- low-texture fixture that warns or blocks correctly;
- dry-run/apply replay showing the same accepted/rejected frame set;
- sidecar roundtrip preserving resolved alignment mode and metrics.

Each fixture should include source manifest, selected mode, resolved mode,
accepted/rejected frames, output scale, 100 percent crop, 200 percent crop,
warning/block codes, and memory estimate.

## Deferred Work

This contract does not implement final detail reconstruction, local optical-flow
blending, model-based SR, UI crop review, or GPU acceleration. Those belong in
the detail reconstruction, fixture, UI, and API follow-up issues.

## Validation Commands

Required local checks for this slice:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
