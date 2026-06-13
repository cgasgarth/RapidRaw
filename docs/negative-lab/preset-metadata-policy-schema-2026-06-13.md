# Negative Lab Preset Metadata Policy Schema

- Date: 2026-06-13
- Issue: #155 `negative-lab(presets): define film stock preset metadata and legal policy`
- Scope: machine-checkable metadata policy for generic, stock-family, measured,
  licensed, user, and blocked Negative Lab preset tiers.

## Purpose

Negative Lab presets need legal, provenance, and claim controls before they can
be browsed in the UI, invoked by app-server tools, or serialized into sidecars.
The preset naming ADR defines the policy intent; this schema makes the policy
enforceable by code.

## Schema Surface

This PR adds:

- `NegativeLabPresetMetadataPolicyCatalogV1`
- `NegativeLabPresetMetadataPolicyV1`
- `NegativeLabPresetMetadataPolicyClaimLevelV1`
- `NegativeLabPresetMetadataPolicyTierV1`
- `NegativeLabPresetMetadataLegalReviewStatusV1`
- `NegativeLabPresetMetadataUiContextV1`
- sample artifact
  `packages/rawengine-schema/samples/negative-lab-preset-metadata-policy-catalog-v1.json`

## Policy Tiers

`generic_builtin` remains the only v1 tier that can ship without legal review.
It must use generic-safe naming, generic starting-point claims, and no
manufacturer, exact-stock, official, competitor, or measured-behavior claims.

`stock_family_reference` can organize research metadata, but it cannot claim an
exact stock match or endorsement. It requires source citations before it can be
shown.

`measured_project_profile` requires fixture IDs and explicit measured-behavior
claim permission. It is for project-owned or approved measurements, not copied
commercial presets or unlicensed profile packs.

`licensed_profile` is the only tier that may allow exact stock names,
manufacturer names, or endorsement claims. It requires approved legal review,
review metadata, and license record IDs.

`user_profile` is reserved for user-supplied profiles. It cannot imply official
or competitor compatibility claims.

`blocked` is only visible in the admin review queue and keeps incomplete,
unlicensed, or unsupported metadata out of normal UI and app-server tools.

## Validation Rules

The Zod schema rejects:

- generic policies that allow manufacturer, exact, measured, official, or
  competitor claims;
- stock-family policies without citations;
- measured policies without fixture IDs;
- licensed exact policies without approved legal review metadata or license
  records;
- blocked policies visible in normal UI contexts;
- duplicate policy IDs or duplicate display labels.

## Downstream Use

UI preset browsers, Negative Lab workspace controls, app-server tools, and
sidecar export should resolve every preset through this policy catalog before
showing user-visible names or claim copy. If a preset cannot resolve to an
allowed policy, the caller should treat it as blocked pending review.
