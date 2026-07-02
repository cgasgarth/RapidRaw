import { expect, test } from 'bun:test';

import { hdrRuntimePlanSchema } from '../../../src/schemas/computational-merge/hdrMergeUiSchemas';
import { parseHdrCompletePayload } from '../../../src/schemas/tauriEventSchemas';
import { buildHdrApplyCommandState } from '../../../src/utils/computational-merge/computationalMergeModalState';

test('HDR dry-run plan reports warnings, blocks, exposure spacing, and memory estimate', () => {
  const plan = hdrRuntimePlanSchema.parse({
    accepted: false,
    acceptedDryRunPlanHash: 'blake3:runtime-plan',
    acceptedDryRunPlanId: 'hdr_runtime_plan_deadbeef',
    blockCodes: ['dimension_mismatch'],
    bracketCount: 3,
    dimensionWarnings: ['source_dimensions_do_not_match'],
    estimatedMemory: {
      mergeBufferMb: 96,
      previewBufferMb: 16,
      totalMb: 112,
    },
    exposureSpacing: {
      maxStepEv: 2,
      minStepEv: 1,
      spanEv: 3,
      stepCount: 2,
    },
    metadataWarnings: ['narrow_exposure_span'],
    previewDimensions: {
      height: 3000,
      width: 4000,
    },
    sourcePaths: ['/tmp/bracket_-1ev.tif', '/tmp/bracket_0ev.tif', '/tmp/bracket_+1ev.tif'],
    sources: [
      {
        contentHash: 'blake3:source-0',
        dimensions: { height: 3000, width: 4000 },
        exposure: { exposureEv: -1, exposureTimeSeconds: 0.004, iso: 100 },
        path: '/tmp/bracket_-1ev.tif',
        sourceIndex: 0,
      },
      {
        contentHash: 'blake3:source-1',
        dimensions: { height: 3000, width: 4000 },
        exposure: { exposureEv: 0, exposureTimeSeconds: 0.008, iso: 100 },
        path: '/tmp/bracket_0ev.tif',
        sourceIndex: 1,
      },
      {
        contentHash: 'blake3:source-2',
        dimensions: { height: 2900, width: 4000 },
        exposure: { exposureEv: 1, exposureTimeSeconds: 0.016, iso: 100 },
        path: '/tmp/bracket_+1ev.tif',
        sourceIndex: 2,
      },
    ],
    warningCodes: ['source_dimensions_do_not_match', 'narrow_exposure_span'],
  });

  expect(plan.accepted).toBe(false);
  expect(plan.bracketCount).toBe(3);
  expect(plan.exposureSpacing?.spanEv).toBe(3);
  expect(plan.estimatedMemory.totalMb).toBe(112);
  expect(plan.blockCodes).toContain('dimension_mismatch');
  expect(plan.dimensionWarnings).toContain('source_dimensions_do_not_match');
  expect(plan.metadataWarnings).toContain('narrow_exposure_span');
});

test('HDR apply receipt parser feeds accepted runtime plan identity into command state', () => {
  const payload = parseHdrCompletePayload({
    base64: 'data:image/png;base64,abc123',
    receipt: {
      acceptedDryRunPlanHash: 'blake3:accepted-plan',
      acceptedDryRunPlanId: 'hdr_runtime_plan_1234',
      mergeMethod: 'exposure_weighted_radiance',
      mergeVersion: '0.1.0',
      outputContentHash: 'blake3:hdr-runtime-output',
      outputHandle: 'memory:hdr_result',
      previewDimensions: {
        height: 1200,
        width: 1600,
      },
      sourceRoles: [
        { exposureEv: -1, role: 'under_exposed', sourceIndex: 0 },
        { exposureEv: 0, role: 'reference', sourceIndex: 1 },
      ],
      sourcePaths: ['/tmp/bracket_-1ev.tif', '/tmp/bracket_0ev.tif'],
      warningCodes: ['legacy_full_frame_render'],
    },
  });
  const applyState = buildHdrApplyCommandState({
    acceptedDryRunPlanHash: payload.receipt.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: payload.receipt.acceptedDryRunPlanId,
    base64Length: payload.base64.length,
    outputHandle: payload.receipt.outputHandle,
    previewDimensions: payload.receipt.previewDimensions,
    sourceCount: payload.receipt.sourcePaths.length,
    sourcePaths: payload.receipt.sourcePaths,
  });

  expect(applyState.acceptedDryRunPlanHash).toBe('blake3:accepted-plan');
  expect(applyState.acceptedDryRunPlanId).toBe('hdr_runtime_plan_1234');
  expect(applyState.outputHandle).toBe('memory:hdr_result');
  expect(applyState.previewDimensions).toEqual({ height: 1200, width: 1600 });
  expect(applyState.sourcePaths).toEqual(['/tmp/bracket_-1ev.tif', '/tmp/bracket_0ev.tif']);
  expect(applyState.sources).toBe(2);
});
