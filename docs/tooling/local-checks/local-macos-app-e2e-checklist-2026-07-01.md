# Local macOS App E2E Checklist

- Issue: #4567 `qa(computer-use): add repeatable local macOS app E2E checklist and issue capture flow`
- Scope: Computer Use or equivalent local macOS app verification
- Report template:
  `docs/validation/reports/local-macos-app-e2e-report.template.md`

## Purpose

Use this checklist when a PR claims user-visible local app behavior, app-server
agent behavior, or private RAW workflow readiness. It is a bounded manual E2E
pass, not a broad feature inventory. The output must be short enough for PR
review and must include runtime evidence for every checked workflow.

## Setup

1. Confirm the branch and worktree are clean enough to test:

   ```sh
   git status --short --branch
   ```

2. Build, install, and launch the macOS app for Computer Use:

   ```sh
   bun run install:computer-use -- --compact
   ```

   Use `--no-build` only when the release app bundle was already built from the
   current commit. Use `--app-path /tmp/RapidRAW.app` when `/Applications` should
   not be replaced.

3. Open the report template and save the run copy outside the committed docs
   tree unless the run is durable PR evidence:

   ```sh
   mkdir -p private-artifacts/validation/local-macos-app-e2e
   cp docs/validation/reports/local-macos-app-e2e-report.template.md \
     private-artifacts/validation/local-macos-app-e2e/report-$(date +%Y-%m-%d).md
   ```

4. Use public fixtures where possible. For private RAW coverage, use
   `/Users/cgas/Pictures/Capture One/Alaska` only as local project-owned input.
   Do not commit private RAWs, private screenshots containing sensitive file
   names, hashes, EXIF dumps, or derived pixels.

## Evidence Rules

- Each workflow row needs a screenshot path, exported artifact path, audit log
  path, command output excerpt, or explicit blocker.
- A failure is not complete without a GitHub issue URL or an existing issue
  link, unless it is fixed in the same PR and the report names the regression
  proof.
- Screenshots should show the user-visible state that proves the result:
  selected image, edited preview, warning dialog, export result, or agent
  approval/audit row.
- Keep the report bounded. Record one representative screenshot per state and
  one issue per defect cluster; do not create a generated UI inventory.

## Checklist

| Step | Workflow | Required runtime evidence |
| --- | --- | --- |
| 1 | Launch/open folder | App launches from the installed bundle, accepts an image folder through the visible open/import flow, and shows a populated library or an empty-state error that matches the folder contents. Capture the app window after folder selection. |
| 2 | Browse images | Select at least three images, including one RAW when available. Confirm the selected image, metadata/sidebar state, zoom/pan controls, and thumbnail selection stay in sync. Capture the selected-image state. |
| 3 | Edit, preview, export | Apply a visible adjustment, compare before/after or preview state, export to a local test folder, and reopen or inspect the exported file. Record the exported path and screenshot the changed preview or export confirmation. |
| 4 | Negative Lab | Open Negative Lab from the app workflow, load a negative scan or fixture, adjust inversion/density/color controls, and export or hand off back to the editor. Capture the converted preview and any QC/export state. |
| 5 | Agent loop | Start an agent/edit loop on the selected image. Require a dry-run or recommendation, explicit approval before mutation, applied command evidence, preview update, and rollback or audit history evidence. Capture the approval/audit state. |
| 6 | Computational merge where available | Exercise one available merge workflow, such as HDR, panorama, focus stack, or super-resolution. Verify source selection, preflight warnings, run/apply status, and output/sidecar availability. Capture either the successful output or the blocking warning. |
| 7 | Failure and recovery | Try one invalid user action, such as unsupported input, missing folder, bad export destination, or incompatible merge sources. Confirm the app shows a recoverable user-visible error without losing the current selection. Capture the error state. |
| 8 | File refresh | Add, remove, or rename a test image in the opened folder. Confirm the library refresh behavior is visible and does not duplicate stale entries. Capture the refreshed library state or create an issue if refresh is unavailable. |
| 9 | Window sizing | Check a small laptop-sized window and a large desktop window. Confirm major controls remain reachable, text does not overlap, and modal/dialog actions are visible. Capture only failures unless the PR changes layout. |

## Issue Capture

Create GitHub issues for failures that are not fixed immediately:

```sh
gh issue create --repo cgasgarth/RapidRaw \
  --title "qa(macos): concise failure title" \
  --body-file /tmp/rapidraw-local-e2e-failure.md
```

The issue body must include:

- tested commit, macOS version, app path, and launch command;
- exact checklist step and expected versus actual behavior;
- screenshot path or redacted image attachment;
- exported artifact path, audit log path, or app-server report path when
  relevant;
- whether the failure blocks the current PR or is a follow-up regression issue;
- the validation command or manual steps expected to prove the fix.

## PR Summary Format

Paste a compact summary into the PR:

```md
Local macOS app E2E:
- Report: private-artifacts/validation/local-macos-app-e2e/report-YYYY-MM-DD.md
- App install: bun run install:computer-use -- --compact
- Workflows covered: launch/open folder, browse images, edit/preview/export, Negative Lab, agent loop, computational merge, failure recovery, file refresh, window sizing
- Failures filed: #NNNN, #NNNN
- Deferred/not available: short reason
```
