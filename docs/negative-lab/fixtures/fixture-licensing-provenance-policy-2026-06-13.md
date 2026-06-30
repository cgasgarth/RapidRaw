# Negative Lab Fixture Licensing And Provenance Policy

- Date: 2026-06-13
- Issue: #277 `validation(negative-lab): add fixture licensing and provenance policy`
- Status: proposed
- Depends on: [Fixture download policy](../../validation/fixtures/fixture-download-policy-2026-06-11.md)

## Purpose

Negative Lab validation needs stricter fixture provenance than normal rendered
image tests because scan setup, stock identity, process chemistry, scanner
software, and lab correction can change the meaning of the same pixels. A
fixture can be useful for UI smoke tests while still being unsafe for color
quality claims or named-stock profile validation.

This policy extends the global fixture policy for negative processing, film
simulation, stock registry, measured profile, roll normalization, and QC proof
work. It does not add fixture payloads or download scripts.

## Fixture Tiers

Negative Lab fixtures must declare a validation tier:

| Tier                 | Purpose                                                      | Public repo content                         |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `synthetic_numeric`  | Deterministic density math, warning, and schema tests.       | Generator, manifest, expected hashes.       |
| `synthetic_visual`   | UI overlays, contact sheets, and preview states.             | Generator or small generated output.        |
| `public_reference`   | Publicly sourced scan used for non-quality smoke checks.     | Manifest only unless redistribution allows. |
| `project_owned_scan` | RawEngine-owned scan used for measured profile development.  | Manifest; payload only if approved.         |
| `licensed_scan`      | Third-party scan with explicit validation/profile rights.    | Per license terms.                          |
| `private_local`      | User/local exploratory scan.                                 | No payload or private path in git.          |
| `private_ci`         | Restricted validation fixture available only to trusted CI.  | Manifest stub only.                         |
| `derived_positive`   | Output generated from another fixture.                       | Only if source allows derivatives.          |
| `calibration_target` | IT8, ColorChecker, step wedge, gray card, or similar target. | Manifest and rights evidence.               |
| `blocked_or_unknown` | Candidate fixture with unclear rights or setup.              | Metadata only; never required by CI.        |

Unknown rights, unknown source, or unknown scan setup means the payload cannot be
committed and cannot be used for measured profile claims.

## Required Provenance Fields

Every negative-lab fixture manifest entry must include the global fixture fields
plus these fields:

- `negative_fixture_tier`
- `fixture_role`
- `film_stock_known`
- `film_stock_display_name`
- `film_stock_source`
- `process_family`
- `development_process_known`
- `development_notes`
- `scan_input_mode`
- `scanner_or_camera`
- `lens`
- `light_source`
- `capture_profile`
- `scanner_software`
- `scanner_software_settings_known`
- `auto_correction_baked_in`
- `file_format`
- `bit_depth`
- `color_profile`
- `lossy_compression`
- `frame_format`
- `roll_or_sheet_identifier`
- `base_fog_sample_regions`
- `rejected_sample_regions`
- `target_or_step_wedge_present`
- `expected_warning_codes`
- `allowed_validation_uses`
- `disallowed_validation_uses`
- `allowed_distribution`
- `derivative_distribution_allowed`
- `measurement_claim_allowed`
- `profile_claim_allowed`
- `review_issue`
- `reviewer`
- `reviewed_at`

`allowed_validation_uses` must be explicit. Example values:

- `schema_roundtrip`
- `ui_overlay_smoke`
- `density_math_reference`
- `warning_stability`
- `roll_consistency`
- `profile_measurement`
- `stock_reference_mapping`
- `marketing_screenshot`

## Claim Eligibility

Fixture provenance controls which product claims are allowed:

| Claim or validation use        | Minimum fixture requirement                                                       |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Density math correctness       | `synthetic_numeric` with known generator and expected numeric output.             |
| UI overlay alignment           | `synthetic_visual` or redistribution-safe public fixture with known dimensions.   |
| Warning stability              | Synthetic or sourced fixture with declared expected warnings and hash.            |
| Stock reference mapping        | Registry source citations plus non-measured mapping rationale.                    |
| Measured named-stock profile   | `project_owned_scan` or `licensed_scan` with method, target, and review evidence. |
| DeltaE or target quality gate  | Calibration target/step wedge data with rights and measurement method.            |
| Marketing or public screenshot | Fixture and derivative distribution rights plus privacy review.                   |

