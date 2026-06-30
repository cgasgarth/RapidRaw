#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  dispatchLayerStackCommand,
  type LayerRgbPixel,
  type LayerStackSidecarV1,
  layerMaskCommandEnvelopeV1Schema,
  layerStackSidecarV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  renderLayerScopedToneStack,
} from '../../../../packages/rawengine-schema/src';

const OUTPUT_DIR = 'artifacts/layers/layer-scoped-tone-output';

const basePixels: Array<LayerRgbPixel> = [
  { r: 32, g: 40, b: 48 },
  { r: 76, g: 82, b: 88 },
  { r: 118, g: 112, b: 104 },
  { r: 148, g: 136, b: 120 },
  { r: 188, g: 174, b: 158 },
  { r: 222, g: 210, b: 196 },
];

const initialSidecar: LayerStackSidecarV1 = layerStackSidecarV1Schema.parse({
  graphRevision: 'layer_scoped_tone_initial',
  layers: [
    {
      adjustmentPreset: 'empty_adjustment_layer_v1',
      blendMode: 'normal',
      id: 'layer_tone_warmth',
      maskIds: [],
      name: 'Warm exposure lift',
      opacity: 0.65,
      visible: true,
    },
  ],
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceImagePath: '/Users/cgas/Pictures/Capture One/Alaska/RAWENGINE_LAYER_PROOF.CR3',
  storage: 'sidecar_artifact',
});

const command = layerMaskCommandEnvelopeV1Schema.parse({
  actor: {
    id: 'rapidraw-ui',
    kind: 'ui',
    sessionId: 'layer_scoped_tone_proof',
  },
  approval: {
    approvalClass: 'edit_apply',
    reason: 'Apply layer-scoped tone adjustment through the typed layer command path.',
    state: 'approved',
  },
  commandId: 'layer_tone_apply_exposure_warmth',
  commandType: 'layerMask.applyLayerAdjustment',
  correlationId: 'layer_tone_apply_corr',
  dryRun: false,
  expectedGraphRevision: initialSidecar.graphRevision,
  idempotencyKey: 'layer_tone_apply_idem',
  parameters: {
    adjustmentKind: 'tone_color',
    adjustmentParameters: {
      blackPoint: 4,
      clarity: 8,
      contrast: 18,
      exposureEv: 0.55,
      highlights: -12,
      saturation: 14,
      shadows: 20,
      whitePoint: 6,
    },
    layerId: 'layer_tone_warmth',
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: initialSidecar.sourceImagePath,
    kind: 'image',
  },
});

const dispatched = dispatchLayerStackCommand(command, initialSidecar);
if (!('sidecar' in dispatched)) throw new Error('Layer-scoped tone proof expected apply sidecar result.');
if (dispatched.commandResult.changedLayerIds[0] !== 'layer_tone_warmth') {
  throw new Error('Layer-scoped tone command must report the adjusted layer id.');
}

const enabled = renderLayerScopedToneStack({
  basePixels,
  height: 2,
  sidecar: dispatched.sidecar,
  width: 3,
});

const disabledSidecar = layerStackSidecarV1Schema.parse({
  ...dispatched.sidecar,
  graphRevision: `${dispatched.sidecar.graphRevision}_disabled`,
  layers: dispatched.sidecar.layers.map((layer) =>
    layer.id === 'layer_tone_warmth' ? { ...layer, visible: false } : layer,
  ),
});
const disabled = renderLayerScopedToneStack({
  basePixels,
  height: 2,
  sidecar: disabledSidecar,
  width: 3,
});

const replay = dispatchLayerStackCommand(command, initialSidecar);
if (!('sidecar' in replay)) throw new Error('Layer-scoped tone replay expected apply sidecar result.');
const replayRender = renderLayerScopedToneStack({
  basePixels,
  height: 2,
  sidecar: replay.sidecar,
  width: 3,
});

const failures: Array<string> = [];
if (enabled.previewHash === enabled.sourceHash)
  failures.push('enabled layer-scoped tone did not change preview output');
if (enabled.previewHash !== enabled.exportHash || enabled.previewHash !== enabled.headlessHash) {
  failures.push('preview/export/headless hashes must match for layer-scoped tone');
}
if (disabled.previewHash !== disabled.sourceHash) failures.push('disabled layer-scoped tone must render as source');
if (enabled.previewHash === disabled.previewHash) failures.push('enabled and disabled layer output hashes must differ');
if (enabled.changedPixelCount === 0) failures.push('enabled layer-scoped tone must change pixels');
if (enabled.renderedLayerIds.join(',') !== 'layer_tone_warmth') failures.push('rendered layer id mismatch');
if (JSON.stringify(replay.sidecar) !== JSON.stringify(dispatched.sidecar)) {
  failures.push('command replay sidecar roundtrip mismatch');
}
if (replayRender.previewHash !== enabled.previewHash) failures.push('command replay render hash mismatch');
if (enabled.sidecarRoundtrip.layers[0]?.adjustments?.toneColor?.exposureEv !== 0.55) {
  failures.push('sidecar roundtrip lost layer-scoped tone adjustment');
}

const writePpm = async (path: string, pixels: ReadonlyArray<LayerRgbPixel>): Promise<void> => {
  const rows = ['P3', '3 2', '255'];
  for (let row = 0; row < 2; row += 1) {
    rows.push(
      pixels
        .slice(row * 3, row * 3 + 3)
        .map((pixel) => `${pixel.r} ${pixel.g} ${pixel.b}`)
        .join('  '),
    );
  }
  await writeFile(path, `${rows.join('\n')}\n`);
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writePpm(resolve(OUTPUT_DIR, 'enabled-preview.ppm'), enabled.previewRender.pixels);
await writePpm(resolve(OUTPUT_DIR, 'enabled-export.ppm'), enabled.exportRender.pixels);
await writePpm(resolve(OUTPUT_DIR, 'disabled-preview.ppm'), disabled.previewRender.pixels);
await writeFile(
  resolve(OUTPUT_DIR, 'layer-scoped-tone-report.json'),
  `${JSON.stringify(
    {
      changedPixelCount: enabled.changedPixelCount,
      commandType: command.commandType,
      disabledPreviewHash: disabled.previewHash,
      enabledExportHash: enabled.exportHash,
      enabledPreviewHash: enabled.previewHash,
      graphRevision: dispatched.sidecar.graphRevision,
      issue: 3060,
      renderedLayerIds: enabled.renderedLayerIds,
      sourceHash: enabled.sourceHash,
      validationStatus: failures.length === 0 ? 'passed' : 'failed',
    },
    null,
    2,
  )}\n`,
);

if (failures.length > 0) {
  console.error('layer-scoped tone output failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`layer-scoped tone output ok (${enabled.changedPixelCount} pixels)`);
