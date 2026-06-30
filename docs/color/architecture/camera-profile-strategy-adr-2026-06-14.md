# ADR: Camera Profile Strategy

- Issue: #86 `color(adr): decide camera profile strategy`
- Status: accepted for next implementation phase
- Scope: architecture decision only; no runtime pixel changes

## Decision

RawEngine will treat camera profiles as an explicit RAW-input transform stage
that converts camera-space linear sensor RGB into `acescg_linear_v1`. Profile
application must stay separate from creative color edits, film looks,
negative-lab stock profiles, and display transforms.

The first implementation should support profile selection and provenance before
claiming rendered color accuracy:

- `embedded_dng_matrix`: DNG `ColorMatrix`/`ForwardMatrix`-style metadata when
  present and parsed.
- `raw_decoder_builtin`: camera profile or matrix supplied by the RAW decoder.
- `project_camera_profile`: user/project-selected profile with provenance.
- `generic_camera_profile`: documented fallback profile for known cameras.
- `unknown_camera_profile`: fallback state with stable warnings and no quality
  claim.

Every rendered RAW should record `camera_profile_id`, `camera_profile_source`,
`camera_profile_version`, `white_balance_source`, `cat_method`,
`working_space_id`, and warnings in sidecar, command, and validation artifacts.

## Pipeline Placement

Camera profiling runs before scene-referred editing:

1. RAW decode, black/white level normalization, and demosaic.
2. Camera-space linear RGB from the decoder.
3. White balance multipliers or neutral transform in camera/input space.
4. Camera profile transform into a profile connection or direct ACEScg basis.
5. Chromatic adaptation to ACEScg's white point when needed.
6. Conversion into `acescg_linear_v1`.
7. Scene-referred edit graph: exposure, tone, HSL, selective color, masks,
   layers, local contrast, detail, and scene-declared LUTs.
8. Scene-to-display transform and output/display profile conversion.

Negative Lab acquisition may also reference camera profiles, but those profiles
describe scan/copy-stand acquisition input. They must not be encoded in stock
profiles, process profiles, or creative presets.

## Profile Lookup Policy

Lookup should be deterministic and inspectable:

1. Explicit user/project profile.
2. Embedded DNG profile/matrix when valid.
3. RAW decoder camera profile or matrix.
4. Known camera alias table.
5. Documented generic camera fallback.
6. Unknown profile warning.

The existing camera-profile lookup fixture is the first metadata gate. It does
not prove rendered color until profile transforms, ColorChecker fixtures,
DeltaE metrics, and CPU/GPU parity exist.

## White Balance And CAT Policy

White balance and chromatic adaptation are profile-adjacent but distinct:

- White balance records source: `as_shot`, `auto`, `picker`, `manual_kelvin`,
  `camera_preset`, or `unknown`.
- Camera profile transforms must not silently include creative temperature/tint
  edits.
- Chromatic adaptation must use an explicit method identifier before any claim
  of profile-correct output.
- The first CAT implementation may use a conservative Bradford matrix at the
  profile-boundary adaptation step, but it must be named in artifacts and
  covered by neutral-patch tests before quality claims.

## UI, API, And Agent Policy

- UI should show profile source, confidence, and warnings in image metadata or
  color setup before exposing advanced profile overrides.
- API and app-server commands must pass profile choices through typed fields,
  not hidden preferences.
- Agent tools may propose a profile change in dry-run output, but applying a
  low-confidence or batch profile change requires explicit user approval.
- Imported presets and film simulations cannot change camera profile state
  unless they are explicit acquisition/profile commands.

## What Not To Implement Yet

- Do not reverse engineer Adobe, Capture One, or camera-manufacturer proprietary
  profile behavior.
- Do not claim Capture One/Lightroom-class color until measured fixtures and
  tolerance budgets exist.
- Do not add profile UI controls that cannot be replayed by commands.
- Do not treat AgX, film simulations, LUTs, or negative-lab stock mappings as
  camera profiles.
- Do not make display/profile proofing claims until macOS display-profile
  validation exists.

## Validation Gates

1. Lookup schema gate: profile-source enums, alias table, warnings, and sample
   artifacts validate with Zod or Rust schema tests.
2. Fixture metadata gate: representative RAW/DNG metadata resolves to stable
   profile decisions.
3. Transform unit gate: matrix/profile transforms produce deterministic
   reference values in CPU tests.
4. Neutral patch gate: camera neutral to profile connection to ACEScg keeps
   neutral patches within a documented tolerance.
5. ColorChecker gate: measured or legally usable target fixtures report DeltaE
   values before quality claims.
6. CPU/GPU parity gate: profile transform outputs match within per-operation
   tolerances.
7. Preview/export parity gate: profile ID and transform path match between
   preview and export for a representative recipe.
8. App-server replay gate: profile dry-run/apply commands roundtrip through the
   typed command log.

## Risks And Tradeoffs

- Open profile handling will not initially match proprietary editor rendering.
  The mitigation is honest provenance, fixture metrics, and iterative tuning.
- Profile metadata quality varies by camera and RAW format. The mitigation is
  stable warning codes and low-confidence fallback behavior.
- Camera profiling, negative-lab acquisition profiles, and creative looks can
  blur together. The mitigation is strict schema separation and command names.
- Full ICC/DCP support can expand quickly. The mitigation is a staged lookup
  and matrix-first implementation before broader profile ingestion.

## Follow-Up Work

- Add camera profile transform tests.
- Add ColorChecker fixture set and DeltaE harness.
- Add chromatic adaptation implementation plan.
- Add profile fields to command, sidecar, and artifact schemas.
- Add app-server dry-run/apply commands for profile changes.
- Add UI metadata readout before advanced profile override controls.

## Validation

- `bunx prettier --check docs/color/architecture/camera-profile-strategy-adr-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
