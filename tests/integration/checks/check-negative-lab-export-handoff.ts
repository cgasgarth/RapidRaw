#!/usr/bin/env bun

import { buildNegativeLabDustScratchReviewReport } from '../../../src/utils/negativeLabDustScratchReview.ts';
import {
  buildNegativeLabExportReadiness,
  buildNegativeLabPositiveHandoffReadiness,
  buildNegativeLabWorkspaceProof,
  type NegativeLabPositiveVariant,
  selectNegativeLabActivePositiveVariant,
} from '../../../src/utils/negativeLabExportHandoff.ts';
import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negativeLabFrameHealth.ts';

const ready = buildNegativeLabExportReadiness({
  baseReady: true,
  batchPlanAccepted: true,
  isLoading: false,
  isSaving: false,
  pathCount: 2,
  previewReady: true,
  requiresAcceptedBatchPlan: true,
});

if (!ready.canSave || ready.saveBlockedReasonKey !== null) {
  throw new Error('ready export handoff should allow saving without a blocked reason');
}

const blockedByBatchPlan = buildNegativeLabExportReadiness({
  baseReady: true,
  batchPlanAccepted: false,
  isLoading: false,
  isSaving: false,
  pathCount: 2,
  previewReady: true,
  requiresAcceptedBatchPlan: true,
});

if (
  blockedByBatchPlan.canSave ||
  blockedByBatchPlan.saveBlockedReasonKey !== 'modals.negativeConversion.agentDryRunBlocked'
) {
  throw new Error('multi-frame export should require an accepted batch plan');
}

const targetPaths = ['/roll/001.tif', '/roll/002.tif'];
const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.9,
  includedPathSet: new Set(targetPaths),
  previewReady: true,
  targetPaths,
});
const reviewReport = buildNegativeLabDustScratchReviewReport(frameHealthReport, true);
const workspaceProof = buildNegativeLabWorkspaceProof({
  canSave: true,
  previewReady: true,
  queuedCount: targetPaths.length,
  reviewReport,
  targetCount: targetPaths.length,
});

if (workspaceProof.activeStage !== 'export' || !workspaceProof.exportReady || !workspaceProof.previewReady) {
  throw new Error('workspace proof did not preserve export-ready state');
}

const variants: NegativeLabPositiveVariant[] = [
  {
    frameId: 'frame-1',
    operationId: 'op-1',
    outputArtifact: {
      artifactId: 'artifact-1',
      contentHash: 'sha256:1',
      dimensions: { height: 400, width: 600 },
      kind: 'preview',
      storage: 'temp_cache',
    },
    outputIntent: 'editable_positive',
    sourceContentHash: 'sha256:source-1',
    sourcePath: '/roll/001.tif',
    warnings: [],
  },
  {
    frameId: 'frame-2',
    operationId: 'op-2',
    outputArtifact: {
      artifactId: 'artifact-2',
      contentHash: 'sha256:2',
      dimensions: { height: 400, width: 600 },
      kind: 'preview',
      storage: 'temp_cache',
    },
    outputIntent: 'editable_positive',
    sourceContentHash: 'sha256:source-2',
    sourcePath: '/roll/002.tif',
    warnings: [],
  },
];

const activeVariant = selectNegativeLabActivePositiveVariant(variants, 'frame-2');
if (activeVariant?.frameId !== 'frame-2') {
  throw new Error('active positive variant should prefer the active frame id');
}

if (
  !buildNegativeLabPositiveHandoffReadiness({
    activePositiveVariant: activeVariant,
    canSave: true,
    qcExportReady: true,
  })
) {
  throw new Error('positive handoff should be ready for export-ready variants without warnings');
}

console.log('negative lab export handoff ok');
