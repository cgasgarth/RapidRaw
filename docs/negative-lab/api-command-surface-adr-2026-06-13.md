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

Negative Lab v1 will expose strict Zod command envelopes for six objective or
workflow commands:

| Command                             | Stage            | Purpose                                                    |
| ----------------------------------- | ---------------- | ---------------------------------------------------------- |
| `negativeLab.createRollSession`     | acquisition      | create a roll/session from one or more source file records |
| `negativeLab.sampleFilmBase`        | calibration      | record film-base/rebate/leader sample regions              |
| `negativeLab.convertFrames`         | inversion        | dry-run or apply density-domain frame conversion           |
| `negativeLab.normalizeRoll`         | normalization    | synchronize objective exposure/balance across frames       |
| `negativeLab.createPositiveVariant` | rendering bridge | create editable positive variants from converted frames    |
| `negativeLab.updateFrameQc`         | quality control  | record frame review state and warning acknowledgements     |

Each command extends the generic `CommandEnvelopeV1` with a literal
`commandType` and strict typed `parameters`. Unknown command fields and unknown
parameter fields are rejected by schema validation. The generic envelope keeps
actor, target, approval, dry-run, graph revision, idempotency, and correlation
metadata consistent with the broader RawEngine command layer.

The v1 command surface also defines `NegativeLabDryRunResultV1` and
`NegativeLabApplyResultV1` so tool registry entries do not point at undocumented
output names. These result schemas are intentionally compact: they capture
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

Apply results should reference the prior dry-run or record why no dry-run was
required. App-server tools must call the same command layer as UI controls, not
raw Tauri invokes or UI automation.

## Command Parameters

The first schema slice records only durable workflow and color-management
choices:

- input mode and pixel basis;
- process family;
- source file IDs and roll/session IDs;
- base sample region geometry;
- density model;
- inversion method;
- target working space;
- output intent;
- frame IDs, anchor frame IDs, and base sample IDs;
- QC status and warning codes.

Implementation-specific knobs, film-stock look parameters, GPU kernel options,
and UI layout state are explicitly deferred. They can be introduced as versioned
parameter objects after fixtures prove the behavior.

## Color-Science Boundaries

`negativeLab.convertFrames` owns objective inversion parameters. It must not
hide creative rendering inside a stock preset or UI-only adjustment. The v1
schema distinguishes:

- density model: how scan RGB is interpreted for inversion;
- inversion method: how base/fog and channel inversion are selected;
- target working space: where editable positives are handed off;
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
