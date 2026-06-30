# Negative Lab Stock-Family Research Mapping

- Date: 2026-06-13
- Issue: #274 `negative-lab(presets): add stock-family research mappings after legal review`
- Status: proposed
- Scope: docs-only first pass for legally cautious stock-family mapping
  research. This does not ship built-in stock presets, measured profiles,
  schema files, or runtime UI.
- Depends on:
  [preset naming and legal policy](../presets/preset-naming-legal-policy-2026-06-13.md),
  [fixture licensing and provenance policy](fixture-licensing-provenance-policy-2026-06-13.md),
  and [measured-profile fixture format](measured-profile-fixture-format-2026-06-13.md).

## Purpose

RawEngine needs a stock-family research map before it can offer useful Negative
Lab presets. The map must help users navigate common film/process families
without implying official endorsement, exact manufacturer emulation, or
unreviewed trademark use.

This document defines the mapping framework. It intentionally separates:

- generic built-in helpers that can ship early;
- measured project profiles that need fixtures and review;
- user/community profiles that stay local unless provenance is complete;
- blocked or deferred mappings where claims, rights, or measurement quality are
  not good enough.

## Non-Goals

- Do not ship exact named-stock simulations in this PR.
- Do not copy LUTs, ICC profiles, curves, marketing descriptions, or measured
  data from third-party products.
- Do not use manufacturer names in user-visible preset names unless the legal
  policy approves the claim level.
- Do not represent generic tone/color helpers as measured stock profiles.

## Mapping Tiers

Each candidate mapping belongs to exactly one tier:

| Tier | Name                     | Ship status                    | Required evidence                                                              |
| ---- | ------------------------ | ------------------------------ | ------------------------------------------------------------------------------ |
| A    | Generic process helper   | Can ship after visual QA       | Internal design notes, no stock-specific claims                                |
| B    | Research stock family    | Docs/catalog only              | Publicly known process family and trait notes with safe wording                |
| C    | Project-measured profile | Can ship after review          | Project-owned or licensed fixtures, measured-profile record, validation report |
| D    | Licensed partner profile | Can ship after contract review | License/contract, attribution/copy approval, fixture or profile evidence       |
| E    | User/community profile   | Local import only by default   | User-supplied provenance and warning state                                     |
| F    | Blocked/deferred         | Must not ship                  | Missing rights, unsafe claims, unclear source, or insufficient measurements    |

Tier A and B entries must use generic display names. Tier C and D entries may
use stronger names only after the naming/legal policy allows the exact claim
level.

## Candidate Family Vocabulary

The research map should use generic vocabulary first. Candidate family IDs must
be stable lowercase ASCII strings and should describe process plus broad visual
intent:

| Family ID                   | Process                              | Safe display name        | Research intent                                           |
| --------------------------- | ------------------------------------ | ------------------------ | --------------------------------------------------------- |
| `c41_portrait_natural`      | C-41 color negative                  | C-41 Portrait Natural    | Smooth contrast, restrained saturation, natural skin bias |
| `c41_consumer_warm`         | C-41 color negative                  | C-41 Consumer Warm       | Warm balance, forgiving contrast, moderate grain          |
| `c41_vivid_fine_grain`      | C-41 color negative                  | C-41 Vivid Fine Grain    | Clean scans, higher chroma, controlled shadows            |
| `c41_muted_documentary`     | C-41 color negative                  | C-41 Muted Documentary   | Lower chroma, softer contrast, neutral shadows            |
| `bw_classic_panchromatic`   | Black-and-white silver negative      | Classic Panchromatic BW  | Standard panchromatic response and midtone contrast       |
| `bw_fine_grain`             | Black-and-white silver negative      | Fine Grain BW            | Lower apparent grain, smoother highlights                 |
| `bw_high_speed`             | Black-and-white silver negative      | High Speed BW            | Stronger grain, higher contrast, robust shadows           |
| `bw_tabular_grain`          | Black-and-white silver negative      | Tabular Grain BW         | Cleaner grain impression, extended tonality               |
| `bw_ortho_helper`           | Black-and-white silver negative      | Ortho-Inspired BW Helper | Blue-sensitive feel without exact stock claims            |
| `chromogenic_bw_helper`     | Chromogenic black-and-white negative | Chromogenic BW Helper    | C-41 processed monochrome helper                          |
| `ecn2_daylight_helper`      | ECN-2 color negative                 | ECN-2 Daylight Helper    | Motion-picture negative workflow helper                   |
| `ecn2_tungsten_helper`      | ECN-2 color negative                 | ECN-2 Tungsten Helper    | Tungsten-balanced motion-picture workflow helper          |
| `e6_slide_reference_helper` | E-6 slide helper                     | Slide Reference Helper   | Positive-film reference helper, not negative inversion    |
| `creative_redscale_helper`  | Creative negative                    | Redscale Helper          | Creative channel-bias helper with explicit warning copy   |
| `expired_negative_helper`   | Creative/unknown negative            | Expired Negative Helper  | Degraded-base and color-shift exploration helper          |

