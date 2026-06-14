# RawEngine Documentation

- Snapshot date: 2026-06-11
- Issue: #253 `docs(site): add documentation site`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-site`
- Branch: `codex/docs-site-index`

## Purpose

This page is the documentation-site entry point for RawEngine. It keeps the
current committed docs discoverable without adding a separate static-site
generator before the release workflow needs one.

## User Docs

- [User guide](user/user-guide-2026-06-11.md)
- [Negative Lab user guide](user/negative-lab-user-guide-2026-06-13.md)
- [Known limitations](release/known-limitations-2026-06-11.md)
- [Privacy policy](release/privacy-policy-2026-06-11.md)
- [Crash and error reporting strategy](release/crash-error-reporting-strategy-2026-06-11.md)
- [Telemetry opt-in decision](release/telemetry-opt-in-decision-2026-06-11.md)

## Developer Docs

- [Developer API guide](api/developer-api-guide-2026-06-11.md)
- [Edit command API baseline](api/edit-command-api-2026-06-11.md)
- [RawEngine schema package](api/rawengine-schema-package-2026-06-13.md)
- [Sample agent guide](agent/sample-agent-guide-2026-06-11.md)
- [App-server agent architecture](agent/app-server-architecture-2026-06-12.md)
- [App-server agent demo workflow](agent/app-server-demo-workflow-2026-06-13.md)
- [Agent tool-call audit log](agent/tool-call-audit-log-2026-06-13.md)
- [Negative Lab app-server tool contract](agent/negative-lab-app-server-tools-2026-06-13.md)
- [Film simulation architecture](film/film-simulation-architecture-2026-06-13.md)
- [Built-In Film Look catalog schema](film/built-in-look-catalog-schema-2026-06-13.md)
- [Bundled look legal review checklist](film/bundled-look-legal-review-checklist-2026-06-13.md)
- [Negative Lab architecture overview](negative-lab/architecture-overview-2026-06-13.md)
- [Negative Lab consult design review](negative-lab/consult-design-review-2026-06-13.md)
- [Negative Lab density-domain inversion ADR](negative-lab/density-domain-inversion-adr-2026-06-13.md)
- [Negative Lab input profile strategy ADR](negative-lab/input-profile-strategy-adr-2026-06-13.md)
- [Negative Lab API command surface ADR](negative-lab/api-command-surface-adr-2026-06-13.md)
- [Negative Lab conversion operation schema](negative-lab/conversion-operation-schema-2026-06-13.md)
- [Negative Lab preset naming and legal policy ADR](negative-lab/preset-naming-legal-policy-2026-06-13.md)
- [Negative Lab fixture licensing and provenance policy](negative-lab/fixture-licensing-provenance-policy-2026-06-13.md)
- [Negative Lab scan fixture manifest](negative-lab/negative-scan-fixture-manifest-2026-06-13.md)
- [Negative Lab scanner and camera input profiles](negative-lab/scanner-camera-input-profiles-2026-06-13.md)
- [Negative Lab frame detection and border contract](negative-lab/frame-detection-border-contract-2026-06-13.md)
- [Negative Lab dedicated workspace UI](negative-lab/dedicated-workspace-ui-2026-06-13.md)
- [Negative Lab process profiles and density normalization](negative-lab/process-profiles-density-normalization-2026-06-13.md)
- [Negative Lab per-channel inversion curves](negative-lab/per-channel-inversion-curves-2026-06-13.md)
- [Negative Lab base sampling controls](negative-lab/base-sampling-controls-2026-06-13.md)
- [Negative Lab generic built-in presets](negative-lab/generic-built-in-presets-2026-06-13.md)
- [Negative Lab preset metadata policy schema](negative-lab/preset-metadata-policy-schema-2026-06-13.md)
- [Negative Lab roll batch consistency workflow](negative-lab/roll-batch-consistency-workflow-2026-06-13.md)
- [Negative Lab roll setup and frame queue UI](negative-lab/roll-setup-frame-queue-ui-2026-06-13.md)
- [Negative Lab QC overlays and sample readouts UI](negative-lab/qc-overlays-sample-readouts-ui-2026-06-13.md)
- [Negative Lab QC proof validation contract](negative-lab/qc-proof-validation-contract-2026-06-13.md)
- [Negative Lab measured-profile fixture format](negative-lab/measured-profile-fixture-format-2026-06-13.md)
- [Negative Lab stock-family research mapping](negative-lab/stock-family-research-mapping-2026-06-13.md)
- [RapidRAW panorama stitcher audit](panorama/rapidraw-stitcher-audit-2026-06-13.md)
- [Panorama architecture consult review](panorama/panorama-architecture-consult-2026-06-13.md)
- [Panorama multi-row support audit](panorama/multi-row-support-audit-2026-06-13.md)
- [Large panorama tiling strategy](panorama/large-panorama-tiling-strategy-2026-06-13.md)
- [Panorama artifact schema](panorama/panorama-artifact-schema-2026-06-13.md)
- [Panorama sidecar artifact persistence](panorama/panorama-sidecar-artifact-persistence-2026-06-13.md)
- [Panorama backend capability contract](panorama/panorama-backend-capability-contract-2026-06-13.md)
- [Panorama projection options](panorama/projection-options-2026-06-13.md)
- [Panorama boundary controls](panorama/boundary-controls-2026-06-13.md)
- [Panorama exposure normalization](panorama/exposure-normalization-2026-06-13.md)
- [OpenCV panorama backend evaluation](panorama/opencv-backend-evaluation-2026-06-13.md)
- [OpenCV seam and exposure strategy comparison](panorama/opencv-seam-exposure-comparison-2026-06-13.md)
- [OpenCV macOS packaging proof](panorama/opencv-macos-packaging-proof-2026-06-13.md)
- [OpenCV required CI promotion criteria](panorama/opencv-required-ci-promotion-2026-06-13.md)
- [Focus Stack architecture consult summary](focus-stacking/architecture-consult-summary-2026-06-14.md)
- [Focus Stack RAW normalization and color policy](focus-stacking/raw-normalization-color-policy-2026-06-14.md)
- [Focus Stack alignment path](focus-stacking/alignment-path-2026-06-14.md)
- [Focus Stack sharpness map generation](focus-stacking/sharpness-map-generation-2026-06-14.md)
- [Focus Stack blending strategy](focus-stacking/blending-strategy-2026-06-14.md)
- [Focus Stack retouch artifact strategy](focus-stacking/retouch-artifact-strategy-2026-06-14.md)
- [Focus Stack fixture manifest](focus-stacking/focus-bracket-fixture-manifest-2026-06-14.md)
- [Focus Stack API tool contract](focus-stacking/api-tool-contract-2026-06-14.md)
- [Focus Stack performance validation contract](focus-stacking/performance-validation-contract-2026-06-14.md)
- [Architecture baseline](baseline/rapidraw-architecture-baseline-2026-06-11.md)
- [Image pipeline baseline](baseline/rapidraw-image-pipeline-baseline-2026-06-13.md)
- [AI hooks baseline](baseline/rapidraw-ai-hooks-baseline-2026-06-11.md)
- [GPU shader baseline](baseline/rapidraw-gpu-shader-baseline-2026-06-11.md)
- [Command baseline](baseline/rapidraw-command-baseline-2026-06-10.md)
- [Sidecar format baseline](baseline/rapidraw-sidecar-format-baseline-2026-06-11.md)

