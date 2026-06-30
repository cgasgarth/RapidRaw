#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { negativeLabUpdateBaseSamplesCommandV1Schema } from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  buildNegativeLabBaseSampleDecisionProof,
  buildNegativeLabBaseSamplePreviewProof,
  type NegativeLabBaseSamplePreviewProofContext,
} from '../../../../src/utils/negative-lab/negativeLabBaseSampleCommandBridge.ts';

const modalSource = readFileSync('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');

const estimate = {
  baseDensity: [0.12, 0.24, 0.37],
  baseRgb: [0.759, 0.575, 0.427],
  blueWeight: 1.22,
  confidence: 0.82,
  greenWeight: 1.04,
  redWeight: 0.72,
} as const;

const context: NegativeLabBaseSamplePreviewProofContext = {
  estimate,
  frameId: 'frame_1',
  imagePath: '/fixtures/negative-lab/base-sampling-studio-synthetic.tif',
  previewBeforeUrl: 'data:image/svg+xml,%3Csvg%3Ebefore%3C%2Fsvg%3E',
  sampleRect: {
    height: 0.16,
    width: 0.2,
    x: 0.04,
    y: 0.72,
  },
  source: 'custom_rect',
};

const candidateProof = buildNegativeLabBaseSamplePreviewProof(
  context,
  'data:image/svg+xml,%3Csvg%3Eafter%3C%2Fsvg%3E',
  {
    densityRange: 0.25,
    dominantChannel: 'blue',
    status: 'strong_cast',
  },
  4,
);
const acceptedFrameProof = buildNegativeLabBaseSampleDecisionProof(candidateProof, 'accepted', 'frame');
const acceptedRollProof = buildNegativeLabBaseSampleDecisionProof(candidateProof, 'accepted', 'roll');
const rejectedProof = buildNegativeLabBaseSampleDecisionProof(candidateProof, 'rejected', 'frame', 'manual');

for (const proof of [candidateProof, acceptedFrameProof, acceptedRollProof, rejectedProof]) {
  negativeLabUpdateBaseSamplesCommandV1Schema.parse(proof.command);
}

const failures: string[] = [];

const candidateRecord = candidateProof.command.parameters.sampleRecords[0];
const acceptedFrameRecord = acceptedFrameProof.command.parameters.sampleRecords[0];
const acceptedRollRecord = acceptedRollProof.command.parameters.sampleRecords[0];
const rejectedRecord = rejectedProof.command.parameters.sampleRecords[0];

if (candidateProof.sampleStatus !== 'candidate' || candidateProof.command.parameters.sampleEditMode !== 'replace') {
  failures.push('candidate proof must preserve replace/candidate command state.');
}
if (
  acceptedFrameProof.sampleStatus !== 'accepted' ||
  acceptedFrameProof.command.parameters.sampleEditMode !== 'accept'
) {
  failures.push('accepted frame proof must emit accept/accepted command state.');
}
if (acceptedFrameRecord?.sampleScope !== 'frame' || acceptedFrameRecord?.sampleStats === undefined) {
  failures.push('accepted frame proof must retain measured sample stats with frame scope.');
}
if (acceptedRollProof.sampleScope !== 'roll' || acceptedRollRecord?.sampleScope !== 'roll') {
  failures.push('roll promotion proof must switch proof and sample record scope to roll.');
}
if (
  rejectedProof.sampleStatus !== 'rejected' ||
  rejectedProof.command.parameters.sampleEditMode !== 'reject' ||
  rejectedProof.command.parameters.rejectionReason !== 'manual' ||
  rejectedRecord?.rejectionReason !== 'manual'
) {
  failures.push('rejected proof must emit reject/rejected state with an explicit manual reason.');
}
if (rejectedProof.command.parameters.sampleRecords.some((record) => record.status !== 'rejected')) {
  failures.push('rejected proof must not leave candidate records available for conversion.');
}
if (candidateRecord?.sampleRegion.geometry.coordinateSpace !== 'normalized_frame') {
  failures.push('candidate proof must keep normalized frame geometry.');
}
if (candidateRecord?.sampleRegion.geometry.x !== context.sampleRect?.x) {
  failures.push('candidate proof geometry must carry the selected sample rect.');
}

for (const marker of [
  'data-testid="negative-lab-base-sampling-studio"',
  'data-decision={baseSampleStudioDecision}',
  'data-testid="negative-lab-base-preview-proof"',
  'data-sample-status={baseFogPreviewProof.sampleStatus}',
  'data-sample-command-status=',
  'data-sample-scope={baseFogPreviewProof.sampleScope}',
  "data-rejection-reason={baseFogPreviewProof.rejectionReason ?? ''}",
  "buildNegativeLabBaseSampleDecisionProof(proof, 'accepted', 'roll')",
  "buildNegativeLabBaseSampleDecisionProof(baseFogPreviewProof, 'rejected', baseFogScope, 'manual')",
]) {
  if (!modalSource.includes(marker)) {
    failures.push(`base sampling studio UI marker missing: ${marker}`);
  }
}

if (failures.length > 0) {
  console.error(`negative lab base sampling studio failed (${failures.length})`);
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('negative lab base sampling studio ok (candidate/accepted/rejected proof records)');
