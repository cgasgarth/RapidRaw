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
} from './viewerBrushInteractionController';

export interface ViewerBrushCommandCaptureSummary {
  readonly commandHash: string;
  readonly commandId: string;
  readonly commandType: 'layerMask.createBrushMask';
  readonly coordinateSpace: typeof BRUSH_MASK_COMMAND_COORDINATE_SPACE;
  readonly expectedGraphRevision: string;
  readonly imagePath: string;
  readonly lastPointCount: number;
  readonly lastStrokeMode: 'erase' | 'paint';
  readonly maskId: string;
  readonly operationId: string;
  readonly pressurePointCount: number;
  readonly receiptVersion: BrushMaskCommandReceipt['receiptVersion'];
  readonly schemaVersion: BrushMaskCommandReceipt['schemaVersion'];
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
  [context.imageSessionId, context.sourceRevision, context.geometryEpoch, context.maskId, context.toolId].join(':');

/** Typed semantic-command boundary for receipt-bearing brush mutations. */
export const createViewerBrushCommandAdapter = (
  updateSubMask: (id: string | null, patch: Partial<SubMask>) => void,
): ViewerBrushCommandAdapter => {
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
      updateSubMask(context.current.maskId, { parameters: committed });
      return {
        parameters: committed,
        summary: {
          commandHash: receipt.commandHash,
          commandId: receipt.commandId,
          commandType: receipt.commandType,
          coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
          expectedGraphRevision: receipt.expectedGraphRevision,
          imagePath: receipt.imagePath,
          lastPointCount: receipt.lastPointCount,
          lastStrokeMode: receipt.lastStrokeMode,
          maskId: receipt.maskId,
          operationId: receipt.operationId,
          pressurePointCount: receipt.pressurePointCount,
          receiptVersion: receipt.receiptVersion,
          schemaVersion: receipt.schemaVersion,
          strokeCount: receipt.strokeCount,
          validationStatus: receipt.validationStatus,
        },
      };
    },
    synchronize,
  };
};
