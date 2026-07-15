import type { SubMaskParameters } from '../right/layers/Masks';

export type ViewerParametricMaskTargetTool = 'color' | 'luminance';
export type ViewerParametricMaskTargetPointerType = 'mouse' | 'pen' | 'touch';

export interface ViewerParametricMaskTargetCurrentContext {
  readonly active: boolean;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly maskId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly tool: ViewerParametricMaskTargetTool;
}

export interface ViewerParametricMaskTargetKey extends ViewerParametricMaskTargetCurrentContext {
  readonly operationGeneration: number;
}

export interface ViewerParametricMaskTargetSample {
  readonly imagePoint: { readonly x: number; readonly y: number };
  readonly pointerId: number;
  readonly pointerType: ViewerParametricMaskTargetPointerType;
}

export interface ViewerParametricMaskTargetSettings {
  readonly baselineParameters: Readonly<SubMaskParameters>;
  readonly flipHorizontal: boolean;
  readonly flipVertical: boolean;
  readonly orientationSteps: number;
  readonly rotation: number;
}

export interface ViewerParametricMaskTargetCommand {
  readonly key: ViewerParametricMaskTargetKey;
  readonly parameters: SubMaskParameters;
}

export interface ViewerParametricMaskTargetInteractionController {
  activate(
    context: ViewerParametricMaskTargetCurrentContext,
    sample: ViewerParametricMaskTargetSample,
    settings: ViewerParametricMaskTargetSettings,
  ): ViewerParametricMaskTargetCommand | null;
}

export const createViewerParametricMaskTargetInteractionController =
  (): ViewerParametricMaskTargetInteractionController => {
    let operationGeneration = 0;

    return {
      activate: (context, sample, settings) => {
        const { x: targetX, y: targetY } = sample.imagePoint;
        if (
          !context.active ||
          ![targetX, targetY, settings.orientationSteps, settings.rotation].every(Number.isFinite)
        ) {
          return null;
        }
        const parameters: SubMaskParameters = {
          ...settings.baselineParameters,
          flipHorizontal: settings.flipHorizontal,
          flipVertical: settings.flipVertical,
          orientationSteps: settings.orientationSteps,
          rotation: settings.rotation,
          targetX,
          targetY,
        };
        delete parameters['isInitialDraw'];
        return {
          key: { ...context, operationGeneration: ++operationGeneration },
          parameters,
        };
      },
    };
  };
