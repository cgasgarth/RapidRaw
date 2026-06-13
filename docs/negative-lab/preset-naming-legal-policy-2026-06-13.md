# ADR-NEG-006: Preset Naming, Trademark, Provenance, And Legal Policy

- Date: 2026-06-13
- Issue: #266 `negative-lab(adr): define preset naming and legal policy`
- Status: proposed
- Scope: negative lab preset/profile naming, stock registry claims,
  provenance, validation gates, and user-facing copy boundaries.

## Context

RawEngine should support major film-stock-aware negative workflows without
turning stock names into unsafe product claims. A film stock registry is useful
for search, compatibility, fixture planning, and user workflow language, but a
registry entry is not the same thing as an exact RawEngine profile.

The density-domain ADR establishes that v1 conversion starts with generic
process profiles, then stock registry/reference mappings, then measured profiles
only after project-owned fixtures and review exist. This ADR defines the naming
and provenance policy that must land before stock-family mappings or measured
stock profiles are implemented.

This is an engineering and product policy, not legal advice. It creates gates
that make future legal review concrete and testable.

## Decision

RawEngine will separate stock metadata, conversion profiles, creative presets,
and user/community imports.

1. **Stock registry entries are factual metadata.**
   - They may store manufacturer and stock names as sourced facts.
   - They may store ISO, process family, film class, availability status,
     supported formats, source citations, and last-reviewed dates.
   - They do not imply RawEngine ships an exact profile for that stock.
2. **Built-in v1 profiles use generic descriptive names first.**
   - Examples: `C-41 Neutral 100`, `C-41 Portrait 400`,
     `C-41 Vivid Fine Grain`, `B&W Classic Grain`, `B&W Tabular Grain`,
     `ECN-2 Daylight Helper`, and `E-6 Neutral Helper`.
   - Generic names must describe process, intent, speed class, or scan
     assumption rather than a manufacturer product.
3. **Stock-family mappings are reference mappings, not emulation claims.**
   - A mapping may say a stock family starts from a generic RawEngine profile.
   - UI copy must use language such as "suggested starting point" or
     "reference mapping".
   - UI copy must not use "exact", "official", "manufacturer-approved",
     "identical", "clone", "Capture One profile", "Lightroom profile",
     "Negative Lab Pro match", or equivalent claims.
4. **Measured named-stock profiles require stronger proof.**
   - The project must own or have explicit rights to the scans, targets,
     measurements, and profile data.
   - The profile must link fixture IDs, scan setup, process chemistry or lab
     notes where available, measurement method, algorithm version, review
     status, and approved copy.
   - Exact-emulation language is still prohibited unless legal review explicitly
     approves the claim.
5. **Licensed profiles are allowed only under explicit license terms.**
   - The profile record must store license source, allowed naming, allowed
     distribution, attribution requirements, modification rights, and expiry or
     renewal terms when present.
6. **User/community profiles stay visually and semantically separate.**
   - Users may store local metadata for their own film stocks and scans.
   - Imported profiles must not be promoted to built-in status without
     provenance, license, fixture, and copy review.

## Vocabulary

| Term                     | Meaning                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `StockRegistryEntry`     | Factual metadata about a film stock or stock family.                                        |
| `NegativeProfile`        | RawEngine conversion parameters used by the density-domain pipeline.                        |
| `CreativePreset`         | Post-conversion creative rendering defaults such as tone, grain, halation, or color style.  |
| `StockReferenceMapping`  | A non-emulation mapping from a stock registry entry to a generic or measured profile.       |
| `MeasuredProjectProfile` | A profile derived from project-owned or properly licensed measurements and fixture records. |
| `LicensedProfile`        | A profile distributed under explicit rights from a profile owner or partner.                |
| `UserProfile`            | A local user-created or imported profile.                                                   |
| `ClaimLevel`             | The allowed strength of user-facing wording for a registry entry, mapping, or profile.      |
| `NamingStatus`           | Whether exact stock names may appear in metadata, UI labels, or shipped profile names.      |

## Claim Levels

Every stock registry entry, mapping, and profile must carry a claim level:

| Claim level              | Allowed user-facing meaning                                                                | Required evidence                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `registry_only`          | Factual stock metadata only; no RawEngine profile claim.                                   | Source citations and review date.                    |
| `generic_mapping`        | This stock family can start from a generic RawEngine process profile.                      | Mapping rationale and generic profile ID.            |
| `measured_project`       | RawEngine measured this profile from approved fixtures.                                    | Fixture IDs, method, setup notes, profile hash.      |
| `licensed_profile`       | RawEngine can distribute this named profile under license.                                 | License record and approved naming/copy.             |
| `user_supplied`          | The user supplied this profile or metadata locally.                                        | Import provenance and local warning state.           |
| `unsupported_or_blocked` | RawEngine intentionally ships no mapping/profile because provenance or claim risk is high. | Block reason and optional follow-up issue reference. |

