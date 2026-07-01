#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';
import type { ExportReceiptOutput } from '../../../../src/components/ui/ExportImportProperties.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  buildColorStackPreviewExportParityReceipt,
  colorStackPreviewExportParityReceiptV1Schema,
} from '../../../../src/utils/colorStackPreviewExportParityReceipt.ts';
import { renderColorStackPreviewExportParityProof } from '../../../../src/utils/colorStackPreviewExportParityRuntime.ts';

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
  channelMixer: {
    ...INITIAL_ADJUSTMENTS.channelMixer,
    blue: { blue: 94, constant: 0, green: 4, red: 2 },
    enabled: true,
    green: { blue: 2, constant: 0, green: 102, red: -4 },
    red: { blue: 0, constant: 0, green: -3, red: 105 },
  },
  colorBalanceRgb: {
    ...INITIAL_ADJUSTMENTS.colorBalanceRgb,
    enabled: true,
    highlights: { blue: -4, green: 1, red: 5 },
    midtones: { blue: -2, green: 0, red: 3 },
    shadows: { blue: 4, green: 0, red: -2 },
  },
  colorGrading: {
    ...INITIAL_ADJUSTMENTS.colorGrading,
    balance: 8,
    blending: 60,
    global: { hue: 38, luminance: 1, saturation: 6 },
    highlights: { hue: 44, luminance: 1, saturation: 5 },
    midtones: { hue: 34, luminance: 1, saturation: 7 },
    shadows: { hue: 218, luminance: -2, saturation: 5 },
  },
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

const runtimeProof = renderColorStackPreviewExportParityProof({
  adjustments: adjustedColorStack,
  colorStylePresetId: 'color_style.cinematic.warm_shadow_rolloff.v1',
});

if (runtimeProof.status !== 'passed') {
  throw new Error(`Expected runtime parity proof to pass: ${runtimeProof.diagnostics.messages.join('; ')}`);
}
if (runtimeProof.previewHash !== runtimeProof.exportHash) {
  throw new Error('Preview/export runtime proof hashes must match.');
}
if (runtimeProof.sourceHash === runtimeProof.previewHash) {
  throw new Error('Runtime proof must change the representative source image.');
}
if (runtimeProof.baselinePreviewChangedPixelRatio <= 0) {
  throw new Error('Runtime proof must report changed preview pixels.');
}
if (runtimeProof.maxRgb8MeanAbsDelta !== 0 || runtimeProof.meanRgb8AbsDelta !== 0) {
  throw new Error('Runtime proof must prove exact RGB8 preview/export parity for the shared color stack.');
}
for (const requiredStage of [
  'profile_tone',
  'color_style_preset',
  'hsl_selective_color',
  'skin_tone_uniformity',
  'color_balance_rgb',
  'channel_mixer',
  'color_grading',
] as const) {
  if (!runtimeProof.stageOrder.includes(requiredStage)) {
    throw new Error(`Runtime proof missing color stack stage: ${requiredStage}.`);
  }
}

