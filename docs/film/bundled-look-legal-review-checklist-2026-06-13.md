# Bundled Look Legal Review Checklist

- Date: 2026-06-13
- Issue: #146 `film(legal): add bundled-look legal review checklist`
- Scope: review checklist for film simulation looks, LUTs, presets, and
  bundled creative assets.

## Purpose

RawEngine can ship high-quality film looks only if the project can prove where
the look came from, what claims the UI is allowed to make, and which assets are
safe to redistribute. This checklist is the merge gate for bundled looks before
they appear in the app, sample projects, docs, screenshots, or marketing copy.

The default policy is conservative: generic engineered looks are allowed with
clear provenance, while exact named-stock emulation claims require
project-owned or licensed measurement data and explicit legal/provenance
approval.

## Review Statuses

Each bundled look should have one status:

- `draft`: not eligible for release builds.
- `generic_approved`: safe generic look, no exact stock claim.
- `measured_pending`: measured look has fixture data but review is incomplete.
- `measured_approved`: measured look has reproducible project-owned or licensed
  data and approved claim language.
- `licensed_approved`: distributed under explicit license or partner agreement.
- `rejected`: blocked from bundled distribution.
- `deprecated`: retained only for migration or compatibility.

## Allowed Claim Levels

Allowed claim levels:

- `generic_style`: descriptive, vendor-neutral style language only.
- `stock_family_reference`: may mention broad process or stock family after
  review, without exact-emulation language.
- `measured_behavior`: may describe measured behavior from project-owned or
  licensed fixtures.
- `licensed_exact`: may use licensed exact-stock language only within approved
  license terms.

The UI should prefer `generic_style` until the measured-profile and stock
registry workflows are proven by fixtures.

## Required Metadata

Every bundled look must record:

- look ID;
- display name;
- semantic version;
- review status;
- allowed claim level;
- process family or creative family;
- intended input domain;
- output domain;
- touched parameter scopes;
- source type: engineered, measured, imported, licensed, or user-authored;
- author or maintainer;
- reviewer;
- review date;
- source notes;
- license status;
- redistribution permission;
- fixture IDs, when measured or fixture-backed;
- dependency hashes for LUTs, profiles, or auxiliary assets;
- migration and deprecation policy;
- known limitations;
- approved UI copy;
- approved documentation copy.

Metadata must be stored in a machine-readable manifest before the look is
bundled.

## Prohibited Bundled Content

Do not bundle:

- proprietary LUTs without redistribution rights;
- proprietary ICC, DCP, scanner, camera, or film profile assets;
- copied competitor film-look recipes;
- copied swatches, packaging art, logos, or marketing text;
- ripped presets from Capture One, Lightroom, VSCO, RNI, Mastin, Dehancer, or
  Negative Lab Pro;
- internet sample images without license, source, hash, and review metadata;
- named-stock exact-emulation profiles without approved measurement and legal
  records.

Local user imports may be more permissive, but imported assets must stay
clearly user-provided and must not become bundled app assets without review.

## Prohibited Wording

Block or require explicit legal approval for wording such as:

- exact;
- identical;
- official;
- manufacturer approved;
- certified;
- Capture One profile;
- Lightroom profile;
- Adobe profile;
- VSCO preset;
- RNI preset;
- Mastin preset;
- Dehancer look;
- Negative Lab Pro compatible;
- Fuji simulation;
- Kodak LUT;
- Portra exact;
- Tri-X exact.

Competitor and manufacturer names may appear in internal research notes or
licensed metadata only when the review status permits it. They should not appear
as quality claims in generic built-in look names, UI labels, or marketing copy.

## Generic Built-In Look Checklist

Before merging a generic built-in look:

- [ ] Name is vendor-neutral.
- [ ] Description avoids exact-emulation claims.
- [ ] No copied LUT/profile/binary asset is included.
- [ ] Source notes explain the engineered starting point.
- [ ] Touched parameters are declared.
- [ ] Input and output color domains are declared.
- [ ] Look strength default is declared.
- [ ] Fixture coverage status is declared.
- [ ] Approved UI copy is present.
- [ ] Approved docs copy is present.
- [ ] Migration/deprecation policy is present.
- [ ] Legal reviewer or maintainer sign-off is recorded.

## Measured Look Checklist

Before merging a measured named-stock or stock-family look:

- [ ] Measurement source is project-owned or explicitly licensed.
- [ ] Fixture IDs are present.
- [ ] Fixture manifest includes source, license, hash, capture method, scanner
      or camera details, process family, and review status.
- [ ] Measurement methodology is reproducible.
- [ ] Color target or reference methodology is documented when used.
- [ ] Rendered fixture outputs are deterministic.
- [ ] Claim language is approved.
- [ ] UI copy distinguishes measured behavior from exact reproduction unless
      licensed exact claims are approved.
- [ ] Legal review status is `measured_approved` or `licensed_approved`.
- [ ] A migration plan exists for future measurement updates.

## LUT And HaldCLUT Checklist

Before bundling or enabling shared distribution of a LUT/HaldCLUT:

- [ ] Asset hash is recorded.
- [ ] License allows redistribution.
- [ ] Source URL or acquisition record is stored.
- [ ] Author/copyright owner is stored when known.
- [ ] Input and output color domains are declared.
- [ ] LUT size and interpolation policy are recorded.
- [ ] Unsupported metadata is rejected or warned.
- [ ] The asset does not claim competitor compatibility unless licensed.
- [ ] The LUT can be removed or deprecated without breaking saved edits.

## User And Community Presets

User and community presets should be clearly separated from bundled RawEngine
looks:

- user-supplied names and stock metadata are allowed as local metadata where
  permitted;
- the app should label them as user or community content;
- missing provenance should warn before sharing;
- importing should never imply RawEngine endorsement;
- bundled promotion requires the same checklist as any built-in look.

## CI And Validation Gates

Future validation should add:

- claim-string lint for bundled look manifests;
- duplicate look ID checks;
- required metadata checks;
- missing fixture checks for measured looks;
- license/provenance checks for bundled LUT/profile assets;
- docs/UI copy lint for prohibited wording;
- sample manifest validation with Zod;
- fixture-output stability checks for approved measured looks.

The first blocking gate should be manifest validation and prohibited wording
lint. Full fixture-output gates can become required as measured looks land.

## Review Record Template

Use this template for each bundled look:

```text
Look ID:
Display name:
Version:
Review status:
Allowed claim level:
Source type:
Input domain:
Output domain:
Touched parameter scopes:
Dependencies:
Fixture IDs:
License status:
Redistribution permission:
Approved UI copy:
Approved docs copy:
Reviewer:
Review date:
Known limitations:
Migration/deprecation notes:
```

## Deferred

Deferred from this PR:

- machine-readable film look manifest schema;
- claim-string lint implementation;
- legal approval workflow automation;
- built-in look collection;
- measured named-stock methodology;
- user/community preset import UI.

Those should land as separate small PRs with schema samples and validation
evidence.
