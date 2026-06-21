#!/usr/bin/env bun

import { negativeLabQcProofArtifactV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../../src/utils/negativeLabDustScratchReview.ts';
import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negativeLabFrameHealth.ts';
import { buildNegativeLabQcContactSheetArtifact } from '../../../src/utils/negativeLabQcContactSheetArtifact.ts';

const sourcePaths = ['/roll/frame-01.tif', '/roll/frame-02.tif', '/roll/frame-03.tif'];
const includedPathSet = new Set(sourcePaths.slice(0, 2));
const frameHealth = buildNegativeLabFrameHealthReport({
  activePathIndex: 1,
  baseFogConfidence: 0.86,
  includedPathSet,
  previewReady: true,
  targetPaths: sourcePaths,
});
const review = buildNegativeLabDustScratchReviewReport(frameHealth, true);
const report = buildNegativeLabQcProofReport(review, true, false);
const sourcePathsByFrameId = new Map(frameHealth.frames.map((frame) => [frame.frameId, frame.sourcePath] as const));
const artifact = negativeLabQcProofArtifactV1Schema.parse(
  buildNegativeLabQcContactSheetArtifact({
    generatedAt: '2026-06-21T00:00:00.000Z',
    report,
    sessionId: 'negative_lab_session_live_qc_test',
    sourcePathsByFrameId,
  }),
);
const repeated = buildNegativeLabQcContactSheetArtifact({
  generatedAt: '2026-06-21T00:00:00.000Z',
  report,
  sessionId: 'negative_lab_session_live_qc_test',
  sourcePathsByFrameId,
});

if (artifact.contactSheet.columns !== 3 || artifact.contactSheet.rows !== 1) {
  throw new Error('Negative Lab live QC artifact did not preserve contact-sheet grid geometry.');
}

if (
  artifact.frameIds.length !== report.totalFrameCount ||
  artifact.positiveVariants.length !== report.totalFrameCount
) {
  throw new Error('Negative Lab live QC artifact did not preserve per-frame positive variants.');
}

if (artifact.warnings.length !== 1 || artifact.warnings[0]?.frameIds?.[0] !== 'negative-lab-frame-3') {
  throw new Error('Negative Lab live QC artifact did not expose blocked-frame warning evidence.');
}

if (artifact.positiveVariants[0]?.sourcePath !== sourcePaths[0]) {
  throw new Error('Negative Lab live QC artifact did not link source paths to positive variants.');
}

if (artifact.contactSheet.artifact.contentHash !== repeated.contactSheet.artifact.contentHash) {
  throw new Error('Negative Lab live QC artifact hash is not deterministic.');
}

const modalSource = await Bun.file('src/components/modals/NegativeConversionModal.tsx').text();
for (const marker of [
  'buildNegativeLabQcContactSheetArtifact',
  'negative-lab-qc-proof-artifact',
  'data-contact-sheet-hash={qcProofArtifact.contactSheet.artifact.contentHash}',
  'modals.negativeConversion.qcProofArtifactHash',
]) {
  if (!modalSource.includes(marker)) {
    throw new Error(`Negative Lab live QC UI marker missing: ${marker}`);
  }
}

console.log(`negative lab qc live artifact ok (${artifact.frameIds.length} frames)`);
