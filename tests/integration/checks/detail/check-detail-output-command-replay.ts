#!/usr/bin/env bun

import { z } from 'zod';

import {
  applyDetailOutputComparisonCommand,
  detailOutputComparisonCommandV1Schema,
} from '../../../../src/utils/detailOutputComparisonCommand.ts';

const width = 12;
const height = 8;

const originalCrop = Array.from({ length: width * height }, (_, index) => {
  const x = index % width;
  const y = Math.floor(index / width);
  return Number(Math.min(1, 0.18 + x * 0.04 + y * 0.012 + Math.sin(index * 1.7) * 0.035).toFixed(6));
});

const currentBaselineCrop = originalCrop.map((pixel, index) =>
  Number(Math.min(1, Math.max(0, pixel + Math.cos(index * 0.9) * 0.018)).toFixed(6)),
);

const command = detailOutputComparisonCommandV1Schema.parse({
  actor: { id: 'rapidraw-ui', kind: 'ui', sessionId: 'detail-output-command-proof' },
  approval: {
    approvalClass: 'edit_apply',
    reason: 'Apply accepted 100 percent denoise/detail comparison recipe.',
    state: 'approved',
  },
  commandId: 'detail_output_compare_apply_100_crop',
  commandType: 'detailOutput.applyComparisonRecipe',
  correlationId: 'detail_output_compare_corr',
  dryRun: false,
  expectedGraphRevision: 'detail_output_compare_initial',
  parameters: {
    crop: { height, width, x: 512, y: 384, zoomPercent: 100 },
    recipe: {
      deblur: { deblurEnabled: true, deblurSigmaPx: 0.8, deblurStrength: 70 },
      denoise: { chromaStrength: 0.32, lumaStrength: 0.58 },
      label: 'Denoise + detail 100% review',
      recipeId: 'detail.output.denoise-detail-100.v1',
      stages: ['scene_linear_denoise', 'capture_sharpen', 'wavelet_luma_detail'],
      waveletDetail: {
        coarse: { amount: 0, enabled: false, radiusPx: 18 },
        colorSpace: 'linear_rec2020',
        edgeThreshold: 0.28,
        fine: { amount: 55, enabled: true, radiusPx: 1.2 },
        haloSuppression: 0.8,
        id: 'detail.output.denoise-detail-100.wavelet.v1',
        medium: { amount: 35, enabled: true, radiusPx: 4.8 },
        previewMode: 'before_after',
        schemaVersion: 1,
      },
    },
  },
  schemaVersion: 1,
  target: { imagePath: 'private-fixtures/detail/high-iso-skin-shadow-v1.arw', kind: 'image' },
});

const result = applyDetailOutputComparisonCommand({ command, currentBaselineCrop, originalCrop });
const replay = applyDetailOutputComparisonCommand({ command, currentBaselineCrop, originalCrop });
const deblurDisabled = applyDetailOutputComparisonCommand({
  command: {
    ...command,
    commandId: 'detail_output_compare_without_deblur',
    parameters: {
      ...command.parameters,
      recipe: {
        ...command.parameters.recipe,
        deblur: { ...command.parameters.recipe.deblur, deblurEnabled: false, deblurStrength: 0 },
      },
    },
  },
  currentBaselineCrop,
  originalCrop,
});
const failures: Array<string> = [];

if (JSON.stringify(result) !== JSON.stringify(replay)) failures.push('detail output command replay is not stable');
if (result.changedPixelRatio <= 0.25) failures.push('detail recipe changed too few 100 percent crop pixels');
if (result.enabledExportHash === result.disabledExportHash)
  failures.push('enabled export must differ from disabled export');
if (result.previewHash !== result.enabledExportHash) failures.push('preview/export recipe hashes must match');
if (result.previewHash === deblurDisabled.previewHash) failures.push('deblur control must change detail output');
if (!result.warnings.includes('halo_risk_review') || !result.warnings.includes('oversmoothing_review')) {
  failures.push('detail output command must carry halo and oversmoothing review warnings');
}

const invalidCrop = detailOutputComparisonCommandV1Schema.parse({
  ...command,
  commandId: 'detail_output_compare_bad_crop',
  parameters: { ...command.parameters, crop: { ...command.parameters.crop, width: width + 1 } },
});
const invalidResult = z
  .function({ input: [], output: z.unknown() })
  .implement(() => applyDetailOutputComparisonCommand({ command: invalidCrop, currentBaselineCrop, originalCrop }));
try {
  invalidResult();
  failures.push('detail output command accepted mismatched crop dimensions');
} catch {
  // Expected.
}

if (failures.length > 0) {
  console.error('detail output command replay failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`detail output command replay ok (${result.changedPixelRatio.toFixed(3)} changed)`);
