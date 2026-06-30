# Negative Lab Generic Built-In Presets

- Date: 2026-06-13
- Issue: #156 `negative-lab(presets): add generic legally safe built-in presets`
- Status: proposed
- Scope: schema and sample catalog for the first generic Negative Lab built-in
  preset set. This does not ship named-stock emulations, measured profiles, UI
  controls, or app-server handlers.
- Depends on:
  [preset naming and legal policy](preset-naming-legal-policy-2026-06-13.md)
  and
  [process profiles and density normalization](../architecture/process-profiles-density-normalization-2026-06-13.md).

## Decision

RawEngine ships v1 Negative Lab presets as generic engineered starting points,
not exact film-stock simulations. A preset references a process profile and a
density normalization profile, then records what parts of the conversion it
touches. Generic built-ins are allowed to configure objective inversion and
semi-objective normalization, but they must leave creative rendering empty until
the film-look schema has its own typed contract.

The active v1 catalog is limited to supported process families:

- C-41 color negative;
- black-and-white silver negative.

ECN-2, E-6 helper, chromogenic black-and-white, redscale, expired film, exact
stock names, stock-family mappings, and measured project profiles remain
deferred. They should land through separate issues after the relevant process
profiles, provenance records, and review gates exist.

## Included Contract

The schema adds:

- `NegativeLabBuiltInPresetCatalogV1`
- `NegativeLabBuiltInPresetV1`
- `NegativeLabPresetProfileRefV1`
- `NegativeLabBuiltInPresetTier`
- `NegativeLabBuiltInPresetFilmClass`

The generated sample artifact is:

- `packages/rawengine-schema/samples/negative-lab/presets/negative-lab-built-in-preset-catalog-v1.json`

## Catalog Shape

A built-in preset records:

- stable `presetId` and `presetVersion`;
- user-visible generic `displayName` and `description`;
- process family, film class, input modes, and intent;
- process profile and density normalization profile references;
- provenance notes and claim policy;
- required warning codes;
- scan assumptions;
- touched parameter groups.

The catalog also includes `processProfileRefs` so a preset cannot silently refer
to a mismatched process family, normalization profile, or color mode.

## Initial Presets

The v1 sample catalog includes these generic entries:

- `C-41 Neutral`
- `C-41 Portrait`
- `C-41 High Speed`
- `C-41 Saturated`
- `Black and White Classic`
- `Black and White Fine Grain`
- `Black and White Ortho`

These are product starting points. They must not appear in UI, API responses, or
agent summaries as branded stock matches.

## Validation Rules

The schema rejects:

- manufacturer, stock, competitor, or exact-emulation claims in generic built-in
  user-facing text;
- manufacturer or stock identifiers in generic built-in IDs;
- uppercase or malformed preset IDs;
- duplicate preset IDs;
- duplicate display names;
- generic built-ins with exact-stock naming status;
- generic built-ins with measured-profile provenance;
- C-41 presets wired to black-and-white process profiles, or the reverse;
- process profile and density normalization mismatches;
- non-empty creative rendering defaults;
- lab JPEG input without required lossy-input and low-confidence warnings.

## API And Agent Expectations

App-server tools and future UI code should treat this catalog as a discovery
surface for deterministic preset selection. A tool may propose a generic preset
when the process family and input confidence match, but must keep the wording at
the `generic_starting_point_only` claim level.

For lab JPEG inputs, tools must surface the required warning codes and call out
that the source may already be rendered. Preview and apply flows should keep the
existing dry-run and approval contract instead of embedding command envelopes in
the preset record.

## Deferred

Separate PRs should handle:

- typed creative film-look parameters;
- UI preset browsing and preview thumbnails;
- app-server preset resolver tools;
- stock-family research mappings;
- measured profile fixture ingestion;
- ECN-2, E-6, chromogenic black-and-white, redscale, and expired-film helpers;
- legal review for exact stock names or partner-licensed profiles.