Public internet scans may help find failure modes, but they are not enough for
measured named-stock profiles unless rights, setup, and measurement method are
all documented.

## Source And Rights Rules

Allowed fixture sources:

- project-owned scans created specifically for RawEngine;
- generated synthetic negatives from project-owned code;
- public-domain or permissively licensed scans with redistribution evidence;
- third-party scans licensed to RawEngine for validation or profile creation;
- local user scans for private exploratory debugging only;
- calibration target captures when target usage and scan rights are documented.

Blocked sources:

- sample scans copied from labs, stores, forums, social media, or review sites
  without redistribution or validation rights;
- manufacturer marketing images, packaging, or profile assets;
- commercial preset/profile pack outputs used as references without rights;
- scans whose terms allow viewing but not redistribution or derivative tests;
- private family/client photos unless kept local-only with explicit owner
  permission;
- authenticated, paywalled, scraped, or signed-URL sources.

## Manifest States

Each entry must use a lifecycle state:

- `candidate`: metadata exists, not used by tests.
- `review_pending`: rights/setup review is incomplete.
- `approved_metadata_only`: usable for planning/search, no payload or test gate.
- `approved_smoke`: usable for UI or warning smoke checks.
- `approved_numeric`: usable for deterministic numeric gates.
- `approved_profile_measurement`: usable for measured profile creation.
- `deprecated`: no longer recommended but retained for replay history.
- `blocked`: known rights, provenance, or setup issue prevents use.

Required CI gates may only use `approved_smoke`, `approved_numeric`, or
`approved_profile_measurement` fixtures.

## Expected Warning Codes

Fixture manifests should declare expected warnings using stable codes from the
density and preset ADRs. Negative-lab fixture policy adds these provenance
warnings:

- `missing_fixture_license`
- `unknown_fixture_rights`
- `fixture_payload_not_public`
- `fixture_setup_unknown`
- `fixture_stock_unverified`
- `fixture_process_unverified`
- `fixture_auto_correction_unknown`
- `fixture_profile_claim_disallowed`
- `fixture_derivative_not_allowed`
- `fixture_review_expired`

Validation should fail closed when a required fixture has warnings outside its
allowed warning set.

## Review Cadence

Review dates are mandatory because source availability, licenses, and stock
catalogs change. Review cadence:

- synthetic fixtures: review when generator or expected output changes;
- public/reference fixtures: every major release or when source URL/license
  changes;
- project-owned measured fixtures: when measurement method, scanner, camera,
  chemistry, target, or profile algorithm changes;
- licensed fixtures: before license expiry or before any use beyond the
  original license terms;
- private/local fixtures: never promoted without a new review.

Expired review should not break replay of historical edits, but it should block
new measured-profile claims until review is refreshed.

## Validation Gates

The first implementation PRs after this policy should add:

- a Zod-backed negative fixture manifest schema;
- a fixture lint command;
- source/reference URL and license-required checks;
- public/private payload classification checks;
- expected warning code validation;
- fixture lifecycle state validation;
- derived artifact rights checks;
- profile-claim eligibility checks;
- docs link checks for fixture policy references.

Future gates should add:

- synthetic negative generator output hashes;
- ColorChecker/step-wedge metadata validation;
- target measurement file schema validation;
- private-CI manifest redaction checks;
- app-server dry-run evidence that restricted fixtures are not exposed.

## Implementation Order

1. Add this policy and link it from the plan/docs.
2. Add a Zod schema for negative fixture manifest entries.
3. Add an empty negative fixture manifest with planned synthetic entries.
4. Add fixture manifest lint and CI wiring.
5. Add synthetic numeric fixtures for density math and warning stability.
6. Add synthetic visual fixtures for overlays and contact sheets.
7. Add project-owned measured fixture format and method.
8. Add private/local fixture redaction checks.
9. Add measured profile eligibility gates.
10. Add public review artifacts for approved profile fixtures.

## Consequences

Positive consequences:

- Color-quality and named-profile claims cannot accidentally rely on weak
  fixture provenance.
- UI and smoke tests can still use lower-risk synthetic or public fixtures.
- Future app-server tools can report fixture confidence and rights warnings.
- The public repo can stay useful without committing questionable image assets.

Tradeoffs:

- Measured named-stock profiles require more up-front evidence.
- Some useful exploratory samples remain local-only until rights are resolved.
- Fixture schemas and lints must land before broad negative-lab validation can
  become fully automated.
