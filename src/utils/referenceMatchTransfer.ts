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
