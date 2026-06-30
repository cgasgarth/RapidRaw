# Negative Lab Scan Fixture Manifest

- Date: 2026-06-13
- Issue: #159 `validation(negative-lab): add negative scan fixture manifest`
- Status: proposed
- Scope: Zod schema, sample artifact, and validation rules for negative-lab
  scan fixture manifests. This does not add real image fixtures or pixel golden
  tests yet.
- Depends on:
  [fixture licensing and provenance policy](fixture-licensing-provenance-policy-2026-06-13.md).

## Purpose

Negative Lab needs fixture metadata before render tests, UI overlay tests,
profile measurement, and warning stability checks can be trusted. The manifest
is the gate between "a useful scan for local debugging" and "a fixture RawEngine
can use in required validation."

The v1 manifest keeps payloads optional. It can represent generated synthetic
fixtures, public fixtures, licensed fixtures, project-owned scans, private CI
fixtures, and metadata-only records without committing large image files in this
PR.

## Included Contract

The schema adds:

- `NegativeLabFixtureManifestV1`
- `NegativeLabFixtureManifestEntryV1`
- `NegativeLabFixtureSourceV1`
- `NegativeLabFixtureStateV1`
- `NegativeLabFixtureTierV1`
- `NegativeLabFixtureRoleV1`
- `NegativeLabFixtureValidationUseV1`
- `NegativeLabFixtureDistributionV1`
- `NegativeLabFixtureWarningCodeV1`

The generated sample artifact is:

- `packages/rawengine-schema/samples/negative-lab-fixture-manifest-v1.json`

## Required Metadata

Each manifest entry records:

- fixture ID, state, tier, and role;
- process family and scan input mode;
- source, rights, distribution, and derivative-use policy;
- payload access and optional content hash;
- scanner/camera, lens, light source, bit depth, file format, and profile
  assumptions;
- base fog and rejected sample regions;
- allowed and disallowed validation uses;
- expected negative-lab warnings and fixture-provenance warnings;
- review issue, reviewer, and review date for approved fixtures.

## Validation Rules

The schema rejects:

- duplicate fixture IDs;
- approved fixtures without review issue, reviewer, and review date;
- public fixture distribution without derivative rights and a content hash;
- committed public payloads without public distribution rights and a content
  hash;
- public or licensed sources without source URL, license, and redistribution
  evidence;
- lab JPEG fixtures without lossy-input and low-confidence expected warnings;
- profile-measurement use unless the fixture is an approved project-owned or
  licensed scan with target data and claim approval;
- validation uses that are both allowed and disallowed.

## Initial Sample Entries

The sample manifest includes two synthetic records:

- `negative_lab.synthetic.c41_density_ramp_001` for density math and warning
  stability scaffolding;
- `negative_lab.synthetic.bw_border_strip_001` for UI overlay and roll
  consistency scaffolding.

Both are metadata records for generated fixtures. They do not add image payloads
or claim measured stock/profile quality.

## Deferred

Separate PRs should add:

- fixture generator code and generated payload hashes;
- manifest lint command wiring outside `schema:check` if the manifest moves out
  of generated samples;
- private-CI redaction rules;
- real project-owned scan records;
- public-source license review records;
- render/golden tests that consume the manifest.
