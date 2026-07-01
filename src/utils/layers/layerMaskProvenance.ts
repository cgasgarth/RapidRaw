import type { MaskContainer } from '../adjustments';

export type LayerMaskProvenanceInvalidationReason =
  | 'layer_deleted'
  | 'layer_order_changed'
  | 'mask_alpha_changed'
  | 'preview_missing'
  | 'source_graph_revision_changed'
  | 'source_state_changed';

export type LayerMaskProvenanceStatus = 'current' | 'needs_reapply' | 'stale_source';

export interface LayerMaskProvenanceReceipt {
  appliedCommandId: string;
  invalidationReason?: LayerMaskProvenanceInvalidationReason;
  layerId: string;
  layerOrderHash: string;
  maskContentHash: string;
  receiptId: string;
  sourceGraphRevision: string;
  staleReasons: LayerMaskProvenanceInvalidationReason[];
  staleState: 'current' | 'stale';
}

export interface LayerMaskProvenanceView {
  badgeLabel: 'Current' | 'Needs reapply' | 'Stale source';
  invalidationReason: LayerMaskProvenanceInvalidationReason;
  status: LayerMaskProvenanceStatus;
  receipt: LayerMaskProvenanceReceipt;
}

export const DEFAULT_LAYER_MASK_SOURCE_GRAPH_REVISION = 'layer_mask_graph_initial';

const STALE_REASON_ORDER: ReadonlyArray<LayerMaskProvenanceInvalidationReason> = [
  'layer_order_changed',
  'mask_alpha_changed',
  'source_state_changed',
  'source_graph_revision_changed',
  'layer_deleted',
  'preview_missing',
];

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const hashLayerMaskStableJson = (value: unknown): string => `fnv1a32:${fnv1a32(stableJson(value))}`;

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const buildLayerMaskLayerOrderHash = (masks: ReadonlyArray<MaskContainer>): string =>
  hashLayerMaskStableJson(masks.map((mask) => ({ groupId: mask.layerGroupId ?? null, id: mask.id })));

export const buildLayerMaskContentHash = (mask: MaskContainer | undefined): string =>
  hashLayerMaskStableJson(
    mask === undefined
      ? { missing: true }
      : {
          id: mask.id,
          invert: mask.invert,
          opacity: mask.opacity,
          subMasks: mask.subMasks.map((subMask) => ({
            id: subMask.id,
            invert: subMask.invert,
            mode: subMask.mode,
            opacity: subMask.opacity,
            parameters: subMask.parameters ?? null,
            type: subMask.type,
            visible: subMask.visible,
          })),
          visible: mask.visible,
        },
  );

export const buildLayerMaskSourceGraphRevision = ({
  previousRevision,
  reason,
  revisionIndex,
}: {
  previousRevision: string;
  reason: LayerMaskProvenanceInvalidationReason;
  revisionIndex: number;
}): string =>
  `layer_mask_graph_${revisionIndex}_${hashLayerMaskStableJson({ previousRevision, reason, revisionIndex }).replace(
    ':',
    '_',
  )}`;

export const buildLayerMaskProvenanceReceipt = ({
  appliedCommandId,
  layerId,
  masks,
  sourceGraphRevision,
}: {
  appliedCommandId: string;
  layerId: string;
  masks: ReadonlyArray<MaskContainer>;
  sourceGraphRevision: string;
}): LayerMaskProvenanceReceipt => {
  const mask = masks.find((candidate) => candidate.id === layerId);
  const maskContentHash = buildLayerMaskContentHash(mask);
  const layerOrderHash = buildLayerMaskLayerOrderHash(masks);
  const receiptId = `layer_mask_receipt_${hashLayerMaskStableJson({
    appliedCommandId,
    layerId,
    layerOrderHash,
    maskContentHash,
    sourceGraphRevision,
  }).replace(':', '_')}`;
  return {
    appliedCommandId,
    layerId,
    layerOrderHash,
    maskContentHash,
    receiptId,
    sourceGraphRevision,
    staleReasons: [],
    staleState: 'current',
  };
};

