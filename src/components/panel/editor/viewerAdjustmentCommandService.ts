import type { Adjustments, RetouchCloneSource, RetouchRemoveSource } from '../../../utils/adjustments';
import { Mask, type SubMask } from '../right/layers/Masks';

export type AdjustmentUpdater = (previous: Adjustments) => Adjustments;
export type AdjustmentDispatcher = (updater: AdjustmentUpdater) => void;

export interface RetouchPoint {
  x: number;
  y: number;
}

export interface ViewerAdjustmentCommandServices {
  updateSubMask(id: string | null, patch: Partial<SubMask>): void;
  updateRetouchCloneHandle(
    layerId: string,
    handle: 'sourcePoint' | 'targetPoint',
    point: RetouchPoint,
    imageSize: { width: number; height: number },
  ): void;
  updateRetouchRemoveTarget(
    layerId: string,
    removeSource: RetouchRemoveSource,
    point: RetouchPoint,
    imageSize: { width: number; height: number },
  ): void;
}

export const updateSubMaskInAdjustments = (
  previous: Adjustments,
  id: string | null,
  patch: Partial<SubMask>,
): Adjustments => {
  if (!id) return previous;
  return {
    ...previous,
    masks: previous.masks.map((mask) => ({
      ...mask,
      subMasks: mask.subMasks.map((subMask) => (subMask.id === id ? { ...subMask, ...patch } : subMask)),
    })),
  };
};

export const updateRetouchCloneInAdjustments = (
  previous: Adjustments,
  layerId: string,
  handle: 'sourcePoint' | 'targetPoint',
  point: RetouchPoint,
  imageSize: { width: number; height: number },
): Adjustments => ({
  ...previous,
  masks: previous.masks.map((mask) => {
    if (mask.id !== layerId || mask.retouchCloneSource === undefined) return mask;
    let syncedTargetMask = false;
    const updatedSubMasks =
      handle === 'targetPoint'
        ? mask.subMasks.map((subMask) => {
            if (subMask.type !== Mask.Radial || syncedTargetMask) return subMask;
            syncedTargetMask = true;
            return {
              ...subMask,
              parameters: {
                ...subMask.parameters,
                centerX: point.x * imageSize.width,
                centerY: point.y * imageSize.height,
              },
            };
          })
        : mask.subMasks;
    return {
      ...mask,
      retouchCloneSource: { ...mask.retouchCloneSource, [handle]: point } satisfies RetouchCloneSource,
      subMasks: updatedSubMasks,
    };
  }),
});

export const updateRetouchRemoveInAdjustments = (
  previous: Adjustments,
  layerId: string,
  removeSource: RetouchRemoveSource,
  point: RetouchPoint,
  imageSize: { width: number; height: number },
): Adjustments => ({
  ...previous,
  masks: previous.masks.map((mask) => {
    if (mask.id !== layerId || mask.retouchRemoveSource === undefined) return mask;
    const nextRemoveSource = { ...mask.retouchRemoveSource };
    delete nextRemoveSource.resolvedSourcePoint;
    return {
      ...mask,
      retouchRemoveSource: { ...nextRemoveSource, status: 'needs_regeneration' },
      subMasks: mask.subMasks.map((subMask) =>
        subMask.id === removeSource.targetMaskId && subMask.type === Mask.Radial
          ? {
              ...subMask,
              parameters: {
                ...subMask.parameters,
                centerX: point.x * imageSize.width,
                centerY: point.y * imageSize.height,
              },
            }
          : subMask,
      ),
    };
  }),
});

/** Single adjustment authority used by ImageCanvas tool controllers. */
export const createViewerAdjustmentCommandServices = (
  dispatch: AdjustmentDispatcher,
): ViewerAdjustmentCommandServices => ({
  updateSubMask: (id, patch) => dispatch((previous) => updateSubMaskInAdjustments(previous, id, patch)),
  updateRetouchCloneHandle: (layerId, handle, point, imageSize) =>
    dispatch((previous) => updateRetouchCloneInAdjustments(previous, layerId, handle, point, imageSize)),
  updateRetouchRemoveTarget: (layerId, removeSource, point, imageSize) =>
    dispatch((previous) => updateRetouchRemoveInAdjustments(previous, layerId, removeSource, point, imageSize)),
});
