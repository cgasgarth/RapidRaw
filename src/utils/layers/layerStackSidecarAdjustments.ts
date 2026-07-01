import type { LayerStackSidecarV1 } from '../../../packages/rawengine-schema/src';
import {
  readLayerStackSidecarsFromSidecar,
  upsertLayerStackSidecarInSidecar,
} from '../../../packages/rawengine-schema/src';

import type { Adjustments } from '../adjustments';
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

function readLayerStackSidecarsFromMetadata(metadata: LayerStackMetadataEnvelope): Array<LayerStackSidecarV1> {
  const rootSidecars = readLayerStackSidecarsFromSidecar(metadata);
  const adjustmentSidecars =
    typeof metadata.adjustments === 'object' && metadata.adjustments !== null
      ? readLayerStackSidecarsFromSidecar(metadata.adjustments)
      : [];
  const sidecarsBySourcePath = new Map<string, LayerStackSidecarV1>();

  for (const sidecar of adjustmentSidecars) {
    sidecarsBySourcePath.set(sidecar.sourceImagePath, sidecar);
  }
  for (const sidecar of rootSidecars) {
    sidecarsBySourcePath.set(sidecar.sourceImagePath, sidecar);
  }

  return [...sidecarsBySourcePath.values()];
}

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
  const layerStackSidecar = readLayerStackSidecarsFromMetadata(metadata).find(
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
