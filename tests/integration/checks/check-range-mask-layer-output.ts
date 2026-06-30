#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

import { renderLayerPreviewStack as renderPackageLayerPreviewStack } from '../../../packages/rawengine-schema/src/layerBlendRuntime.ts';
import { renderComposedMask } from '../../../packages/rawengine-schema/src/maskComposeCommandRuntime.ts';
import { applyComposedMaskToLayerPixels } from '../../../packages/rawengine-schema/src/maskComposeLayerApplication.ts';
import { renderRangeMaskAlphaArtifact } from '../../../packages/rawengine-schema/src/rangeMaskCommandRuntime.ts';
import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  type LayerRgbPixel,
  renderLayerExportStack,
  renderLayerHeadlessStack,
  renderLayerPreviewStack,
} from '../../../src/utils/layerPreviewExportParity.ts';

const OUTPUT_DIR = 'artifacts/layers/range-mask-layer-output';
const width = 4;
const height = 2;
const sourceRgbPixels = z
  .array(z.number().min(0).max(1))
  .length(width * height * 3)
  .parse([
    0.95, 0.05, 0.04, 0.9, 0.25, 0.05, 0.05, 0.35, 0.95, 0.12, 0.12, 0.12, 0.78, 0.08, 0.1, 0.08, 0.72, 0.15, 0.45,
    0.45, 0.45, 0.02, 0.02, 0.02,
  ]);
const sourcePixels = z
  .array(z.number().min(0).max(1))
  .length(width * height)
  .parse([0.08, 0.2, 0.36, 0.52, 0.7, 0.86, 0.42, 0.04]);
const basePixels: Array<LayerRgbPixel> = [
  { r: 28, g: 32, b: 40 },
  { r: 78, g: 82, b: 92 },
  { r: 104, g: 112, b: 132 },
  { r: 52, g: 52, b: 52 },
  { r: 152, g: 92, b: 72 },
  { r: 68, g: 136, b: 88 },
  { r: 122, g: 122, b: 122 },
  { r: 12, g: 12, b: 14 },
];
const warmLayerPixels: Array<LayerRgbPixel> = [
  { r: 188, g: 94, b: 80 },
  { r: 184, g: 116, b: 72 },
  { r: 82, g: 126, b: 212 },
  { r: 72, g: 72, b: 72 },
  { r: 202, g: 88, b: 82 },
  { r: 92, g: 174, b: 108 },
  { r: 150, g: 150, b: 150 },
  { r: 18, g: 18, b: 20 },
];

const luminance = renderRangeMaskAlphaArtifact({
  height,
  maskId: 'mask_range_luminance_midtones',
  selection: { feather: 0.25, maxLuma: 0.75, minLuma: 0.08, rangeKind: 'luminance' },
  source: 'working_rgb',
  sourceRgbPixels,
  width,
});
const color = renderRangeMaskAlphaArtifact({
  height,
  maskId: 'mask_range_color_reds',
  selection: {
    centerHueDegrees: 0,
    feather: 0.4,
    hueToleranceDegrees: 38,
    maxLuma: 1,
    maxSaturation: 1,
    minLuma: 0,
    minSaturation: 0.2,
    rangeKind: 'color',
  },
  source: 'working_rgb',
  sourceRgbPixels,
  width,
});

const buildCommand = () =>
  layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-app-server',
      kind: ActorKind.Agent,
      sessionId: 'session_range_mask_layer_output',
    },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview range mask output before applying layer-scoped pixels.',
      state: 'not_required',
    },
    commandId: 'command_range_mask_layer_output',
    commandType: 'layerMask.combineMasks',
    correlationId: 'corr_range_mask_layer_output',
    dryRun: true,
    expectedGraphRevision: 'graph_rev_range_mask_layer_source',
    parameters: {
      combineMode: 'intersect',
      maskName: 'range mask layer output proof',
      sourceMaskIds: [luminance.artifact.maskId, color.artifact.maskId],
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: '/photos/session/IMG_RANGE_MASK.CR3',
      kind: 'image',
    },
  });

