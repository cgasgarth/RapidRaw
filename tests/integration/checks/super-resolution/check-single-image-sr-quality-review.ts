#!/usr/bin/env bun

import { singleImageX2ReviewSchema } from '../../../../src/schemas/computational-merge/singleImageX2Schemas.ts';

const review = singleImageX2ReviewSchema.parse({
  decision: 'preview_only_blocked',
  manualReviewRequired: true,
  inputHash: `sha256:${'1'.repeat(64)}`,
  outputHash: `sha256:${'2'.repeat(64)}`,
  bicubicHash: `sha256:${'3'.repeat(64)}`,
  modelId: 'fixture',
  modelSha256: 'unavailable',
  downsampleMae: 0.02,
  meanAbsoluteResidual: 0.01,
  maxAbsoluteResidual: 0.1,
  nonfiniteCount: 0,
  tilePolicyId: 'tile-v1',
  colorPolicyId: 'color-v1',
});
if (review.downsampleMae <= 0.015 || review.decision !== 'preview_only_blocked')
  throw new Error('Quality gate fixture was not blocked.');
console.log('single-image SR quality review contract ok');
