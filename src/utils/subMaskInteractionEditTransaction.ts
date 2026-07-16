import type { SubMask } from '../components/panel/right/layers/Masks';
import type { Adjustments, AiPatch, MaskContainer } from './adjustments';
import type { EditApplicationReceipt, EditTransactionRequest } from './editTransaction';

export interface SubMaskInteractionIdentity {
  adjustmentRevision: number;
  containerId: string;
  containerKind: 'aiPatches' | 'masks';
  imageSessionId: string;
  sourceIdentity: string;
  subMaskId: string;
  transactionId: string;
}

export type SubMaskInteractionTarget = Pick<SubMaskInteractionIdentity, 'containerId' | 'containerKind' | 'subMaskId'>;

export interface SubMaskInteractionIdentitySlot {
  current: SubMaskInteractionIdentity | null;
}

export const scheduleSubMaskInteractionEnd = (
  slot: SubMaskInteractionIdentitySlot,
  schedule: (callback: () => void) => void = queueMicrotask,
): void => {
  const endedIdentity = slot.current;
  schedule(() => {
    if (slot.current === endedIdentity) slot.current = null;
  });
};

export interface SubMaskInteractionState {
  adjustmentRevision: number;
  adjustmentSnapshot: { readonly value: Pick<Adjustments, 'aiPatches' | 'masks'> };
  imageSession: { id: string } | null;
  imageSessionId: number;
  lastEditApplicationReceipt: EditApplicationReceipt | null;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: SubMaskInteractionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureSubMaskInteractionIdentity = (
  state: SubMaskInteractionState,
  transactionId: string,
  target: SubMaskInteractionTarget,
): SubMaskInteractionIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        ...target,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
        transactionId,
      };

const isCurrentInteraction = (state: SubMaskInteractionState, identity: SubMaskInteractionIdentity): boolean => {
  if (
    currentImageSessionId(state) !== identity.imageSessionId ||
    state.selectedImage?.path !== identity.sourceIdentity
  ) {
    return false;
  }
  if (state.adjustmentRevision === identity.adjustmentRevision) return true;
  const receipt = state.lastEditApplicationReceipt;
  return (
    receipt?.transactionId === identity.transactionId &&
    receipt.imageSessionId === identity.imageSessionId &&
    receipt.source === 'layer-command' &&
    receipt.baseAdjustmentRevision === identity.adjustmentRevision &&
    receipt.adjustmentRevision === state.adjustmentRevision
  );
};

const updateContainers = <Container extends MaskContainer | AiPatch>(
  containers: readonly Container[],
  identity: SubMaskInteractionIdentity,
  patch: Partial<SubMask>,
): Container[] => {
  const matchingContainers = containers.filter((container) => container.id === identity.containerId);
  const matchingSubMasks = matchingContainers.flatMap((container) =>
    container.subMasks.filter((subMask) => subMask.id === identity.subMaskId),
  );
  if (matchingContainers.length !== 1 || matchingSubMasks.length !== 1) {
    throw new Error('sub_mask_interaction.stale_target');
  }
  return containers.map((container) =>
    container.id === identity.containerId
      ? {
          ...container,
          subMasks: container.subMasks.map((subMask) =>
            subMask.id === identity.subMaskId
              ? { ...subMask, ...structuredClone(patch), id: identity.subMaskId }
              : subMask,
          ),
        }
      : container,
  ) as Container[];
};

export const buildSubMaskInteractionEditTransaction = (
  state: SubMaskInteractionState,
  identity: SubMaskInteractionIdentity,
  subMaskId: string | null,
  patch: Partial<SubMask>,
): EditTransactionRequest => {
  if (!isCurrentInteraction(state, identity)) throw new Error('sub_mask_interaction.stale_identity');
  if (subMaskId === null) throw new Error('sub_mask_interaction.missing_id');
  if (subMaskId !== identity.subMaskId) throw new Error('sub_mask_interaction.stale_target');
  const masks =
    identity.containerKind === 'masks' ? updateContainers(state.adjustmentSnapshot.value.masks, identity, patch) : null;
  const aiPatches =
    identity.containerKind === 'aiPatches'
      ? updateContainers(state.adjustmentSnapshot.value.aiPatches, identity, patch)
      : null;

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'coalesced-interaction',
    imageSessionId: identity.imageSessionId,
    operations: [
      ...(masks !== null
        ? [{ nodeType: 'layers' as const, patch: { masks }, type: 'patch-edit-document-node' as const }]
        : []),
      ...(aiPatches !== null
        ? [
            {
              nodeType: 'source_artifacts' as const,
              patch: { aiPatches },
              type: 'patch-edit-document-node' as const,
            },
          ]
        : []),
    ],
    persistence: 'commit',
    source: 'layer-command',
    transactionId: identity.transactionId,
  };
};