## Validation And CI Docs

- [Cache policy](ci/cache-policy-2026-06-11.md)
- [Failure artifacts](ci/failure-artifacts-2026-06-11.md)
- [Optional platform build matrix](ci/optional-platform-build-matrix-2026-06-11.md)
- [Local check command contract](tooling/local-check-command-contract-2026-06-10.md)
- [Bun CI script migration](tooling/bun-ci-script-migration-2026-06-10.md)
- [Bun package manager support](tooling/bun-package-manager-support-2026-06-10.md)
- [Major dependency migration process](tooling/major-dependency-migration-process-2026-06-13.md)
- [Dependency version audit](tooling/dependency-version-audit-2026-06-13.md)
- [Rust required feature policy](tooling/rust-required-feature-policy-2026-06-13.md)
- [Strict type-checked ESLint](tooling/eslint-strict-type-checked-2026-06-11.md)
- [ESLint escape hatches](tooling/eslint-escape-hatches-2026-06-11.md)
- [ESLint accessibility rules](tooling/eslint-accessibility-rules-2026-06-11.md)
- [ESLint async safety rules](tooling/eslint-async-safety-rules-2026-06-11.md)
- [ESLint import and boundary rules](tooling/eslint-import-boundary-rules-2026-06-11.md)
- [ESLint project service](tooling/eslint-project-service-2026-06-11.md)
- [ESLint React hooks rules](tooling/eslint-react-hooks-rules-2026-06-11.md)
- [ESLint warning inventory](tooling/eslint-warning-inventory-2026-06-11.md)
- [ESLint zero-warning CI](tooling/eslint-zero-warning-ci-2026-06-11.md)
- [Generated type drift checks](tooling/generated-type-drift-checks-2026-06-11.md)
- [Markdown link checks](tooling/markdown-link-checks-2026-06-11.md)
- [macOS smoke routing](tooling/macos-smoke-routing-2026-06-11.md)
- [Pre-commit main guard](tooling/pre-commit-main-guard-2026-06-10.md)
- [Pre-push main guard](tooling/pre-push-main-guard-2026-06-11.md)
- [Script entrypoints](tooling/rapidraw-script-entrypoints-2026-06-10.md)
- [Staged hook checks](tooling/staged-hook-checks-2026-06-11.md)
- [TypeScript compiler options audit](tooling/typescript-compiler-options-audit-2026-06-10.md)
- [Vite bundle budget](tooling/vite-bundle-budget-2026-06-11.md)
- [Workflow topology](ci/workflow-topology-2026-06-11.md)
- [Dependency vulnerability checks](ci/dependency-vulnerability-checks-2026-06-11.md)
- [Dependency license checks](ci/dependency-license-checks-2026-06-11.md)
- [Deferred Rust advisories](security/deferred-rust-advisories.md)

