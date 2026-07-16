import {
  type EditDocumentV2,
  editDocumentLayersV2Schema,
  editDocumentSourceArtifactsV2Schema,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { ViewerInitialMaskDrawSessionKey } from '../components/panel/editor/viewerInitialMaskDrawInteractionController';
import { selectEditDocumentLayers, selectEditDocumentSourceArtifacts } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';

export interface InitialMaskDrawEditTransactionState {
  readonly adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  readonly geometryEpoch: number;
  readonly imageSession: { readonly id: string } | null;
  readonly selectedImage: { readonly path: string } | null;
  readonly sourceRevision: string;
}

type EditableSubMaskContainer = {
  readonly subMasks: readonly { readonly id: string; readonly type: string }[];
};

const updateSubMask = <Container extends EditableSubMaskContainer, ParsedContainer>(
  containers: readonly Container[],
  maskId: string,
  tool: ViewerInitialMaskDrawSessionKey['tool'],
  parameters: Readonly<Record<string, unknown>>,
  parse: (value: unknown) => readonly ParsedContainer[],
): { readonly containers: readonly ParsedContainer[]; readonly found: boolean } => {
  let found = false;
  const containersAfter = containers.map((container) => ({
    ...container,
    subMasks: container.subMasks.map((subMask) => {
      if (subMask.id !== maskId) return subMask;
      if (subMask.type !== tool) throw new Error(`initial_mask_transaction.tool_mismatch:${subMask.type}:${tool}`);
      found = true;
      return { ...subMask, parameters: { ...parameters } };
    }),
  }));
  return { containers: parse(containersAfter), found };
};

export const buildInitialMaskDrawEditTransaction = (
  state: InitialMaskDrawEditTransactionState,
  identity: ViewerInitialMaskDrawSessionKey,
  parameters: Readonly<Record<string, unknown>>,
  transactionId: string,
): EditTransactionRequest => {
  if (!identity.active || identity.operationGeneration < 1) {
    throw new Error(`initial_mask_transaction.invalid_generation:${String(identity.operationGeneration)}`);
  }
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `initial_mask_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `initial_mask_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.sourceRevision !== identity.sourceRevision) {
    throw new Error(`initial_mask_transaction.stale_graph:${identity.sourceRevision}:${state.sourceRevision}`);
  }
  if (state.geometryEpoch !== identity.geometryEpoch) {
    throw new Error(
      `initial_mask_transaction.stale_geometry:${String(identity.geometryEpoch)}:${String(state.geometryEpoch)}`,
    );
  }

  const masks = updateSubMask(
    selectEditDocumentLayers(state.editDocumentV2).masks,
    identity.maskId,
    identity.tool,
    parameters,
    (value) => editDocumentLayersV2Schema.parse({ masks: value }).masks,
  );
  const aiPatches = updateSubMask(
    selectEditDocumentSourceArtifacts(state.editDocumentV2).aiPatches,
    identity.maskId,
    identity.tool,
    parameters,
    (value) => editDocumentSourceArtifactsV2Schema.parse({ aiPatches: value }).aiPatches,
  );
  if (!masks.found && !aiPatches.found) throw new Error(`initial_mask_transaction.missing_mask:${identity.maskId}`);

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'layers',
        patch: editDocumentLayersV2Schema.parse({ masks: masks.containers }),
        type: 'patch-edit-document-node',
      },
      {
        nodeType: 'source_artifacts',
        patch: editDocumentSourceArtifactsV2Schema.parse({ aiPatches: aiPatches.containers }),
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'layer-command',
    transactionId,
  };
};
