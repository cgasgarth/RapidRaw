import { z } from 'zod';
import type { LayerStackSidecarV1 } from '../../../packages/rawengine-schema/src';
import {
  readLayerStackSidecarsFromSidecar,
  upsertLayerStackSidecarInSidecar,
} from '../../../packages/rawengine-schema/src';
import { type EditDocumentV2, editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments, AiPatch, MaskContainer } from '../adjustments';
import { selectEditDocumentAiPatches, selectEditDocumentMasks } from '../editDocumentSelectors';
import { updateEditDocumentV2Node } from '../editDocumentV2';
import { materializeMasksFromLayerStackSidecar } from './layerStackCommandBridge';

export type PersistedLayerStackArtifacts = {
  layerStackSidecars?: Array<LayerStackSidecarV1>;
  schemaVersion?: number;
  [key: string]: unknown;
};

type LayerStackMetadataEnvelope = {
  adjustments?: unknown;
  editDocumentV2?: EditDocumentV2 | null | undefined;
  rawEngineArtifacts?: PersistedLayerStackArtifacts;
  [key: string]: unknown;
};

function readLayerStackSidecarsFromMetadata(metadata: LayerStackMetadataEnvelope): Array<LayerStackSidecarV1> {
  const rootSidecars = readLayerStackSidecarsFromSidecar(metadata);
  const documentSidecars =
    metadata.editDocumentV2 !== null && typeof metadata.editDocumentV2 === 'object'
      ? readLayerStackSidecarsFromSidecar(metadata.editDocumentV2.extensions)
      : [];
  const adjustmentSidecars =
    typeof metadata.adjustments === 'object' && metadata.adjustments !== null
      ? readLayerStackSidecarsFromSidecar(metadata.adjustments)
      : [];
  const sidecarsBySourcePath = new Map<string, LayerStackSidecarV1>();

  for (const sidecar of adjustmentSidecars) {
    sidecarsBySourcePath.set(sidecar.sourceImagePath, sidecar);
  }
  for (const sidecar of documentSidecars) {
    sidecarsBySourcePath.set(sidecar.sourceImagePath, sidecar);
  }
  for (const sidecar of rootSidecars) {
    sidecarsBySourcePath.set(sidecar.sourceImagePath, sidecar);
  }

  return [...sidecarsBySourcePath.values()];
}

const recordSchema = z.record(z.string(), z.unknown());

function readQuarantinedLayerMasks(document: EditDocumentV2): EditDocumentV2['layers']['masks'] {
  const quarantined = recordSchema.safeParse(document.extensions['quarantinedNodes']);
  if (!quarantined.success) return [];
  const candidates = z.array(recordSchema).safeParse(quarantined.data['layerMasks']);
  if (!candidates.success) return [];
  const normalized = candidates.data.map((candidate) => {
    const layer = { ...candidate };
    if (layer['layerGroupId'] === null) delete layer['layerGroupId'];
    if (layer['layerGroupName'] === null) delete layer['layerGroupName'];
    return layer;
  });
  const parsed = editDocumentLayersV2Schema.safeParse({ masks: normalized });
  return parsed.success ? parsed.data.masks : [];
}

function removeMigratedQuarantinedLayerMasks(
  document: EditDocumentV2,
  migratedMasks: EditDocumentV2['layers']['masks'],
): EditDocumentV2 {
  if (migratedMasks.length === 0) return document;
  const quarantined = recordSchema.safeParse(document.extensions['quarantinedNodes']);
  if (!quarantined.success) return document;
  const candidates = z.array(recordSchema).safeParse(quarantined.data['layerMasks']);
  if (!candidates.success) return document;
  const migratedIds = new Set(migratedMasks.map((mask) => mask.id));
  const remaining = candidates.data.filter((candidate) => {
    const id = candidate['id'];
    return typeof id !== 'string' || !migratedIds.has(id);
  });
  const nextQuarantined = { ...quarantined.data };
  if (remaining.length === 0) delete nextQuarantined['layerMasks'];
  else nextQuarantined['layerMasks'] = remaining;
  const nextExtensions = { ...document.extensions };
  if (Object.keys(nextQuarantined).length === 0) delete nextExtensions['quarantinedNodes'];
  else nextExtensions['quarantinedNodes'] = nextQuarantined;
  return { ...document, extensions: nextExtensions };
}