## Fixture And Review Artifacts

- [Onboarding sample project](sample/onboarding-sample-project-2026-06-11.md)
- [Fixture download policy](validation/fixture-download-policy-2026-06-11.md)
- [Public fixture manifest](validation/public-fixture-manifest-2026-06-11.md)
- [Performance smoke](validation/performance-smoke-2026-06-13.md)
- [Goal review page](validation/goal-review-2026-06-11.html)
- [Render baseline](baseline/rapidraw-render-baseline-2026-06-10.md)

## Release Docs

- [Unsigned release artifact workflow](release/unsigned-release-artifact-workflow-2026-06-11.md)
- [macOS signing and notarization placeholders](release/macos-signing-notarization-placeholders-2026-06-11.md)
- [Update mechanism research](release/update-mechanism-research-2026-06-11.md)
- [macOS signing plan](release/macos-signing-plan-2026-06-11.md)
- [macOS notarization workflow](release/macos-notarization-workflow-2026-06-11.md)
- [Release notes automation](release/release-notes-automation-2026-06-13.md)
- [Release metadata, checksums, and SBOM](release/release-metadata-checksums-sbom-2026-06-11.md)

## Site Rules

- Keep `docs/index.md` as the human entry point until a static-site generator is
  selected.
- Keep `docs/site-navigation.json` in sync with this page so future tooling can
  generate a sidebar without scraping Markdown.
- Link only committed files. Planned docs belong in GitHub issues or
  `RAW_EDITOR_PLAN.md`, not as broken links.