const composed = renderComposedMask({ command: buildCommand(), sourceMasks: [luminance.artifact, color.artifact] });
const output = applyComposedMaskToLayerPixels({
  adjustment: {
    exposureEv: 0.9,
    layerId: 'layer_range_mask_warmth',
    layerName: 'Range mask warmth',
    opacity: 0.8,
  },
  composedMask: {
    alpha: composed.alpha,
    contentHash: composed.contentHash,
    height: composed.height,
    maskId: composed.maskId,
    width: composed.width,
  },
  compositionMode: 'intersect',
  sourceMaskIds: composed.sourceMaskIds,
  sourcePixels,
});
const replay = applyComposedMaskToLayerPixels({
  adjustment: output.sidecarRecord.layer,
  composedMask: {
    alpha: composed.alpha,
    contentHash: output.sidecarRecord.composedMask.contentHash,
    height: output.sidecarRecord.composedMask.height,
    maskId: output.sidecarRecord.composedMask.maskId,
    width: output.sidecarRecord.composedMask.width,
  },
  compositionMode: output.sidecarRecord.composedMask.mode,
  sourceMaskIds: output.sidecarRecord.composedMask.sourceMaskIds,
  sourcePixels,
});
const renderInput = {
  basePixels,
  height,
  layers: [
    {
      blendMode: 'normal' as const,
      id: 'layer_range_mask_warmth',
      maskAlpha: composed.alpha,
      name: 'Range mask warmth',
      opacity: 0.8,
      pixels: warmLayerPixels,
      visible: true,
    },
  ],
  width,
};
const previewRender = renderLayerPreviewStack(renderInput);
const exportRender = renderLayerExportStack(renderInput);
const headlessRender = renderLayerHeadlessStack(renderInput);
const packagePreviewRender = renderPackageLayerPreviewStack(renderInput);
const previewHash = hashPixels(previewRender.pixels);
const exportHash = hashPixels(exportRender.pixels);
const headlessHash = hashPixels(headlessRender.pixels);
const packagePreviewHash = hashPixels(packagePreviewRender.pixels);

const failures: string[] = [];
if (luminance.colorMath !== 'encoded_rgb_hsv_rec709_luma_v1' || color.colorMath !== 'encoded_rgb_hsv_rec709_luma_v1') {
  failures.push('Range masks must record HSV/Rec.709 working-RGB math.');
}
if (luminance.stats.warningCodes.length > 0 || color.stats.warningCodes.length > 0) {
  failures.push('Range mask fixture should not trip weak-selection warnings.');
}
if (luminance.artifact.alpha.every((alpha) => alpha === 0) || color.artifact.alpha.every((alpha) => alpha === 0)) {
  failures.push('Range mask artifacts must produce non-empty alpha.');
}
if (output.changedPixelCount <= 0 || output.maxDelta <= 0) {
  failures.push('Range mask layer output must change pixels.');
}
if (output.outputContentHash !== replay.outputContentHash) {
  failures.push('Range mask sidecar replay must reproduce output hash.');
}
if (output.sidecarRecord.composedMask.coordinateSpace !== 'source_asset_pixels') {
  failures.push('Range mask output sidecar must preserve source pixel coordinate space.');
}
if (output.overlayAlpha.length !== sourcePixels.length || output.overlayAlpha.every((alpha) => alpha === 0)) {
  failures.push('Range mask overlay alpha must cover source pixels.');
}
if (previewHash !== exportHash || previewHash !== headlessHash || previewHash !== packagePreviewHash) {
  failures.push('Range mask preview/export/headless/package hashes must match.');
}
if (previewHash === hashPixels(basePixels)) {
  failures.push('Range mask layer preview must change visible pixels.');
}
if (JSON.stringify(previewRender.coverageByLayer) !== JSON.stringify(exportRender.coverageByLayer)) {
  failures.push('Range mask preview/export coverage must match.');
}
if (previewRender.coverageByLayer[0]?.touchedPixels !== output.changedPixelCount) {
  failures.push('Range mask layer coverage should match composed output changed pixels.');
}

try {
  renderRangeMaskAlphaArtifact({
    height,
    maskId: 'invalid_range_mask',
    selection: { feather: 0.2, maxLuma: 0.8, minLuma: 0.2, rangeKind: 'luminance' },
    source: 'working_rgb',
    sourceRgbPixels: [0.1, 0.2, 0.3],
    width,
  });
  failures.push('Range mask runtime should reject source pixels with wrong dimensions.');
} catch (error) {
  if (!(error instanceof z.ZodError)) failures.push('Range mask dimension rejection should be a Zod error.');
}

if (failures.length > 0) {
  console.error('Range mask layer output validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(
  resolve(OUTPUT_DIR, 'range-mask-layer-output-report.json'),
  `${JSON.stringify(
    {
      changedPixelCount: output.changedPixelCount,
      colorMath: color.colorMath,
      colorStats: color.stats,
      composedMaskHash: composed.contentHash,
      exportHash,
      headlessHash,
      luminanceStats: luminance.stats,
      packagePreviewHash,
      previewExportParity: previewHash === exportHash,
      previewHash,
      sourcePath: '/Users/cgas/Pictures/Capture One/Alaska/IMG_RANGE_MASK.CR3',
    },
    null,
    2,
  )}\n`,
);

console.log(`range mask layer output ok (${width}x${height}, ${output.changedPixelCount} changed)`);

function hashPixels(pixels: ReadonlyArray<LayerRgbPixel>): string {
  const hash = createHash('sha256');
  for (const pixel of pixels) hash.update(Uint8Array.of(pixel.r, pixel.g, pixel.b));
  return `sha256:${hash.digest('hex')}`;
}
