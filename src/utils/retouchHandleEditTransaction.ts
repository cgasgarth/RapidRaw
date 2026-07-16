import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { ViewerRetouchCommand } from '../components/panel/editor/viewerRetouchHandlesController';
import { Mask } from '../components/panel/right/layers/Masks';
import type { MaskContainer, RetouchCloneSource } from './adjustments';
import { selectEditDocumentAiPatches, selectEditDocumentMasks } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';
import { buildLayerEditTransactionRequest } from './layers/layerEditTransaction';

export interface RetouchHandleEditTransactionState {
  readonly adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  readonly geometryEpoch: number;
  readonly imageSessionId: number;
  readonly imageSession?: { id: string } | null;
  readonly selectedImage: { path: string } | null;
  readonly sourceRevision: string;
}

const rejectRetouchHandle = (reason: string): never => {
  throw new Error(`retouch_handle.${reason}`);
};

export const createRetouchLayerRevision = (
  layer: MaskContainer,
  imageSize: { height: number; width: number },
): string => {
  return JSON.stringify({ imageSize, layer });
};

const expectedImageSessionId = (state: RetouchHandleEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

const assertCurrent = (
  state: RetouchHandleEditTransactionState,
  command: ViewerRetouchCommand,
  layer: MaskContainer,
  imageSize: { height: number; width: number },
): void => {
  const key = command.key;
  if (key.imageSessionId !== expectedImageSessionId(state)) rejectRetouchHandle('stale_image_session');
  if (key.sourceIdentity !== state.selectedImage?.path) rejectRetouchHandle('stale_source');
  if (key.sourceRevision !== state.sourceRevision) rejectRetouchHandle('stale_source_revision');
  if (key.geometryEpoch !== state.geometryEpoch) rejectRetouchHandle('stale_geometry');
  if (key.layerRevision !== createRetouchLayerRevision(layer, imageSize)) rejectRetouchHandle('stale_layer_revision');
  if (!Number.isFinite(command.point.x) || !Number.isFinite(command.point.y)) rejectRetouchHandle('invalid_point');
  if (command.point.x < 0 || command.point.x > 1 || command.point.y < 0 || command.point.y > 1) {
    rejectRetouchHandle('point_out_of_bounds');
  }
  if (key.mode === 'remove') {
    if (command.kind !== 'update-remove-target' || layer.retouchRemoveSource === undefined) {
      rejectRetouchHandle('stale_mode');
    }
    const targets = layer.subMasks.filter((subMask) => subMask.id === layer.retouchRemoveSource?.targetMaskId);
    if (targets.length !== 1 || targets[0]?.type !== Mask.Radial) rejectRetouchHandle('missing_remove_target');
    return;
  }
  const cloneSource = layer.retouchCloneSource;
  if (
    command.kind !== 'update-clone-handle' ||
    cloneSource === undefined ||
    (cloneSource.retouchMode ?? 'clone') !== key.mode
  ) {
    rejectRetouchHandle('stale_mode');
  }
};

const updateLayer = (
  layer: MaskContainer,
  command: ViewerRetouchCommand,
  imageSize: { height: number; width: number },
): MaskContainer => {
  if (command.kind === 'update-remove-target') {
    const removeSource = layer.retouchRemoveSource;
    if (removeSource === undefined) return rejectRetouchHandle('stale_mode');
    const nextRemoveSource = { ...removeSource };
    delete nextRemoveSource.resolvedSourcePoint;
    return {
      ...layer,
      retouchRemoveSource: { ...nextRemoveSource, status: 'needs_regeneration' },
      subMasks: layer.subMasks.map((subMask) =>
        subMask.id === removeSource.targetMaskId
          ? {
              ...subMask,
              parameters: {
                ...subMask.parameters,
                centerX: command.point.x * imageSize.width,
                centerY: command.point.y * imageSize.height,
              },
            }
          : subMask,
      ),
    };
  }

  const cloneSource = layer.retouchCloneSource;
  if (cloneSource === undefined) return rejectRetouchHandle('stale_mode');
  let targetUpdated = false;
  return {
    ...layer,
    retouchCloneSource: {
      ...cloneSource,
      [command.handle]: command.point,
    } satisfies RetouchCloneSource,
    subMasks:
      command.handle === 'sourcePoint'
        ? layer.subMasks
        : layer.subMasks.map((subMask) => {
            if (targetUpdated || subMask.type !== Mask.Radial) return subMask;
            targetUpdated = true;
            return {
              ...subMask,
              parameters: {
                ...subMask.parameters,
                centerX: command.point.x * imageSize.width,
                centerY: command.point.y * imageSize.height,
              },
            };
          }),
  };
};

export const buildRetouchHandleEditTransaction = (
  state: RetouchHandleEditTransactionState,
  command: ViewerRetouchCommand,
  imageSize: { readonly height: number; readonly width: number },
  transactionId: string,
): EditTransactionRequest => {
  const currentMasks = selectEditDocumentMasks(state.editDocumentV2);
  const matches = currentMasks.filter((layer) => layer.id === command.key.layerId);
  const matchedLayer = matches[0];
  if (matches.length !== 1 || matchedLayer === undefined) return rejectRetouchHandle('missing_or_duplicate_layer');
  assertCurrent(state, command, matchedLayer, imageSize);
  const masks = currentMasks.map((layer) =>
    layer.id === command.key.layerId ? updateLayer(layer, command, imageSize) : layer,
  );
  return buildLayerEditTransactionRequest(
    state,
    { aiPatches: selectEditDocumentAiPatches(state.editDocumentV2), masks },
    transactionId,
  );
};
