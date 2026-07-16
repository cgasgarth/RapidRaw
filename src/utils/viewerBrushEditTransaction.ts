import type { ViewerBrushCommitResult } from '../components/panel/editor/viewerBrushCommandAdapter';
import { Mask } from '../components/panel/right/layers/Masks';
import { selectEditDocumentLayers, selectEditDocumentSourceArtifacts } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';
import {
  buildSubMaskInteractionEditTransaction,
  type SubMaskInteractionState,
} from './subMaskInteractionEditTransaction';

export interface ViewerBrushEditTransactionState extends SubMaskInteractionState {
  readonly geometryEpoch: number;
  readonly sourceRevision: string;
}

const rejectViewerBrush = (reason: string): never => {
  throw new Error(`viewer_brush_transaction.${reason}`);
};

const currentImageSessionId = (state: ViewerBrushEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const buildViewerBrushEditTransaction = (
  state: ViewerBrushEditTransactionState,
  command: ViewerBrushCommitResult,
  transactionId: string,
): EditTransactionRequest => {
  const { key } = command;
  if (key.adjustmentRevision !== state.adjustmentRevision) rejectViewerBrush('stale_adjustment_revision');
  if (key.imageSessionId !== currentImageSessionId(state)) rejectViewerBrush('stale_image_session');
  if (key.sourceIdentity !== state.selectedImage?.path) rejectViewerBrush('stale_source');
  if (key.sourceRevision !== state.sourceRevision) rejectViewerBrush('stale_source_revision');
  if (key.geometryEpoch !== state.geometryEpoch) rejectViewerBrush('stale_geometry');

  const containers =
    key.containerKind === 'masks'
      ? selectEditDocumentLayers(state.editDocumentV2).masks
      : selectEditDocumentSourceArtifacts(state.editDocumentV2).aiPatches;
  const matchingContainers = containers.filter((container) => container.id === key.containerId);
  const matchingSubMasks = matchingContainers.flatMap((container) =>
    container.subMasks.filter((subMask) => subMask.id === key.maskId),
  );
  if (matchingContainers.length !== 1 || matchingSubMasks.length !== 1) rejectViewerBrush('stale_target');
  const subMask = matchingSubMasks[0];
  if (subMask?.type !== Mask.Brush && subMask?.type !== Mask.Flow) rejectViewerBrush('stale_tool');

  return buildSubMaskInteractionEditTransaction(
    state,
    {
      adjustmentRevision: key.adjustmentRevision,
      containerId: key.containerId,
      containerKind: key.containerKind,
      imageSessionId: key.imageSessionId,
      sourceIdentity: key.sourceIdentity,
      subMaskId: key.maskId,
      transactionId,
    },
    key.maskId,
    { parameters: command.parameters },
  );
};
