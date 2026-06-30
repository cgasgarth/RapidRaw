# Runtime Proof Completion States

- Issue: #1851
- Status: validation policy; no runtime product behavior change

RawEngine tracks partial progress explicitly so planning, schemas, wrappers, and
UI wiring do not get counted as completed image-editing features.

## Completion Ladder

| State                  | Meaning                                                                                                               | Can close                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Plan-only              | Requirement, milestone, issue, or ADR exists.                                                                         | Planning/docs issue only.      |
| Schema-only            | Zod/schema package accepts and rejects payloads.                                                                      | Schema contract issue only.    |
| Command-wrapper        | UI/agent/Tauri call uses typed request and response validation.                                                       | API plumbing issue only.       |
| Fixture-only           | Public fixture or manifest validates, but no runtime work ran.                                                        | Fixture issue only.            |
| Dry-run capable        | App-server or UI can produce an approved plan without mutating image state.                                           | Dry-run issue only.            |
| Runtime apply-capable  | Local runtime mutates/render/processes an image path and emits artifacts.                                             | Runtime plumbing issue only.   |
| Private run-report     | Private image assets generated report artifacts and metrics outside the public repo.                                  | Private validation issue only. |
| Accepted private asset | Public manifest records non-null hashes from private reports and all required metrics pass.                           | Narrow proof issue only.       |
| E2E-proven             | User-visible workflow has runtime behavior, preview/export parity, artifacts/screenshots, and follow-up gaps tracked. | Full runtime feature issue.    |

## Closure Rule

Full feature issues require E2E-proven evidence or an equivalent workflow proof.
Earlier ladder states are valuable, but they must say their status in PR text and
keep or create follow-up issues for the remaining runtime/user-visible work.

## RAW Open/Edit/Export Application

The RAW open/edit/export proof path currently separates:

- `check:raw-open-edit-export-proof`: public manifest contract.
- `check:raw-open-edit-export-command-wrapper`: typed Tauri command wrapper.
- `check:raw-open-edit-export-private-report-collector`: local private report collection.
- `check:raw-open-edit-export-private-proof-acceptance`: public-safe acceptance helper.
- RAW open/edit/export report validation is now input-driven. Generate a
  private report through the private-root runner and validate it with
  `tests/integration/checks/raw/check-raw-open-edit-export-run-reports.ts --input
<report>`.
  and the final HTML review page.

These checks are necessary but not individually sufficient to close #1376. That
issue closes only when private RAW execution reports are accepted and the review
artifact page shows the resulting workflow proof.
