import type { LayerStackSidecarV1 } from '../../packages/rawengine-schema/src';
import {
  readLayerStackSidecarsFromSidecar,
  upsertLayerStackSidecarInSidecar,
} from '../../packages/rawengine-schema/src';

import type { Adjustments } from './adjustments';
import { materializeMasksFromLayerStackSidecar } from './layerStackCommandBridge';

type PersistedLayerStackArtifacts = {
  layerStackSidecars?: Array<LayerStackSidecarV1>;
  schemaVersion?: number;
  [key: string]: unknown;
};

type LayerStackPersistedAdjustments = Adjustments & {
  rawEngineArtifacts?: PersistedLayerStackArtifacts;
};

type LayerStackMetadataEnvelope = {
  adjustments?: unknown;
  rawEngineArtifacts?: PersistedLayerStackArtifacts;
  [key: string]: unknown;
};

export function persistLayerStackSidecarInAdjustments(
  adjustments: Adjustments,
  layerStackSidecar: LayerStackSidecarV1,
): Adjustments {
  const persistedAdjustments = adjustments as LayerStackPersistedAdjustments;
  const envelope = upsertLayerStackSidecarInSidecar(
    { rawEngineArtifacts: persistedAdjustments.rawEngineArtifacts },
    layerStackSidecar,
  );

  return {
    ...adjustments,
    rawEngineArtifacts: envelope.rawEngineArtifacts,
  };
}

export function hydrateLayerStackMasksFromMetadata(
  adjustments: Adjustments,
  metadata: LayerStackMetadataEnvelope,
  imagePath: string,
): Adjustments {
  const layerStackSidecar = readLayerStackSidecarsFromSidecar(metadata).find(
    (sidecar) => sidecar.sourceImagePath === imagePath,
  );
  if (layerStackSidecar === undefined) return adjustments;

  return persistLayerStackSidecarInAdjustments(
    {
      ...adjustments,
      masks: materializeMasksFromLayerStackSidecar(layerStackSidecar, adjustments.masks),
    },
    layerStackSidecar,
  );
}
