import type { RetouchRemoveSource } from '../../../utils/adjustments';
import type { ViewerAdjustmentCommandServices } from './viewerAdjustmentCommandService';
import {
  isViewerRetouchSessionCurrent,
  type ViewerRetouchCommand,
  type ViewerRetouchCurrentContext,
} from './viewerRetouchHandlesController';

export interface ViewerRetouchCommitContext {
  readonly current: ViewerRetouchCurrentContext;
  readonly imageSize: { readonly height: number; readonly width: number };
  readonly removeSource: RetouchRemoveSource | null;
}

export interface ViewerRetouchCommandReceipt {
  readonly geometryEpoch: number;
  readonly handle: 'sourcePoint' | 'targetPoint';
  readonly layerId: string;
  readonly layerRevision: string;
  readonly mode: ViewerRetouchCurrentContext['mode'];
  readonly operationGeneration: number;
  readonly point: { readonly x: number; readonly y: number };
  readonly sourceRevision: string;
}

export interface ViewerRetouchCommandAdapter {
  commit(command: ViewerRetouchCommand, context: ViewerRetouchCommitContext): ViewerRetouchCommandReceipt | null;
}

/** Semantic mutation boundary for retouch placement commands. */
export const createViewerRetouchCommandAdapter = (
  adjustments: ViewerAdjustmentCommandServices,
): ViewerRetouchCommandAdapter => ({
  commit: (command, context) => {
    if (!isViewerRetouchSessionCurrent(command.key, context.current)) return null;
    if (command.kind === 'update-clone-handle') {
      adjustments.updateRetouchCloneHandle(command.key.layerId, command.handle, command.point, context.imageSize);
    } else {
      if (context.removeSource === null) return null;
      adjustments.updateRetouchRemoveTarget(
        command.key.layerId,
        context.removeSource,
        command.point,
        context.imageSize,
      );
    }
    return {
      geometryEpoch: command.key.geometryEpoch,
      handle: command.kind === 'update-clone-handle' ? command.handle : 'targetPoint',
      layerId: command.key.layerId,
      layerRevision: command.key.layerRevision,
      mode: command.key.mode,
      operationGeneration: command.key.operationGeneration,
      point: command.point,
      sourceRevision: command.key.sourceRevision,
    };
  },
});