const matchedReceipt = colorStackPreviewExportParityReceiptV1Schema.parse(
  buildColorStackPreviewExportParityReceipt({
    adjustments: adjustedColorStack,
    colorStylePresetId: 'color_style.cinematic.warm_shadow_rolloff.v1',
    exportOutput,
    exportSoftProofTransform: {
      effectiveColorProfile: 'Display P3',
      effectiveRenderingIntent: 'Perceptual',
    },
    isExportSoftProofEnabled: true,
    runtimeProof,
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
if (matchedReceipt.colorStylePresetId !== 'color_style.cinematic.warm_shadow_rolloff.v1') {
  throw new Error('Color stack parity receipt lost style preset identity.');
}
if (!matchedReceipt.components.skinToneUniformityEnabled) {
  throw new Error('Color stack parity receipt lost skin-tone uniformity state.');
}
if (
  !matchedReceipt.components.colorBalanceRgbEnabled ||
  !matchedReceipt.components.channelMixerEnabled ||
  !matchedReceipt.components.colorGradingEnabled
) {
  throw new Error('Color stack parity receipt lost runtime color component state.');
}
if (matchedReceipt.components.selectiveColorRangeCount <= 0) {
  throw new Error('Color stack parity receipt must include selective color range coverage.');
}
if (matchedReceipt.tolerance.metric !== 'mean_abs_delta_rgb8' || matchedReceipt.tolerance.maxRgb8MeanAbsDelta !== 0) {
  throw new Error('Color stack parity receipt must name its measured preview/export tolerance.');
}
if (matchedReceipt.runtimeProof?.renderer !== 'color_stack_runtime_v1') {
  throw new Error('Color stack parity receipt must include the runtime proof renderer.');
}
if (
  matchedReceipt.runtimeProof.sourceHash !== runtimeProof.sourceHash ||
  matchedReceipt.runtimeProof.previewHash !== runtimeProof.previewHash ||
  matchedReceipt.runtimeProof.exportHash !== runtimeProof.exportHash
) {
  throw new Error('Color stack parity receipt lost source/preview/export runtime hashes.');
}
if (
  matchedReceipt.colorManagement.workingProfile !== 'rawengine-linear-rgb' ||
  matchedReceipt.colorManagement.displayProfile !== 'editor-preview-srgb' ||
  matchedReceipt.colorManagement.exportProfile !== 'Display P3' ||
  matchedReceipt.colorManagement.exportRenderingIntent !== 'Perceptual'
) {
  throw new Error('Color stack parity receipt lost color-management assumptions.');
}
if (matchedReceipt.diagnostics.failureDomain !== 'none' || matchedReceipt.diagnostics.messages.length !== 0) {
  throw new Error('Matched runtime proof should not report diagnostics.');
}

const warningReceipt = colorStackPreviewExportParityReceiptV1Schema.parse(
  buildColorStackPreviewExportParityReceipt({
    adjustments: adjustedColorStack,
    colorStylePresetId: 'color_style.cinematic.warm_shadow_rolloff.v1',
    exportOutput,
    exportSoftProofTransform: {
      effectiveColorProfile: 'sRGB',
      effectiveRenderingIntent: 'Relative Colorimetric',
    },
    isExportSoftProofEnabled: true,
    runtimeProof,
  }),
);

if (warningReceipt.status !== 'warning') {
  throw new Error(`Expected warning parity status, got ${warningReceipt.status}.`);
}
if (!warningReceipt.mismatches.includes('profile') || !warningReceipt.mismatches.includes('rendering_intent')) {
  throw new Error(`Expected profile and intent mismatches, got ${warningReceipt.mismatches.join(',')}.`);
}
if (
  !warningReceipt.colorManagement.gamutWarnings.includes('profile_mismatch') ||
  !warningReceipt.colorManagement.gamutWarnings.includes('rendering_intent_mismatch')
) {
  throw new Error('Expected profile/rendering-intent gamut warnings.');
}
if (warningReceipt.diagnostics.failureDomain !== 'metadata') {
  throw new Error(`Expected metadata failure domain, got ${warningReceipt.diagnostics.failureDomain}.`);
}
if (warningReceipt.activeColorStackHash !== matchedReceipt.activeColorStackHash) {
  throw new Error('Preview/export transform mismatch must not change the active color stack hash.');
}

const inactiveProofReceipt = buildColorStackPreviewExportParityReceipt({
  adjustments: adjustedColorStack,
  exportOutput,
  exportSoftProofTransform: null,
  isExportSoftProofEnabled: false,
  runtimeProof,
});
if (!inactiveProofReceipt.mismatches.includes('soft_proof_inactive')) {
  throw new Error('Inactive soft proof must be recorded as a parity warning.');
}

const exportPanelSource = await readFile('src/components/panel/right/export/ExportPanel.tsx', 'utf8');
for (const marker of [
  'buildColorStackPreviewExportParityReceipt',
  'data-color-stack-parity-hash={colorStackParityReceipt?.activeColorStackHash',
  'data-color-stack-parity-status={colorStackParityReceipt?.status',
  'data-color-stack-parity-runtime-source-hash={colorStackParityReceipt?.runtimeProof?.sourceHash',
  'data-color-stack-parity-runtime-preview-hash={colorStackParityReceipt?.runtimeProof?.previewHash',
  'data-color-stack-parity-runtime-export-hash={colorStackParityReceipt?.runtimeProof?.exportHash',
  'data-color-stack-parity-runtime-delta={colorStackParityReceipt?.runtimeProof?.maxRgb8MeanAbsDelta',
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

console.log(
  `color stack preview/export runtime parity ok (${runtimeProof.sourcePixelCount} pixels, ${runtimeProof.stageOrder.length} stages)`,
);