No claim level allows manufacturer endorsement language unless a separate
license record explicitly permits that wording.

## Naming Policy

### Internal IDs

Internal IDs must be stable, lowercase, ASCII, and namespaced:

- `generic.c41.neutral_100.v1`
- `generic.c41.portrait_400.v1`
- `generic.bw.classic_grain.v1`
- `generic.ecn2.daylight_helper.v1`
- `registry.kodak.portra_400`
- `mapping.registry.kodak.portra_400.to.generic.c41.portrait_400.v1`
- `measured.rawengine.kodak.portra_400.camera_scan_v1`
- `user.local.<uuid>`

Generic profile IDs must not include manufacturer or stock names. Registry and
mapping IDs may include stock identifiers as factual metadata references, but
only mapped profiles with `measured_project` or `licensed_profile` status may
ship as named-stock profiles.

### Built-In Labels

Allowed built-in generic labels:

- process-family language: `C-41`, `Black-and-White`, `ECN-2`, `E-6 Helper`;
- scan-assumption language: `Camera Scan`, `Flatbed`, `Lab TIFF`, `Warm Base`;
- intent language: `Neutral`, `Portrait`, `Vivid`, `Muted`, `High-Speed`,
  `Fine Grain`, `Classic Grain`, `Tabular Grain`, `Ortho`;
- speed-class language: `100`, `160`, `400`, `800`, `High-Speed` when used as a
  generic class rather than a product claim.

Restricted labels:

- manufacturer or stock names in built-in generic profile labels;
- third-party product names in profile labels;
- copied commercial preset naming systems;
- wording that implies official status, exact match, or compatibility with
  another vendor's preset/profile ecosystem.

### Stock Registry Display

The stock registry may display factual names such as manufacturer and stock
family when source citations exist. The UI must distinguish the display from the
profile claim:

- Good: `Kodak Portra 400 - suggested starting point: C-41 Portrait 400`
- Good: `Ilford HP5 Plus - registry metadata only`
- Good: `Cinestill 800T - reference mapping: ECN-2 Tungsten Helper`
- Bad: `Official Kodak Portra 400 profile`
- Bad: `Portra 400 exact emulation`
- Bad: `Capture One Portra 400 match`
- Bad: `Negative Lab Pro-compatible conversion`

## Prohibited Assets And Claims

RawEngine must not bundle or copy:

- manufacturer logos, packaging art, or trade dress;
- proprietary LUTs, ICC profiles, DCP profiles, HaldCLUTs, sidecars, presets, or
  measurement tables without explicit rights;
- commercial preset pack names, descriptions, categories, screenshots, or
  marketing copy;
- lab, manufacturer, or third-party sample images without license, source,
  hash, and allowed-use metadata;
- scraped profile data whose license or provenance is unclear.

Prohibited claim tokens should be linted in profile metadata, docs, user-facing
strings, registry entries, and PR descriptions where practical:

- `exact`
- `official`
- `manufacturer-approved`
- `endorsed`
- `identical`
- `clone`
- `replacement`
- `Capture One`
- `Lightroom profile`
- `Negative Lab Pro`
- `VSCO`
- `RNI`
- `Mastin`
- `Dehancer`

The lint should support approved exceptions for factual comparison docs, this
policy document, and legal review records.

## Required Metadata

Every built-in negative profile must include:

- `profile_id`
- `profile_version`
- `profile_tier`
- `claim_level`
- `naming_status`
- `process_family`
- `film_class`
- `intended_input_modes`
- `scan_assumptions`
- `algorithm_id`
- `algorithm_parameter_version`
- `source_profile_ids`
- `fixture_ids`
- `measurement_method_id`
- `license_status`
- `legal_review_status`
- `approved_display_name`
- `approved_description`
- `prohibited_claim_check_version`
- `created_at`
- `last_reviewed_at`
- `deprecated_by`

Every stock registry entry must include:

- `stock_id`
- `manufacturer_display_name`
- `stock_display_name`
- `process_family`
- `film_class`
- `speed_iso`
- `supported_formats`
- `availability_status`
- `registry_purpose`
- `default_safe_profile_id`
- `claim_level`
- `trademark_usage_status`
- `naming_status`
- `source_references`
- `last_reviewed_at`
- `review_issue`

Every source reference must include:

- `source_type`
- `title`
- `url`
- `publisher`
- `retrieved_at`
- `license_or_terms_note`
- `allowed_use_note`

## UI Policy

The Negative Lab Preset Studio must make profile confidence visible:

