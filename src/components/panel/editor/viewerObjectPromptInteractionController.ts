import type { SubMaskParameters } from '../right/layers/Masks';
import {
  applyObjectPromptClick,
  type ObjectPromptMode,
  readObjectPromptCanvasState,
  writeObjectPromptCanvasState,
} from '../../../utils/mask/objectMaskPromptCanvas';

export type ViewerObjectPromptPointerType = 'mouse' | 'pen' | 'touch';

export interface ViewerObjectPromptCurrentContext {
  readonly active: boolean;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly maskId: string;
  readonly mode: ObjectPromptMode;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly tool: 'object-prompt';
}

export interface ViewerObjectPromptKey extends ViewerObjectPromptCurrentContext {
  readonly active: true;
  readonly operationGeneration: number;
}

export interface ViewerObjectPromptSample {
  readonly imagePoint: { readonly x: number; readonly y: number };
  readonly pointerId: number;
  readonly pointerType: ViewerObjectPromptPointerType;
}

export interface ViewerObjectPromptCommand {
  readonly key: ViewerObjectPromptKey;
  readonly kind: 'commit-object-prompt';
  readonly parameters: SubMaskParameters;
}

export interface ViewerObjectPromptInteractionController {
  activate(
    context: ViewerObjectPromptCurrentContext,
    sample: ViewerObjectPromptSample,
    baselineParameters: Readonly<SubMaskParameters>,
  ): ViewerObjectPromptCommand | null;
}

/** Framework-free authority for one source-bound Object Prompt activation. */
export const createViewerObjectPromptInteractionController = (): ViewerObjectPromptInteractionController => {
  let operationGeneration = 0;
  return {
    activate: (context, sample, baselineParameters) => {
      const { x, y } = sample.imagePoint;
      if (
        !context.active ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(sample.pointerId) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1
      ) {
        return null;
      }
      const current = readObjectPromptCanvasState(baselineParameters);
      if (current.mode !== context.mode) return null;
      const next = applyObjectPromptClick(current, { label: 'foreground', x, y });
      return {
        key: { ...context, active: true, operationGeneration: ++operationGeneration },
        kind: 'commit-object-prompt',
        parameters: writeObjectPromptCanvasState(baselineParameters, next),
      };
    },
  };
};