export const buildLayerMaskProvenanceReceipts = ({
  appliedCommandId,
  masks,
  sourceGraphRevision,
}: {
  appliedCommandId: string;
  masks: ReadonlyArray<MaskContainer>;
  sourceGraphRevision: string;
}): Record<string, LayerMaskProvenanceReceipt> =>
  Object.fromEntries(
    masks.map((mask) => [
      mask.id,
      buildLayerMaskProvenanceReceipt({
        appliedCommandId,
        layerId: mask.id,
        masks,
        sourceGraphRevision,
      }),
    ]),
  );

export const markLayerMaskReceiptsStale = ({
  layerIds,
  reason,
  receipts,
}: {
  layerIds?: ReadonlyArray<string>;
  reason: LayerMaskProvenanceInvalidationReason;
  receipts: Record<string, LayerMaskProvenanceReceipt>;
}): Record<string, LayerMaskProvenanceReceipt> => {
  const targetLayerIds = layerIds === undefined ? Object.keys(receipts) : layerIds;
  const targetLayerIdSet = new Set(targetLayerIds);
  return Object.fromEntries(
    Object.entries(receipts).map(([layerId, receipt]) => {
      if (!targetLayerIdSet.has(layerId)) return [layerId, receipt];
      const staleReasons = STALE_REASON_ORDER.filter(
        (candidateReason) => candidateReason === reason || receipt.staleReasons.includes(candidateReason),
      );
      return [
        layerId,
        {
          ...receipt,
          invalidationReason: reason,
          staleReasons,
          staleState: 'stale',
        },
      ];
    }),
  );
};

export const deriveLayerMaskProvenanceView = ({
  layerId,
  masks,
  receipt,
  sourceGraphRevision,
}: {
  layerId: string;
  masks: ReadonlyArray<MaskContainer>;
  receipt: LayerMaskProvenanceReceipt | undefined;
  sourceGraphRevision: string;
}): LayerMaskProvenanceView => {
  const currentReceipt = buildLayerMaskProvenanceReceipt({
    appliedCommandId: receipt?.appliedCommandId ?? 'preview_missing',
    layerId,
    masks,
    sourceGraphRevision,
  });

  if (receipt === undefined) {
    return {
      badgeLabel: 'Needs reapply',
      invalidationReason: 'preview_missing',
      receipt: {
        ...currentReceipt,
        invalidationReason: 'preview_missing',
        staleReasons: ['preview_missing'],
        staleState: 'stale',
      },
      status: 'needs_reapply',
    };
  }

  const reasons = new Set<LayerMaskProvenanceInvalidationReason>(receipt.staleReasons);
  if (receipt.sourceGraphRevision !== sourceGraphRevision) reasons.add('source_graph_revision_changed');
  if (receipt.layerOrderHash !== currentReceipt.layerOrderHash) reasons.add('layer_order_changed');
  if (receipt.maskContentHash !== currentReceipt.maskContentHash) reasons.add('mask_alpha_changed');
  if (!masks.some((mask) => mask.id === layerId)) reasons.add('layer_deleted');

  const staleReasons = STALE_REASON_ORDER.filter((reason) => reasons.has(reason));
  if (staleReasons.length === 0 && receipt.staleState === 'current') {
    return {
      badgeLabel: 'Current',
      invalidationReason: receipt.invalidationReason ?? 'preview_missing',
      receipt,
      status: 'current',
    };
  }

  const invalidationReason = staleReasons[0] ?? receipt.invalidationReason ?? 'source_state_changed';
  const isSourceStale =
    invalidationReason === 'source_graph_revision_changed' || invalidationReason === 'source_state_changed';
  return {
    badgeLabel: isSourceStale ? 'Stale source' : 'Needs reapply',
    invalidationReason,
    receipt: {
      ...receipt,
      invalidationReason,
      staleReasons,
      staleState: 'stale',
    },
    status: isSourceStale ? 'stale_source' : 'needs_reapply',
  };
};