These names are intentionally generic. A later profile registry may attach
aliases, blocked external references, or measured evidence, but user-facing copy
must stay within the approved tier.

## Research Record Shape

A future schema should represent each mapping as a strict object:

```json
{
  "family_id": "c41_portrait_natural",
  "schema_version": 1,
  "process_family": "c41_color_negative",
  "tier": "research_stock_family",
  "safe_display_name": "C-41 Portrait Natural",
  "claim_level": "generic_family",
  "legal_status": "safe_generic",
  "default_profile_intent": "portrait_natural",
  "supported_input_modes": ["camera_raw", "flatbed_tiff", "lab_tiff"],
  "required_warnings": [],
  "blocked_claims": [],
  "evidence": {}
}
```

Recommended fields:

- `family_id`: stable internal identifier.
- `process_family`: Negative Lab process family.
- `tier`: mapping tier from this document.
- `safe_display_name`: user-visible name allowed for the tier.
- `claim_level`: `generic_family`, `measured_project`, `licensed_named_stock`,
  `user_supplied`, or `blocked`.
- `legal_status`: `safe_generic`, `review_pending`, `approved`, or `blocked`.
- `default_profile_intent`: high-level rendering intent for UI grouping.
- `supported_input_modes`: acquisition modes where the helper can be offered.
- `minimum_acquisition_confidence`: lowest input confidence allowed without a
  warning.
- `required_warnings`: warning codes shown when assumptions are weak.
- `blocked_claims`: strings or claim categories that UI and docs must avoid.
- `evidence`: links to fixture IDs, measured-profile IDs, validation reports,
  or review issues.

## Legal Review Checklist

Before a family can move above Tier B:

- display name and copy must avoid unapproved stock/manufacturer claims;
- source scans or measurements must have rights and provenance records;
- measurement data must be reproducible from the fixture record;
- derivative profile distribution must be explicitly allowed;
- validation reports must name the profile algorithm and measurement method;
- UI copy must distinguish generic helpers from measured profiles;
- prohibited wording lint must pass;
- legal or policy reviewer must record approval, scope, and expiry if any.

## Validation Expectations

Initial docs-only validation:

```sh
bun run docs:check
```

Future schema/runtime validation should add:

- registry schema strictness and rejected unknown fields;
- prohibited-claim lint for display names, descriptions, aliases, and metadata;
- fixture/provenance references resolved and approved;
- measured-profile fixtures hash-checked against registry entries;
- generic helper output snapshots that avoid stock-specific claims;
- UI badge snapshots for generic, measured, licensed, user, and blocked tiers;
- migration tests for deprecated or renamed family IDs.

## Follow-Up PRs

- Add a Zod-backed `NegativeLabStockFamilyMappingV1` schema.
- Add a generated sample registry with only generic Tier A/B entries.
- Add prohibited-copy lint for stock/profile registry metadata.
- Add measured-profile fixture references for any Tier C candidates.
- Add UI provenance badges before exposing non-generic profile tiers.
- Add import quarantine behavior for user/community profiles with incomplete
  provenance.
