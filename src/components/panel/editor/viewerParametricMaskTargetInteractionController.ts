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
  readonly input: {
    readonly pointerId: number;
    readonly pointerType: ViewerParametricMaskTargetPointerType;
  };
  readonly key: ViewerParametricMaskTargetKey;
  readonly kind: 'commit-parametric-mask-target';
  readonly maskId: string;
  readonly parameters: SubMaskParameters;
}

export interface ViewerParametricMaskTargetInteractionController {
  activate(
    context: ViewerParametricMaskTargetCurrentContext,
    sample: ViewerParametricMaskTargetSample,
    settings: ViewerParametricMaskTargetSettings,
  ): ViewerParametricMaskTargetCommand | null;
}

const finitePoint = (point: ViewerParametricMaskTargetSample['imagePoint']): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const validSettings = (settings: ViewerParametricMaskTargetSettings): boolean =>
  Number.isFinite(settings.orientationSteps) && Number.isFinite(settings.rotation);

export const createViewerParametricMaskTargetInteractionController =
  (): ViewerParametricMaskTargetInteractionController => {
    let operationGeneration = 0;

    return {
      activate: (context, sample, settings) => {
        if (!context.active || !finitePoint(sample.imagePoint) || !validSettings(settings)) return null;
        operationGeneration += 1;
        const parameters: SubMaskParameters = {
          ...settings.baselineParameters,
          flipHorizontal: settings.flipHorizontal,
          flipVertical: settings.flipVertical,
          orientationSteps: settings.orientationSteps,
          rotation: settings.rotation,
          targetX: sample.imagePoint.x,
          targetY: sample.imagePoint.y,
        };
        delete parameters['isInitialDraw'];
        return {
          input: { pointerId: sample.pointerId, pointerType: sample.pointerType },
          key: { ...context, operationGeneration },
          kind: 'commit-parametric-mask-target',
          maskId: context.maskId,
          parameters,
        };
      },
    };
  };
