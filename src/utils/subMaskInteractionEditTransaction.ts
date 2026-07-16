import {
  type EditDocumentV2,
  editDocumentLayersV2Schema,
  editDocumentSourceArtifactsV2Schema,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { SubMask } from '../components/panel/right/layers/Masks';
import { selectEditDocumentLayers, selectEditDocumentSourceArtifacts } from './editDocumentSelectors';
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
  editDocumentV2: EditDocumentV2;
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

type InteractiveSubMaskContainer = {
  readonly id: string;
  readonly subMasks: readonly { readonly id: string }[];
};

const updateContainers = <Container extends InteractiveSubMaskContainer, ParsedContainer>(
  containers: readonly Container[],
  identity: SubMaskInteractionIdentity,
  patch: Partial<SubMask>,
  parse: (value: unknown) => readonly ParsedContainer[],
): readonly ParsedContainer[] => {
  const matchingContainers = containers.filter((container) => container.id === identity.containerId);
  const matchingSubMasks = matchingContainers.flatMap((container) =>
    container.subMasks.filter((subMask) => subMask.id === identity.subMaskId),
  );
  if (matchingContainers.length !== 1 || matchingSubMasks.length !== 1) {
    throw new Error('sub_mask_interaction.stale_target');
  }
  const updated = containers.map((container) =>
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
  );
  return parse(updated);
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
    identity.containerKind === 'masks'
      ? updateContainers(
          selectEditDocumentLayers(state.editDocumentV2).masks,
          identity,
          patch,
          (value) => editDocumentLayersV2Schema.parse({ masks: value }).masks,
        )
      : null;
  const aiPatches =
    identity.containerKind === 'aiPatches'
      ? updateContainers(
          selectEditDocumentSourceArtifacts(state.editDocumentV2).aiPatches,
          identity,
          patch,
          (value) => editDocumentSourceArtifactsV2Schema.parse({ aiPatches: value }).aiPatches,
        )
      : null;

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'coalesced-interaction',
    imageSessionId: identity.imageSessionId,
    operations: [
      ...(masks !== null
        ? [
            {
              nodeType: 'layers' as const,
              patch: editDocumentLayersV2Schema.parse({ masks }),
              type: 'patch-edit-document-node' as const,
            },
          ]
        : []),
      ...(aiPatches !== null
        ? [
            {
              nodeType: 'source_artifacts' as const,
              patch: editDocumentSourceArtifactsV2Schema.parse({ aiPatches }),
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
