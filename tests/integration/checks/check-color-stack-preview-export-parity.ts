#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';
import type { ExportReceiptOutput } from '../../../src/components/ui/ExportImportProperties.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  buildColorStackPreviewExportParityReceipt,
  colorStackPreviewExportParityReceiptV1Schema,
} from '../../../src/utils/colorStackPreviewExportParityReceipt.ts';

const exportOutput: ExportReceiptOutput = {
  bitDepth: 16,
  byteSize: 4096,
  colorProfile: 'Display P3',
  effectiveColorProfile: 'Display P3',
  effectiveRenderingIntent: 'Perceptual',
  format: 'tiff',
  iccEmbedded: true,
  outputPath: '/validation/color-stack-parity.tiff',
  renderingIntent: 'Perceptual',
  requestedColorProfile: 'Display P3',
  requestedRenderingIntent: 'Perceptual',
  sourcePath: '/validation/color-stack-parity.raw',
  transformApplied: true,
};

const adjustedColorStack = {
  ...INITIAL_ADJUSTMENTS,
  cameraProfile: 'camera_portrait',
  hsl: {
    ...INITIAL_ADJUSTMENTS.hsl,
    oranges: { hue: 3, luminance: 4, saturation: 12 },
  },
  selectiveColorRangeControls: {
    ...INITIAL_ADJUSTMENTS.selectiveColorRangeControls,
    oranges: {
      ...INITIAL_ADJUSTMENTS.selectiveColorRangeControls.oranges,
      widthDegrees: 52,
    },
  },
  skinToneUniformity: {
    ...INITIAL_ADJUSTMENTS.skinToneUniformity,
    enabled: true,
  },
  toneCurve: 'soft_contrast',
} satisfies Parameters<typeof buildColorStackPreviewExportParityReceipt>[0]['adjustments'];

const matchedReceipt = colorStackPreviewExportParityReceiptV1Schema.parse(
  buildColorStackPreviewExportParityReceipt({
    adjustments: adjustedColorStack,
    colorStylePresetId: 'color_style.portrait_soft_warm.v1',
    exportOutput,
    exportSoftProofTransform: {
      effectiveColorProfile: 'Display P3',
      effectiveRenderingIntent: 'Perceptual',
    },
    isExportSoftProofEnabled: true,
  }),
);

if (matchedReceipt.status !== 'matched') {
  throw new Error(`Expected matched parity status, got ${matchedReceipt.status}.`);
}
if (
  matchedReceipt.components.cameraProfile !== 'camera_portrait' ||
  matchedReceipt.components.toneCurve !== 'soft_contrast'
) {
  throw new Error('Color stack parity receipt lost profile/tone identity.');
}
if (matchedReceipt.colorStylePresetId !== 'color_style.portrait_soft_warm.v1') {
  throw new Error('Color stack parity receipt lost style preset identity.');
}
if (!matchedReceipt.components.skinToneUniformityEnabled) {
  throw new Error('Color stack parity receipt lost skin-tone uniformity state.');
}
if (matchedReceipt.components.selectiveColorRangeCount <= 0) {
  throw new Error('Color stack parity receipt must include selective color range coverage.');
}
if (matchedReceipt.tolerance.metric !== 'exact_rgb8_hash_match') {
  throw new Error('Color stack parity receipt must name its preview/export tolerance.');
}

const warningReceipt = colorStackPreviewExportParityReceiptV1Schema.parse(
  buildColorStackPreviewExportParityReceipt({
    adjustments: adjustedColorStack,
    colorStylePresetId: 'color_style.portrait_soft_warm.v1',
    exportOutput,
    exportSoftProofTransform: {
      effectiveColorProfile: 'sRGB',
      effectiveRenderingIntent: 'Relative Colorimetric',
    },
    isExportSoftProofEnabled: true,
  }),
);

if (warningReceipt.status !== 'warning') {
  throw new Error(`Expected warning parity status, got ${warningReceipt.status}.`);
}
if (!warningReceipt.mismatches.includes('profile') || !warningReceipt.mismatches.includes('rendering_intent')) {
  throw new Error(`Expected profile and intent mismatches, got ${warningReceipt.mismatches.join(',')}.`);
}
if (warningReceipt.activeColorStackHash !== matchedReceipt.activeColorStackHash) {
  throw new Error('Preview/export transform mismatch must not change the active color stack hash.');
}

const inactiveProofReceipt = buildColorStackPreviewExportParityReceipt({
  adjustments: adjustedColorStack,
  exportOutput,
  exportSoftProofTransform: null,
  isExportSoftProofEnabled: false,
});
if (!inactiveProofReceipt.mismatches.includes('soft_proof_inactive')) {
  throw new Error('Inactive soft proof must be recorded as a parity warning.');
}

const exportPanelSource = await readFile('src/components/panel/right/export/ExportPanel.tsx', 'utf8');
for (const marker of [
  'buildColorStackPreviewExportParityReceipt',
  'data-color-stack-parity-hash={colorStackParityReceipt?.activeColorStackHash',
  'data-color-stack-parity-status={colorStackParityReceipt?.status',
  'data-testid="export-success-color-stack-parity"',
  'export.status.colorStackParityTitle',
  'export.status.colorStackParityMatched',
  'export.status.colorStackParityWarning',
]) {
  if (!exportPanelSource.includes(marker)) {
    throw new Error(`ExportPanel missing color stack parity marker: ${marker}.`);
  }
}

const localeSchema = z
  .object({
    export: z
      .object({
        status: z
          .object({
            colorStackParityMatched: z.string().min(1),
            colorStackParityTitle: z.string().min(1),
            colorStackParityWarning: z.string().min(1),
            parityUnknown: z.string().min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
localeSchema.parse(JSON.parse(await readFile('src/i18n/locales/en.json', 'utf8')));

console.log('color stack preview/export parity receipt ok');
