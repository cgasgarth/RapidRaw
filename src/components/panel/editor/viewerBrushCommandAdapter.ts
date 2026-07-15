import {
  BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  type BrushMaskCommandReceipt,
  buildBrushMaskCommandReceiptFromParameters,
} from '../../../utils/mask/brushMaskCommandBridge';
import type { SubMask } from '../right/layers/Masks';
import {
  isViewerBrushCommandCurrent,
  type ViewerBrushCommand,
  type ViewerBrushCurrentContext,
  type ViewerBrushLine,
  type ViewerBrushSessionKey,
} from './viewerBrushInteractionController';

export interface ViewerBrushCommandCaptureSummary {
  readonly adjustmentRevision: number;
  readonly commandHash: string;
  readonly commandId: string;
  readonly commandType: 'layerMask.createBrushMask';
  readonly containerId: string;
  readonly containerKind: 'aiPatches' | 'masks';
  readonly coordinateSpace: typeof BRUSH_MASK_COMMAND_COORDINATE_SPACE;
  readonly expectedGraphRevision: string;
  readonly imagePath: string;
  readonly imageSessionId: string;
  readonly lastPointCount: number;
  readonly lastStrokeMode: 'erase' | 'paint';
  readonly maskId: string;
  readonly operationId: string;
  readonly pressurePointCount: number;
  readonly receiptVersion: BrushMaskCommandReceipt['receiptVersion'];
  readonly schemaVersion: BrushMaskCommandReceipt['schemaVersion'];
  readonly sourceIdentity: string;
  readonly strokeCount: number;
  readonly validationStatus: BrushMaskCommandReceipt['validationStatus'];
}

export interface ViewerBrushParameters extends Record<string, unknown> {
  readonly lines?: readonly ViewerBrushLine[];
  readonly rawEngine?: Record<string, unknown>;
}

export interface ViewerBrushCommitContext {
  readonly current: ViewerBrushCurrentContext;
  readonly imagePath: string;
  readonly imageSize: { readonly height: number; readonly width: number };
  readonly parameters: ViewerBrushParameters;
  readonly subMask: SubMask;
}

export interface ViewerBrushCommitResult {
  readonly key: ViewerBrushSessionKey;
  readonly parameters: ViewerBrushParameters;
  readonly summary: ViewerBrushCommandCaptureSummary;
}

export interface ViewerBrushCommandAdapter {
  commit(
    command: Extract<ViewerBrushCommand, { kind: 'commit' }>,
    context: ViewerBrushCommitContext,
  ): ViewerBrushCommitResult | null;
  synchronize(context: ViewerBrushCommitContext): void;
}

const identity = (context: ViewerBrushCurrentContext): string =>
  [
    context.imageSessionId,
    context.sourceIdentity,
    context.sourceRevision,
    context.adjustmentRevision,
    context.geometryEpoch,
    context.containerKind,
    context.containerId,
    context.maskId,
    context.toolId,
  ].join(':');

/** Typed semantic-command boundary for receipt-bearing brush mutations. */
export const createViewerBrushCommandAdapter = (): ViewerBrushCommandAdapter => {
  let cached: { readonly identity: string; readonly parameters: ViewerBrushParameters } | null = null;

  const synchronize = (context: ViewerBrushCommitContext): void => {
    const nextIdentity = identity(context.current);
    if (cached?.identity !== nextIdentity) {
      cached = { identity: nextIdentity, parameters: context.parameters };
      return;
    }
    const cachedCount = cached.parameters.lines?.length ?? 0;
    const incomingCount = context.parameters.lines?.length ?? 0;
    if (incomingCount >= cachedCount) cached = { identity: nextIdentity, parameters: context.parameters };
  };

  return {
    commit: (command, context) => {
      if (!isViewerBrushCommandCurrent(command.key, context.current)) return null;
      synchronize(context);
      const base = cached?.parameters ?? context.parameters;
      const parameters: ViewerBrushParameters = {
        ...base,
        lines: [...(base.lines ?? []), command.line],
      };
      const operationId = `${context.current.maskId}_${String(parameters.lines?.length ?? 0)}`;
      const receipt = buildBrushMaskCommandReceiptFromParameters(
        parameters,
        {
          expectedGraphRevision: `brush-mask:${context.imagePath}:${context.current.maskId}:${String(parameters.lines?.length ?? 0)}:${String(context.imageSize.width)}x${String(context.imageSize.height)}`,
          imagePath: context.imagePath,
          imageSize: context.imageSize,
          maskId: context.current.maskId,
          maskName: context.subMask.name?.trim() || context.subMask.type,
          operationId,
          sessionId: context.current.imageSessionId,
        },
        { dryRun: true },
      );
      const committed: ViewerBrushParameters = {
        ...parameters,
        rawEngine: {
          ...(parameters.rawEngine ?? {}),
          brushMaskCommandReceipt: receipt,
        },
      };
      cached = { identity: identity(context.current), parameters: committed };
      return {
        key: command.key,
        parameters: committed,
        summary: {
          adjustmentRevision: command.key.adjustmentRevision,
          commandHash: receipt.commandHash,
          commandId: receipt.commandId,
          commandType: receipt.commandType,
          containerId: command.key.containerId,
          containerKind: command.key.containerKind,
          coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
          expectedGraphRevision: receipt.expectedGraphRevision,
          imagePath: receipt.imagePath,
          imageSessionId: command.key.imageSessionId,
          lastPointCount: receipt.lastPointCount,
          lastStrokeMode: receipt.lastStrokeMode,
          maskId: receipt.maskId,
          operationId: receipt.operationId,
          pressurePointCount: receipt.pressurePointCount,
          receiptVersion: receipt.receiptVersion,
          schemaVersion: receipt.schemaVersion,
          sourceIdentity: command.key.sourceIdentity,
          strokeCount: receipt.strokeCount,
          validationStatus: receipt.validationStatus,
        },
      };
    },
    synchronize,
  };
};
