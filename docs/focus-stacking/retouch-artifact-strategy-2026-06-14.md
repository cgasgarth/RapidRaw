# Focus Stack Retouch Artifact Strategy

Date: 2026-06-14
Scope: GitHub issue #191, focus stack retouch artifact strategy

## Purpose

Focus stacks need retouch support because automated alignment, sharpness maps,
and blends can leave ambiguous edges, parallax defects, or local source-choice
errors. Retouch must be non-destructive, provenance-backed, and reviewable by
both the UI and future agent tools.

## Retouch Layer Model

A focus stack retouch layer is an editable artifact linked to an accepted dry
run and final focus stack artifact. It should store:

- layer artifact handle;
- source candidate indexes;
- localized mask regions;
- reason codes;
- before/after preview handles;
- source graph revision and content hashes;
- operator or agent provenance;
- whether the retouch was suggested, accepted, edited, or rejected.

The final focus stack output may reference the retouch layer, but the retouch
layer must remain separately inspectable and removable.

## Retouch Triggers

Generate retouch seeds when:

- sharpness-map confidence is low near visible detail;
- alignment confidence drops near an edge;
- parallax risk is medium or high;
- source winner transitions create halo risk;
- rejected-source decisions affect local detail;
- user or agent requests manual review;
- blend method downgrades to preview-only.

Do not generate retouch seeds for every low-texture region. Low signal should be
recorded as uncertainty, not treated as a defect.

## Reason Codes

Initial reason-code set:

- `low_confidence_boundary`
- `parallax_edge`
- `alignment_residual_high`
- `source_winner_tie`
- `rejected_source_detail`
- `halo_risk`
- `texture_collapse_risk`
- `operator_marked`
- `agent_marked`

Reason codes must be stable enough for filtering, QA, and future API tool
calls.

## Editing Operations

First-class retouch operations should include:

- choose source slice for region;
- erase retouch region;
- feather retouch edge;
- adjust region opacity;
- split/merge retouch regions;
- mark region reviewed;
- reject suggested region.

All operations should be undoable through the normal edit graph.

## UI Requirements

The UI should expose:

- retouch overlay visibility;
- region list with reason codes;
- source-slice picker;
- before/after toggle;
- reviewed/unreviewed filters;
- confidence-map and sharpness-map overlays;
- keyboard-accessible region navigation.

The UI must not hide retouch requirements behind export-time warnings. A stack
that requires retouch review should be obvious before apply/export.

## Agent/API Requirements

Agent tools should be able to:

- list retouch regions;
- inspect reason codes and candidate source indexes;
- request preview of a region;
- propose source-slice changes;
- mark regions reviewed;
- apply approved retouch edits.

Any mutating retouch operation requires an accepted dry-run plan and must record
provenance. Agent-proposed edits should remain reviewable by the local operator.

## Validation Plan

Schema validation:

- retouch layer required when policy is `generate_retouch_layer`;
- retouch layer forbidden when policy is `none`;
- source indexes must reference known focus slices;
- stale source hashes block apply.

Fixture validation:

- macro label edge requiring source correction;
- natural texture with false-detail risk;
- parallax edge that must create a warning or retouch seed;
- synthetic tie region with deterministic source choice.

Visual QA:

- overlay aligns with visible ambiguous regions;
- edits do not create halos;
- retouch can be disabled/re-enabled;
- before/after preview updates without changing source provenance.

## Out Of Scope

This document does not implement the retouch UI, brush engine, region storage,
agent tool definitions, or runtime blend application. Those should land as
separate PRs against this contract.
