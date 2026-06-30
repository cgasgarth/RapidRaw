#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';
import {
  layerStackSidecarV1Schema,
  negativeLabPositiveArtifactHandleV1Schema,
  readLayerStackSidecarsFromSidecar,
} from '../../../packages/rawengine-schema/src';
import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments.ts';
import { applyLayerStackCommandBridgeOperation } from '../../../src/utils/layerStackCommandBridge.ts';

const appModalsSource = readFileSync('src/components/modals/AppModals.tsx', 'utf8');
const appNavigationSource = readFileSync('src/hooks/useAppNavigation.ts', 'utf8');
const modalSource = readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8');
const handoffSource = readFileSync('src/utils/negativeLabEditorHandoff.ts', 'utf8');
const imageLoaderSource = readFileSync('src/hooks/useImageLoader.ts', 'utf8');
const visualSmokeSource = readFileSync('src/validation/visual/VisualSmokeApp.tsx', 'utf8');
const visualSmokeCaptureSource = readFileSync('scripts/capture-visual-smoke.ts', 'utf8');

const negativeLabArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    outputArtifacts: z.array(negativeLabPositiveArtifactHandleV1Schema).min(1),
  })
  .passthrough();

const handoffSidecarSchema = z
  .object({
    rawEngineArtifacts: z
      .object({
        layerStackSidecars: z.array(layerStackSidecarV1Schema).min(1),
        negativeLabArtifacts: z.array(negativeLabArtifactSchema).min(1),
        schemaVersion: z.literal(1),
      })
      .passthrough(),
  })
  .passthrough();

const savedPositivePath = '/proof-roll/negative-lab/frame_001_Positive.tiff';
const seededSidecar = handoffSidecarSchema.parse({
  rawEngineArtifacts: {
    layerStackSidecars: [
      {
        graphRevision: 'graph_negative_lab_positive_variant_proof_001',
        lastCommandId: 'command_seed_layer_stack_artifact_negative_lab_proof_001',
        layers: [],
        schemaVersion: 1,
        sourceImagePath: savedPositivePath,
        storage: 'sidecar_artifact',
      },
    ],
    negativeLabArtifacts: [
      {
        artifactId: 'artifact_negative_lab_proof_001',
        outputArtifacts: [
          {
            artifactId: 'artifact_negative_lab_proof_001_output',
            contentHash: 'fnv1a64:0123456789abcdef',
            dimensions: { height: 1200, width: 1800 },
            kind: 'negative_lab_positive',
            outputIntent: 'editable_positive',
            positiveVariantId: 'positive_variant_proof_001',
            storage: 'sidecar_artifact',
          },
        ],
      },
    ],
    schemaVersion: 1,
  },
});

const [layerStackSidecar] = readLayerStackSidecarsFromSidecar(seededSidecar);
if (layerStackSidecar === undefined) {
  throw new Error('Expected Negative Lab positive sidecar to seed a layer stack.');
}

const outputArtifact = seededSidecar.rawEngineArtifacts.negativeLabArtifacts[0]?.outputArtifacts[0];
if (outputArtifact === undefined) {
  throw new Error('Expected Negative Lab handoff output artifact.');
}

if (outputArtifact.outputIntent !== 'editable_positive') {
  throw new Error('Expected Negative Lab output to be marked as editable_positive.');
}

if (layerStackSidecar.sourceImagePath !== savedPositivePath) {
  throw new Error('Expected layer stack source image path to match saved positive path.');
}

const layer: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  blendMode: 'normal',
  id: 'negative-lab-print-grade',
  invert: false,
  name: 'Print grade',
  opacity: 82,
  subMasks: [],
  visible: true,
};
const applied = applyLayerStackCommandBridgeOperation(
  [],
  { layer, type: 'create' },
  {
    graphRevision: layerStackSidecar.graphRevision,
    imagePath: savedPositivePath,
    operationId: 'negative_lab_positive_editor_handoff_create_layer',
    sessionId: 'negative_lab_positive_editor_handoff_session',
  },
);

if (applied.sidecar.sourceImagePath !== savedPositivePath) {
  throw new Error('Layer command should apply against the saved positive path.');
}

if (applied.sidecar.layers[0]?.id !== layer.id) {
  throw new Error('Expected layer stack command to create an editable print-grade layer.');
}

for (const [label, source, marker] of [
  ['modal save contract', modalSource, 'const acceptedDustHealLayers = Object.values(dustHealLayerByCandidateId);'],
  [
    'modal persisted heal sidecar contract',
    modalSource,
    'const acceptedDustHealLayersBySourcePath = Object.fromEntries(',
  ],
  ['modal persisted heal sidecar builder', modalSource, 'buildLayerStackSidecarFromMasks(sourceLayers, {'],
  ['modal persisted heal save payload', modalSource, 'acceptedDustHealLayersBySourcePath,'],
  ['modal handoff control', modalSource, 'negative-lab-positive-open-in-editor'],
  ['modal dust heal handoff count', modalSource, 'data-accepted-dust-heal-layer-count={dustHealLayerCount}'],
  ['modal dust heal editor-ready state', modalSource, 'negative-lab-positive-dust-heal-handoff'],
  ['modal dust heal open-in-editor state', modalSource, 'data-open-in-editor='],
  ['app handoff route', appModalsSource, 'handleNegativeConversionEditorHandoff({'],
  ['refresh best effort', handoffSource, 'onRefreshError?.(error);'],
  ['handoff exact first path', handoffSource, 'await handleImageSelect(firstSavedPath);'],
  ['handoff dust heal layer contract', handoffSource, 'acceptedDustHealLayers?: Array<MaskContainer>;'],
  ['handoff dust heal layer queue', handoffSource, 'pendingAcceptedDustHealLayers ='],
  ['handoff dust heal layer consume', handoffSource, 'consumePendingNegativeConversionDustHealLayers'],
  [
    'handoff editor history append',
    handoffSource,
    'pushEditHistoryEntry(state.history, state.historyIndex, adjustments)',
  ],
  ['uncached handoff consume', imageLoaderSource, 'consumePendingNegativeConversionDustHealLayers(selectedImagePath);'],
  ['cached handoff consume', appNavigationSource, 'consumePendingNegativeConversionDustHealLayers(path);'],
  ['visual smoke handoff state', visualSmokeSource, 'data-opened-positive-in-editor='],
  ['visual smoke shared helper', visualSmokeSource, 'handleNegativeConversionEditorHandoff({'],
  ['visual smoke opt out', visualSmokeSource, 'handoff: { openInEditor: false }'],
  ['visual smoke order proof', visualSmokeSource, 'data-refresh-before-open='],
  ['visual smoke provenance source', visualSmokeSource, 'data-source-negative-path={sourceNegativePath}'],
  ['visual smoke provenance roll', visualSmokeSource, 'data-roll-session-id={rollSessionId}'],
  ['visual smoke provenance report', visualSmokeSource, 'data-conversion-report-id={conversionReportId}'],
  ['visual smoke capture proof', visualSmokeCaptureSource, 'Negative Lab save did not open the saved positive'],
] as const) {
  if (!source.includes(marker)) {
    throw new Error(`Negative Lab positive editor handoff marker missing: ${label}`);
  }
}

console.log('negative lab editor layer handoff ok (editable positive + layer command)');
