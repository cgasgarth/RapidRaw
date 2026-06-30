# Negative Lab Base Sampling Controls

- Date: 2026-06-13
- Issue: #152 `negative-lab(base): add film base sampling controls`
- Scope: schema and command contract for accepted/rejected base samples,
  base/fog estimates, and UI/app-server control surfaces.

## Purpose

Film base and fog sampling is calibration, not creative editing. A bad base
estimate can make a negative conversion look plausible while hiding clipped
channels, uneven illumination, lab correction, or invalid roll normalization.

The first contract records base sample regions, accepted/rejected sample state,
per-channel statistics, and base/fog estimates before renderer or polished UI
work depends on them.

## Schema Surface

This PR adds:

- `NegativeLabBaseSampleRecordV1`
- `NegativeLabBaseSampleStatusV1`
- `NegativeLabBaseSampleRejectionReasonV1`
- `NegativeLabBaseSampleChannelStatsV1`
- `NegativeLabBaseSampleStatsV1`
- `NegativeLabBaseFogEstimateV1`
- sample artifact
  `packages/rawengine-schema/samples/negative-lab-base-sample-record-v1.json`
- sample artifact
  `packages/rawengine-schema/samples/negative-lab-base-fog-estimate-v1.json`

The existing `negativeLab.updateBaseSamples` command can optionally carry
sample records, and rejecting samples now requires a rejection reason. The
existing `negativeLab.estimateBaseFog` command rejects duplicate source sample
IDs and frame-scoped estimates that select more than one frame.

## Base Sample Records

A base sample record captures:

- sample ID;
- frame ID and geometry;
- role: base/fog, rebate, leader, or manual neutral reference;
- scope: frame, roll, or selected frames;
- status: candidate, accepted, or rejected;
- rejection reason, when rejected;
- confidence;
- per-channel statistics for accepted samples;
- warning codes;
- measurement timestamp.

Accepted samples require measured channel statistics. Rejected samples require
a rejection reason. Candidate and accepted samples cannot carry a rejection
reason.

## Base/Fog Estimates

A base/fog estimate captures:

- estimate ID;
- algorithm ID/version;
- estimator statistic and outlier policy;
- base RGB values;
- base density values;
- source accepted sample IDs;
- rejected sample IDs;
- frame selection and scope;
- confidence;
- warning codes;
- estimate timestamp.

Estimates reject duplicate source IDs, duplicate rejected IDs, overlap between
source and rejected IDs, and frame-scoped estimates that do not select exactly
one frame. High-confidence estimates cannot include confidence-lowering warning
codes such as clipped base channel, uneven illumination, low acquisition
confidence, or missing visible base.

## UI Controls

The first UI should expose:

- add base sample;
- accept sample;
- reject sample with required reason;
- remove sample;
- switch sample scope between frame, roll, and selected frames;
- show base RGB and density readouts;
- show clipping fraction and confidence;
- estimate base/fog from accepted samples;
- choose frame, roll, or selected-frame estimator scope;
- choose median or trimmed mean;
- choose MAD or no outlier policy.

Sample geometry should remain visible as overlays in the frame viewer and in QC
proof artifacts. Rejected samples should remain inspectable so a user can
understand why a roll estimate ignored them.

## App-Server Behavior

App-server tools should treat base sampling as a dry-run-first calibration
surface:

- preview sample acceptance and rejection before mutating session state;
- return rejected sample reasons and warnings;
- return base/fog estimates as typed artifacts or dry-run metrics;
- require explicit apply of the dry-run plan before positive variants use a new
  estimate;
- include base sample IDs and estimate IDs in positive variant provenance.

Agent tools should not silently auto-select base regions until confidence gates
and fixture-backed validation exist.

## Validation Rules

The schema checks reject:

- accepted samples without channel stats;
- rejected samples without reasons;
- repeated sample IDs in update commands;
- duplicate estimate source sample IDs;
- rejected samples reused as estimate source samples;
- high-confidence estimates carrying confidence-lowering warnings;
- frame-scoped estimates selecting multiple frames.

Future renderer tests should add synthetic fixtures for:

- median base estimate from known RGB values;
- rejected outlier exclusion;
- clipped base channel warning stability;
- uneven illumination warning stability;
- frame versus roll-scoped estimate replay.

## Deferred

Deferred from this PR:

- automatic base/fog detection;
- pixel sampling implementation;
- Rust base estimator;
- overlay rendering;
- screenshot tests;
- measured film-stock claims;
- exact named-stock profile authoring.

Those should land only after synthetic fixture gates can prove deterministic
base/fog behavior.
