#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../../src/schemas/computational-merge/hdrMergeUiSchemas.ts';
import { buildHdrEditableHandoffSummary } from '../../../../src/utils/hdrEditableHandoff.ts';

const mergeStatusSource = readFileSync('src/components/modals/computational-merge/MergeStatusViews.tsx', 'utf8');
const hdrModalSource = readFileSync('src/components/modals/computational-merge/HdrModal.tsx', 'utf8');
const appModalsSource = readFileSync('src/components/modals/AppModals.tsx', 'utf8');
const hdrRuntimeSource = readFileSync('src-tauri/src/lib.rs', 'utf8');
const hdrRuntimePlanSource = readFileSync('packages/rawengine-schema/src/hdr/hdrRuntimePlan.ts', 'utf8');
const visualSmokeSource = readFileSync('scripts/proofs/capture-visual-smoke.ts', 'utf8');

for (const marker of [
  'data-testid="merge-open-saved-output"',
  'data-open-target-path={savedPath}',
  'onClick={onOpen}',
]) {
  if (!mergeStatusSource.includes(marker)) {
    throw new Error(`HDR editable handoff open-control marker missing: ${marker}`);
  }
}

for (const marker of [
  'onOpenFile(openPath);',
  'buildHdrEditableHandoffSummary',
  'deghostReviewAccepted: isDeghostReviewApproved',
  'deghostReviewRequired: isDeghostReviewRequired',
  'data-deghost-review-accepted={String(handoffSummary.deghostReviewAccepted)}',
  'data-deghost-review-required={String(handoffSummary.deghostReviewRequired)}',
  'data-display-preview-color-state={handoffSummary.displayPreviewColorState}',
  'data-export-color-state={handoffSummary.exportColorState}',
  "data-preview-export-compared-fields={handoffSummary.previewExportParity.comparedFields.join(',')}",
  'data-preview-export-export-receipt-hash={handoffSummary.previewExportParity.exportReceiptHash}',
  'data-preview-export-proof-hash={handoffSummary.previewExportParity.parityProofHash}',
  'data-preview-export-preview-state-hash={handoffSummary.previewExportParity.previewStateHash}',
  'data-preview-export-parity-status={handoffSummary.previewExportParityStatus}',
  'data-scene-merge-color-state={handoffSummary.sceneMergeColorState}',
  'data-testid="hdr-editable-handoff-provenance"',
  'data-testid="hdr-derived-output-receipt-store-entry"',
  "data-hdr-derived-source-open-path={storedDerivedOutputReceipt.openInEditorAction.path ?? ''}",
  'const receipt = buildHdrDerivedOutputReceipt({ handoff, settings });',
  'upsertDerivedOutputReceipt(receipt);',
  'const openPath = storedDerivedOutputReceipt?.openInEditorAction.path ?? savedPath;',
  "openInEditor: t('modals.hdr.openInEditor')",
  'savedPath={savedPath}',
]) {
  if (!hdrModalSource.includes(marker)) {
    throw new Error(`HDR modal editable handoff marker missing: ${marker}`);
  }
}

for (const marker of ['props.handleImageSelect(path);', 'onSave={props.handleSaveHdr}']) {
  if (!appModalsSource.includes(marker)) {
    throw new Error(`HDR app modal editor handoff marker missing: ${marker}`);
  }
}

for (const marker of ['write_hdr_output_sidecar(']) {
  if (!hdrRuntimeSource.includes(marker)) {
    throw new Error(`HDR runtime editable artifact marker missing: ${marker}`);
  }
}

for (const marker of [
  'editableDerivedAssetId: `derived_${command.commandId}`',
  "capabilityLevel: 'runtime_apply_capable'",
  'derivedSourceReview',
]) {
  if (!hdrRuntimePlanSource.includes(marker)) {
    throw new Error(`HDR runtime plan editable artifact marker missing: ${marker}`);
  }
}

for (const marker of [
  'hdr-artifact-handoff',
  'hdr-editable-handoff-provenance',
  'displayPreviewColorState',
  '/tmp/rawengine-hdr-smoke.tif',
  'hdr-private-raw-artifact-handoff',
  'previewExportParityStatus',
]) {
  if (!visualSmokeSource.includes(marker)) {
    throw new Error(`HDR visual handoff smoke marker missing: ${marker}`);
  }
}

const handoffSummary = buildHdrEditableHandoffSummary({
  deghostReviewAccepted: true,
  deghostReviewRequired: true,
  outputPath: '/tmp/rawengine-hdr-smoke.tif',
  settings: {
    ...DEFAULT_HDR_MERGE_UI_SETTINGS,
    deghosting: 'high',
    mergeStrategy: 'scene_linear_radiance',
    toneMapPreview: true,
  },
  sourcePaths: [
    '/private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw',
    '/private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw',
    '/private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw',
  ],
});

if (handoffSummary.previewExportParity.status !== handoffSummary.previewExportParityStatus) {
  throw new Error('HDR preview/export parity status must match handoff status.');
}
if (handoffSummary.previewExportParity.meanAbsDelta !== handoffSummary.previewExportMeanAbsDelta) {
  throw new Error('HDR preview/export parity delta must match handoff delta.');
}
for (const hash of [
  handoffSummary.previewExportParity.previewStateHash,
  handoffSummary.previewExportParity.exportReceiptHash,
  handoffSummary.previewExportParity.parityProofHash,
]) {
  if (!/^fnv1a32:[a-f0-9]{8}$/u.test(hash)) {
    throw new Error(`HDR preview/export parity hash is invalid: ${hash}`);
  }
}
if (handoffSummary.previewExportParity.previewStateHash === handoffSummary.previewExportParity.exportReceiptHash) {
  throw new Error('HDR preview state hash and export receipt hash should identify different states.');
}
if (!handoffSummary.previewExportParity.comparedFields.includes('outputPath')) {
  throw new Error('HDR preview/export parity must link the export output path.');
}

console.log('hdr editable handoff ok');
