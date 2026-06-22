#!/usr/bin/env bun

import { z } from 'zod';

import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../src/utils/adjustments.ts';
import { applyLayerStackCommandBridgeOperation } from '../../../src/utils/layerStackCommandBridge.ts';
import { layerStackSidecarV1Schema, readLayerStackSidecarsFromSidecar } from '../../../packages/rawengine-schema/src';

const outputArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    contentHash: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u),
    dimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict(),
    kind: z.literal('negative_lab_positive'),
    outputIntent: z.literal('editable_positive'),
    positiveVariantId: z.string().trim().min(1),
    storage: z.literal('sidecar_artifact'),
  })
  .strict();

const negativeLabArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    outputArtifacts: z.array(outputArtifactSchema).min(1),
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

console.log('negative lab editor layer handoff ok (editable positive + layer command)');
