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
  readonly pointerId: number;
  readonly pointerType: ViewerParametricMaskTargetPointerType;
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

export interface ViewerParametricMaskTargetOverlayDescriptor {
  readonly id: string;
  readonly imagePoint: { readonly x: number; readonly y: number };
  readonly key: ViewerParametricMaskTargetKey;
  readonly pointerPolicy: 'capture';
  readonly zOrder: 'tool-geometry';
}

interface ActiveSession {
  readonly command: ViewerParametricMaskTargetCommand;
  readonly overlay: ViewerParametricMaskTargetOverlayDescriptor;
}

export const isViewerParametricMaskTargetKeyCurrent = (
  key: ViewerParametricMaskTargetKey,
  current: ViewerParametricMaskTargetCurrentContext,
): boolean =>
  current.active &&
  current.geometryEpoch === key.geometryEpoch &&
  current.imageSessionId === key.imageSessionId &&
  current.maskId === key.maskId &&
  current.sourceIdentity === key.sourceIdentity &&
  current.sourceRevision === key.sourceRevision &&
  current.tool === key.tool;

export interface ViewerParametricMaskTargetInteractionController {
  begin(
    context: ViewerParametricMaskTargetCurrentContext,
    sample: ViewerParametricMaskTargetSample,
    settings: ViewerParametricMaskTargetSettings,
  ): ViewerParametricMaskTargetOverlayDescriptor | null;
  cancel(): ViewerParametricMaskTargetKey | null;
  end(
    context: ViewerParametricMaskTargetCurrentContext,
    pointerId: number,
    pointerType: ViewerParametricMaskTargetPointerType,
  ): ViewerParametricMaskTargetCommand | null;
  isActive(): boolean;
  overlays(): readonly ViewerParametricMaskTargetOverlayDescriptor[];
  synchronize(context: ViewerParametricMaskTargetCurrentContext): ViewerParametricMaskTargetKey | null;
}

export const createViewerParametricMaskTargetInteractionController =
  (): ViewerParametricMaskTargetInteractionController => {
    let active: ActiveSession | null = null;
    let operationGeneration = 0;

    const cancel = (): ViewerParametricMaskTargetKey | null => {
      const key = active?.command.key ?? null;
      active = null;
      return key;
    };

    return {
      begin: (context, sample, settings) => {
        const { x: targetX, y: targetY } = sample.imagePoint;
        if (
          active !== null ||
          !context.active ||
          !Number.isInteger(sample.pointerId) ||
          sample.pointerId < 1 ||
          ![targetX, targetY, settings.orientationSteps, settings.rotation].every(Number.isFinite)
        ) {
          return null;
        }
        const key: ViewerParametricMaskTargetKey = {
          ...context,
          operationGeneration: ++operationGeneration,
          pointerId: sample.pointerId,
          pointerType: sample.pointerType,
        };
        const parameters: SubMaskParameters = {
          ...structuredClone(settings.baselineParameters),
          flipHorizontal: settings.flipHorizontal,
          flipVertical: settings.flipVertical,
          orientationSteps: settings.orientationSteps,
          rotation: settings.rotation,
          targetX,
          targetY,
        };
        delete parameters['isInitialDraw'];
        const command = { key, parameters };
        const overlay: ViewerParametricMaskTargetOverlayDescriptor = {
          id: `parametric-mask-target:${key.imageSessionId}:${String(key.operationGeneration)}`,
          imagePoint: { x: targetX, y: targetY },
          key,
          pointerPolicy: 'capture',
          zOrder: 'tool-geometry',
        };
        active = { command, overlay };
        return overlay;
      },
      cancel,
      end: (context, pointerId, pointerType) => {
        if (active === null) return null;
        if (active.command.key.pointerId !== pointerId || active.command.key.pointerType !== pointerType) return null;
        if (!isViewerParametricMaskTargetKeyCurrent(active.command.key, context)) {
          cancel();
          return null;
        }
        const command = active.command;
        active = null;
        return command;
      },
      isActive: () => active !== null,
      overlays: () => (active === null ? [] : [active.overlay]),
      synchronize: (context) =>
        active !== null && !isViewerParametricMaskTargetKeyCurrent(active.command.key, context) ? cancel() : null,
    };
  };
