import type { Adjustments } from './adjustments';

const REFERENCE_MATCH_NODE_KEYS = [
  'contrast',
  'creativeTemperature',
  'creativeTint',
  'exposure',
  'saturation',
  'vibrance',
] as const satisfies ReadonlyArray<keyof Adjustments>;

export type ReferenceMatchTransferMode = 'batch-sync' | 'copy-paste';

export interface ReferenceMatchTransferAcceptance {
  adjustments: Partial<Adjustments>;
  affectedNodeKeys: Array<(typeof REFERENCE_MATCH_NODE_KEYS)[number]>;
  provenanceDisposition: 'cleared-stale-receipt' | 'preserved';
  transferMode: ReferenceMatchTransferMode;
}

type ReferenceMatchReceipt = NonNullable<Adjustments['referenceMatchApplicationReceipt']>;

const receiptsMatch = (
  left: ReferenceMatchReceipt | null | undefined,
  right: ReferenceMatchReceipt | null | undefined,
): boolean =>
  left === right ||
  (left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    left.appliedAt === right.appliedAt &&
    left.destination === right.destination &&
    left.layerId === right.layerId &&
    left.proposalFingerprint === right.proposalFingerprint &&
    left.resultingGraphFingerprint === right.resultingGraphFingerprint &&
    left.targetAnalysisFingerprint === right.targetAnalysisFingerprint);

export const acceptReferenceMatchAdjustmentTransfer = ({
  adjustments,
  transferMode,
}: {
  adjustments: Partial<Adjustments>;
  transferMode: ReferenceMatchTransferMode;
}): ReferenceMatchTransferAcceptance => {
  const affectedNodeKeys = REFERENCE_MATCH_NODE_KEYS.filter((key) => Object.hasOwn(adjustments, key));
  const clearsReceipt = affectedNodeKeys.length > 0;
  return {
    adjustments: clearsReceipt ? { ...adjustments, referenceMatchApplicationReceipt: null } : adjustments,
    affectedNodeKeys,
    provenanceDisposition: clearsReceipt ? 'cleared-stale-receipt' : 'preserved',
    transferMode,
  };
};

export const reconcileReferenceMatchReceiptsAfterEdit = (previous: Adjustments, next: Adjustments): Adjustments => {
  let reconciled = next;
  const globalReceipt = previous.referenceMatchApplicationReceipt;
  if (
    globalReceipt !== null &&
    receiptsMatch(next.referenceMatchApplicationReceipt, globalReceipt) &&
    globalReceipt.appliedDiffs.some((diff) => previous[diff.key] !== next[diff.key])
  ) {
    reconciled = { ...reconciled, referenceMatchApplicationReceipt: null };
  }

  const previousLayers = new Map(previous.masks.map((layer) => [layer.id, layer]));
  let reconciledMasks = reconciled.masks;
  for (const [index, layer] of reconciled.masks.entries()) {
    const previousLayer = previousLayers.get(layer.id);
    if (previousLayer === undefined) continue;
    const receipt = previousLayer.referenceMatchApplicationReceipt;
    if (receipt === undefined || !receiptsMatch(layer.referenceMatchApplicationReceipt, receipt)) continue;
    const changed =
      previousLayer.opacity !== layer.opacity ||
      receipt.appliedDiffs.some((diff) => previousLayer.adjustments[diff.key] !== layer.adjustments[diff.key]);
    if (!changed) continue;
    if (reconciledMasks === reconciled.masks) reconciledMasks = [...reconciled.masks];
    const { referenceMatchApplicationReceipt: _staleReceipt, ...layerWithoutReceipt } = layer;
    reconciledMasks[index] = layerWithoutReceipt;
  }
  return reconciledMasks === reconciled.masks ? reconciled : { ...reconciled, masks: reconciledMasks };
};

export const buildReceiptSafePresetApplication = (current: Adjustments, patch: Partial<Adjustments>): Adjustments =>
  reconcileReferenceMatchReceiptsAfterEdit(current, { ...current, ...patch });
