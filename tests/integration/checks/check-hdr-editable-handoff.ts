#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const mergeStatusSource = readFileSync('src/components/modals/MergeStatusViews.tsx', 'utf8');
const hdrModalSource = readFileSync('src/components/modals/HdrModal.tsx', 'utf8');
const appModalsSource = readFileSync('src/components/modals/AppModals.tsx', 'utf8');
const hdrRuntimeSource = readFileSync('src-tauri/src/lib.rs', 'utf8');
const visualSmokeSource = readFileSync('scripts/capture-visual-smoke.ts', 'utf8');

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
  'onOpenFile(savedPath);',
  'buildHdrEditableHandoffSummary',
  'deghostReviewAccepted: isDeghostReviewApproved',
  'deghostReviewRequired: isDeghostReviewRequired',
  'data-deghost-review-accepted={String(handoffSummary.deghostReviewAccepted)}',
  'data-deghost-review-required={String(handoffSummary.deghostReviewRequired)}',
  'data-testid="hdr-editable-handoff-provenance"',
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

for (const marker of [
  '"editableDerivedAssetId": artifact_id',
  '"capabilityLevel": "runtime_apply_capable"',
  'write_hdr_output_sidecar_records_editable_artifact_provenance',
]) {
  if (!hdrRuntimeSource.includes(marker)) {
    throw new Error(`HDR runtime editable artifact marker missing: ${marker}`);
  }
}

for (const marker of [
  'hdr-artifact-handoff',
  'hdr-editable-handoff-provenance',
  '/tmp/rawengine-hdr-smoke.tif',
  'hdr-private-raw-artifact-handoff',
]) {
  if (!visualSmokeSource.includes(marker)) {
    throw new Error(`HDR visual handoff smoke marker missing: ${marker}`);
  }
}

console.log('hdr editable handoff ok');