- badge: `Generic`
- badge: `Reference Mapping`
- badge: `Measured`
- badge: `Licensed`
- badge: `User`
- badge: `Registry Only`
- badge: `Blocked`

The profile inspector must show:

- profile tier and claim level;
- source and provenance summary;
- fixture IDs or a clear "no fixture-backed profile" state;
- input mode assumptions;
- process family;
- stock-family reference when present;
- legal/naming status;
- last-reviewed date;
- warnings for missing provenance, ambiguous claims, unsupported imports, or
  stock/profile mismatches.

Stock-family search may let users find familiar films, but choosing a stock
without a measured/licensed profile should select a generic starting point with
transparent copy, not a hidden branded preset.

## API And App-Server Policy

All API and future app-server tool responses that mention stock profiles must
return profile tier and claim level. Mutating commands must preserve the
difference between:

- selecting a generic conversion profile;
- applying a stock reference mapping;
- applying a measured project profile;
- importing a user/community profile;
- adding factual stock metadata to a roll/session.

Tool calls must not silently upgrade a mapping to a measured profile. Dry-run
responses should include warnings when an operation uses a low-confidence
mapping, missing provenance, unsupported import, or stock/process mismatch.

Stable warning codes should include:

- `missing_profile_provenance`
- `unsafe_profile_claim`
- `unapproved_stock_name`
- `unlicensed_profile_payload`
- `unsupported_profile_payload`
- `registry_reference_only`
- `stock_profile_mismatch`
- `expired_profile_review`
- `licensed_profile_restriction`
- `user_profile_unverified`

## Validation Gates

The first implementation PRs after this ADR should add a registry/profile lint
suite before shipping stock-family mappings:

- required metadata fields are present;
- IDs are stable, ASCII, lowercase, and namespaced;
- generic built-in profile IDs and labels do not contain stock/manufacturer
  names;
- stock names only appear in registry, mapping, measured, licensed, user, or
  approved legal-review contexts;
- prohibited claim tokens fail unless an allowlisted policy/legal doc context
  applies;
- bundled profile payloads declare license and provenance;
- registry source references include URL, publisher, retrieval date, and
  allowed-use note;
- user/community imports are quarantined or warning-tagged when provenance is
  incomplete;
- schema roundtrip uses the shared TypeScript/Zod package once the schema
  package lands;
- docs links and plan references stay in sync.

Future validation gates:

- fixture manifest lint for measured profiles;
- profile output hash fixtures for generic profiles;
- DeltaE/gray-ramp/ColorChecker gates for measured profiles;
- UI snapshot coverage for badges and provenance inspector states;
- app-server dry-run replay tests for profile selection and warning output.

## Implementation Order

1. Add this ADR and link it from the plan/docs.
2. Add TypeScript/Zod schemas for stock registry entries, negative profiles,
   stock mappings, claim levels, naming status, source references, and review
   records.
3. Add a registry/profile lint command and CI job.
4. Add an empty or minimal generic profile catalog with no manufacturer names.
5. Add stock registry source-citation schema and a tiny sample registry fixture.
6. Add UI provenance badges and inspector requirements.
7. Add generic built-in profiles.
8. Add stock-family reference mappings after lint and review gates exist.
9. Add measured profile fixture format and measurement methodology.
10. Add named-stock measured profiles only after fixtures and review are ready.

## Migration And Compatibility

Profile records must be versioned independently from the density algorithm.
Changing a profile label, claim level, or legal status must not change rendered
output unless the profile parameters change. Render-affecting changes require a
new profile version.

If a stock mapping is downgraded or blocked after review, old edits must replay
with their stored profile ID and warning state, while the UI should show that
the profile is deprecated or no longer recommended.

## Consequences

Positive consequences:

- Major film stock workflows can be searchable without overclaiming exact
  emulation.
- Future generic, measured, licensed, user, and reference profiles have clear
  schema boundaries.
- The project can shift legal/provenance review left through lintable metadata.
- App-server tools can safely expose stock-aware commands without inventing
  stronger claims than the UI.

Tradeoffs:

- Early v1 presets will be more generic than commercial film-preset packs.
- Some familiar stock names will appear as registry/search metadata before they
  have verified RawEngine profiles.
- Exact named-stock profiles require slower fixture and review work.

Key risks and mitigations:

- **Overconfident UI copy**: require claim levels and prohibited-claim lint.
- **Trademark confusion**: keep stock names in registry/mapping contexts unless
  review approves stronger use.
- **Copied profile data**: require source/license/provenance metadata and block
  unknown binary payloads.
- **User import ambiguity**: badge user profiles separately and warn on missing
  provenance.
- **Schema drift**: put claim levels, warning codes, and review status in shared
  schemas before implementation.