/** Hydrate the typed document's layer node from its persisted layer-stack artifact. */
export function hydrateLayerStackMasksInEditDocument(
  document: EditDocumentV2,
  metadata: LayerStackMetadataEnvelope,
  imagePath: string,
): EditDocumentV2 {
  const layerStackSidecar = readLayerStackSidecarsFromMetadata(metadata).find(
    (sidecar) => sidecar.sourceImagePath === imagePath,
  );
  const previousMasks = selectEditDocumentMasks(document);
  const quarantinedMasks = readQuarantinedLayerMasks(document);
  const typedQuarantinedMasks =
    quarantinedMasks.length === 0
      ? []
      : selectEditDocumentMasks(updateEditDocumentV2Node(document, 'layers', () => ({ masks: quarantinedMasks })));
  const masksWithQuarantined = [
    ...previousMasks,
    ...typedQuarantinedMasks.filter((mask) => !previousMasks.some((previous) => previous.id === mask.id)),
  ];
  if (layerStackSidecar === undefined && quarantinedMasks.length === 0) return document;
  const materializedMasks =
    layerStackSidecar === undefined
      ? masksWithQuarantined
      : materializeMasksFromLayerStackSidecar(layerStackSidecar, masksWithQuarantined);
  const materializedIds = new Set(materializedMasks.map((mask) => mask.id));
  // Native current-document masks are the authoritative reopen source. Keep
  // any typed layers absent from an older/incomplete sidecar artifact instead
  // of silently dropping newly introduced AI scene masks during hydration.
  const masks = [...materializedMasks, ...previousMasks.filter((mask) => !materializedIds.has(mask.id))];
  const layers = editDocumentLayersV2Schema.parse({ masks: structuredClone(masks) });
  const migratedDocument = removeMigratedQuarantinedLayerMasks(document, quarantinedMasks);
  return updateEditDocumentV2Node(migratedDocument, 'layers', () => layers);
}

export function persistLayerStackSidecarInAdjustments(
  adjustments: Adjustments & { rawEngineArtifacts?: PersistedLayerStackArtifacts },
  layerStackSidecar: LayerStackSidecarV1,
): Adjustments & { rawEngineArtifacts: PersistedLayerStackArtifacts } {
  const envelope = upsertLayerStackSidecarInSidecar(
    { rawEngineArtifacts: adjustments.rawEngineArtifacts },
    layerStackSidecar,
  );
  const rawEngineArtifacts = envelope.rawEngineArtifacts;
  if (rawEngineArtifacts === undefined) throw new Error('Layer stack persistence produced no artifact envelope.');

  return {
    ...adjustments,
    rawEngineArtifacts,
  };
}

export function persistLayerStackSidecarInEditDocumentCandidate(
  document: EditDocumentV2,
  masks: readonly MaskContainer[],
  layerStackSidecar: LayerStackSidecarV1,
): {
  aiPatches: readonly AiPatch[];
  masks: readonly MaskContainer[];
  rawEngineArtifacts: PersistedLayerStackArtifacts;
} {
  const envelope = upsertLayerStackSidecarInSidecar(
    // biome-ignore lint/complexity/useLiteralKeys: extension keys are intentionally index-signature based.
    { rawEngineArtifacts: document.extensions['rawEngineArtifacts'] },
    layerStackSidecar,
  );
  const rawEngineArtifacts = envelope.rawEngineArtifacts;
  if (rawEngineArtifacts === undefined) throw new Error('Layer stack persistence produced no artifact envelope.');
  return { aiPatches: selectEditDocumentAiPatches(document), masks, rawEngineArtifacts };
}

export function hydrateLayerStackMasksFromMetadata(
  adjustments: Adjustments,
  metadata: LayerStackMetadataEnvelope,
  imagePath: string,
): Adjustments {
  try {
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
  } catch (error) {
    console.warn('Skipping invalid layer stack sidecar metadata while hydrating layer masks.', error);
    return adjustments;
  }
}
