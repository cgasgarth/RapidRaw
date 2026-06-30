import { z } from 'zod';

import { type LayerStackSidecarV1, layerStackSidecarV1Schema } from './layerStackCommandRuntime.js';
import { RAW_ENGINE_SCHEMA_VERSION } from './rawEngineSchemas.js';

const rawEngineArtifactsWithLayerStacksV1Schema = z
  .looseObject({
    layerStackSidecars: z.array(layerStackSidecarV1Schema).default([]),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
  })
  .superRefine((artifacts, context) => {
    const sourcePaths = artifacts.layerStackSidecars.map((sidecar) => sidecar.sourceImagePath);
    if (new Set(sourcePaths).size !== sourcePaths.length) {
      context.addIssue({
        code: 'custom',
        message: 'Layer stack sidecar artifacts must be unique by source image path.',
        path: ['layerStackSidecars'],
      });
    }
  });

export const layerStackSidecarPersistenceEnvelopeV1Schema = z.looseObject({
  rawEngineArtifacts: rawEngineArtifactsWithLayerStacksV1Schema.optional(),
});

export type LayerStackSidecarPersistenceEnvelopeV1 = z.infer<typeof layerStackSidecarPersistenceEnvelopeV1Schema>;

export const readLayerStackSidecarsFromSidecar = (sidecar: unknown): LayerStackSidecarV1[] => {
  const parsed = layerStackSidecarPersistenceEnvelopeV1Schema.parse(sidecar);
  return parsed.rawEngineArtifacts?.layerStackSidecars ?? [];
};

export const upsertLayerStackSidecarInSidecar = (
  sidecar: Record<string, unknown>,
  layerStackSidecar: LayerStackSidecarV1,
): LayerStackSidecarPersistenceEnvelopeV1 => {
  const parsedLayerStack = layerStackSidecarV1Schema.parse(layerStackSidecar);
  const parsedSidecar = layerStackSidecarPersistenceEnvelopeV1Schema.parse(sidecar);
  const rawEngineArtifacts = rawEngineArtifactsWithLayerStacksV1Schema.parse(
    parsedSidecar.rawEngineArtifacts ?? { schemaVersion: RAW_ENGINE_SCHEMA_VERSION },
  );
  const existingLayerStacks: LayerStackSidecarV1[] = rawEngineArtifacts.layerStackSidecars;
  const layerStackSidecars = [
    ...existingLayerStacks.filter((existing) => existing.sourceImagePath !== parsedLayerStack.sourceImagePath),
    parsedLayerStack,
  ];

  return layerStackSidecarPersistenceEnvelopeV1Schema.parse({
    ...parsedSidecar,
    rawEngineArtifacts: {
      ...rawEngineArtifacts,
      layerStackSidecars,
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    },
  });
};
