#!/usr/bin/env bun

import {
  singleImageX2CapabilitySchema,
  singleImageX2PreviewSchema,
} from '../../../../src/schemas/computational-merge/singleImageX2Schemas.ts';

singleImageX2CapabilitySchema.parse({
  schemaVersion: 1,
  available: false,
  modelId: 'swinir-classical-df2k-x2-medium-opset17-v1',
  modelSizeBytes: 0,
  sourceUrl: 'https://github.com/JingyunLiang/SwinIR/releases/tag/v0.0',
  codeLicense: 'Apache-2.0',
  weightLicenseStatus: 'redistribution_unverified',
  reason: 'weight_redistribution_unverified_no_distributed_onnx',
});
const parsed = singleImageX2PreviewSchema.safeParse({ schemaVersion: 1, width: 5, height: 7 });
if (parsed.success) throw new Error('Native preview schema accepted an incomplete/non-x2 result.');
console.log('single-image SR native preview contract ok');
