# ADR-NEG-004: Negative Lab API Command Surface

- Date: 2026-06-13
- Related issue: #269 `negative-lab(api): expose negative lab command surface`
- Status: proposed
- Scope: v1 typed command contracts, dry-run/apply boundaries, replay,
  provenance hooks, and schema validation for Negative Lab workflows.

## Context

RawEngine requires every meaningful edit surface to be API-callable, replayable,
undoable, and available to the future OpenAI app-server editing agent. Negative
Lab is a high-risk area because import classification, film-base sampling,
density-domain inversion, roll normalization, positive variant creation, and QC
can look like one workflow in the UI while needing separate contracts for
validation, batching, provenance, and safe dry-runs.

This ADR defines the first Negative Lab command surface without implementing
image processing, UI, or app-server tools. It builds on the density-domain
inversion ADR, input profile ADR, and schema package.

## Decision

Negative Lab v1 will expose strict Zod command envelopes for seven objective or
workflow commands:

| Command                             | Stage            | Purpose                                                     |
| ----------------------------------- | ---------------- | ----------------------------------------------------------- |
| `negativeLab.createSession`         | acquisition      | create a single-frame, roll, or contact-sheet session       |
| `negativeLab.updateBaseSamples`     | calibration      | add, replace, accept, reject, or remove base sample regions |
| `negativeLab.estimateBaseFog`       | calibration      | estimate base/fog values from accepted sample IDs           |
| `negativeLab.setConversionRecipe`   | inversion        | set a non-destructive density conversion recipe             |
| `negativeLab.planRollNormalization` | normalization    | produce a dry-run plan for objective roll synchronization   |
| `negativeLab.createPositiveVariant` | rendering bridge | create editable positive variants from conversion recipes   |
| `negativeLab.setFrameQcStatus`      | quality control  | record frame review state and warning acknowledgements      |
| `negativeLab.applyFrameCrop`        | frame handling   | accept, override, or reject replayable frame crop decisions |

Each command extends the generic `CommandEnvelopeV1` with a literal
`commandType` and strict typed `parameters`. Unknown command fields and unknown
parameter fields are rejected by schema validation. The generic envelope keeps
actor, target, approval, dry-run, graph revision, idempotency, and correlation
metadata consistent with the broader RawEngine command layer.

The v1 command surface also defines `NegativeLabDryRunResultV1`,
`NegativeLabApplyPlanRequestV1`, and `NegativeLabApplyResultV1` so tool registry
entries do not point at undocumented output names or accept arbitrary generic
apply payloads. These result schemas are intentionally compact: they capture
warnings, artifacts, numeric metrics, changed frame/session IDs, generated
positive variants, and provenance entry IDs without claiming final pixel math.

## Dry-Run And Apply Contract

Commands that mutate roll/session state or produce positive variants must
support dry-run before apply. Dry-run results should include:

- the command envelope that was evaluated;
- warnings added, removed, or escalated;
- expected roll/session field changes;
- preview or diagnostic artifact handles when available;
- numeric fixture metrics when the command touches pixels;
- provenance entries that would be written on apply.

Apply requests must reference a prior dry-run plan for risky mutation paths.
Apply results should reference the prior dry-run or record why no dry-run was
required. App-server tools must call the same command layer as UI controls, not
raw Tauri invokes, UI automation, or a broad command dispatcher that accepts any
arbitrary command envelope.

## Command Parameters

The first schema slice records only durable workflow and color-management
choices:

- input mode and pixel basis;
- process family;
- source file IDs and roll/session IDs;
- base sample region geometry and coordinate space;
- base/fog estimator policy;
- conversion algorithm ID and version;
- input characterization;
- base strategy;
- curve model;
- neutralization mode;
- output transform reference;
- output intent;
- frame IDs, anchor frame IDs, and base sample IDs;
- QC status and acknowledged warning codes.

Implementation-specific knobs, film-stock look parameters, GPU kernel options,
and UI layout state are explicitly deferred. They can be introduced as versioned
parameter objects after fixtures prove the behavior.

V1 command parameters accept only C-41 color negative and black-and-white silver
negative process families. Broader acquisition metadata may describe deferred
families, but executable v1 commands must reject them until their math,
fixtures, and warnings are defined.

## Color-Science Boundaries

`negativeLab.setConversionRecipe` owns objective inversion recipe parameters. It
must not hide creative rendering inside a stock preset or UI-only adjustment.
The v1 schema distinguishes:

- conversion model: algorithm ID, algorithm version, density maximum, epsilon
  policy, and negative-density tolerance;
- input characterization: channel basis and confidence;
- base strategy: existing estimate, manual samples, roll-shared base, or
  low-confidence profile default;
- curve model: monotonic process or parametric curve family;
- output transform reference: versioned output transform, intent, and chromatic
  adaptation policy;
- output intent: preview, editable positive, or export-oriented proof.

Creative film looks and stock-family presets belong in later render/profile
commands that consume converted positives or process-profile IDs. They do not
belong in the initial acquisition or inversion command.

## Provenance

Every Negative Lab command must be able to produce provenance entries. The
schema does not yet define the final provenance object, but command
implementations must preserve:

- source file and content hash references;
- acquisition profile ID;
- base sample IDs and geometry;
- command IDs and correlation IDs;
- dry-run/apply relationship;
- warning state;
- generated positive variant IDs and artifact handles.

The roll session stores command IDs and positive variant IDs so later UI,
batch, app-server, and export paths can reconstruct what happened.

## Validation

This schema PR must validate:

- TypeScript compile for the schema package;
- sample payload parsing for every schema;
- generated JSON sample artifact drift;
- unknown-field rejection for command parameters;
- repository unsafe-cast ban;
- formatting, docs, and actionlint checks.

Pixel fixtures, DeltaE thresholds, CPU/GPU parity, and golden positive renders
are required for implementation PRs that actually transform pixels. They are
out of scope for this command-surface PR.

## Deferred

- measured film-stock profiles;
- legal stock-name mapping and branding UI;
- real density conversion math;
- base/fog auto-detection;
- frame splitting and border detection;
- app-server tool adapters;
- Rust command execution and sidecar persistence;
- golden image tests.

## Consequences

The Negative Lab UI, batch processor, and future app-server agent can all target
the same command contract. The cost is that early schema PRs must be kept small
and validated carefully before image-processing work begins.
