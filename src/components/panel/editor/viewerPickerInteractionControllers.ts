import { POINT_COLOR_MAX_POINTS_V1 } from '../../../../packages/rawengine-schema/src/color/pointColorSchemas';
import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import type { PointColorPickerResponse } from '../../../utils/color/pointColorPicker';
import {
  type ColorMixerTargetedBandWeight,
  type ColorMixerTargetedMode,
  resolveColorMixerBandWeights,
} from '../../../utils/colorMixerTargetedAdjustment';
import { selectEditDocumentNode } from '../../../utils/editDocumentSelectors';
import type { ToneEqualizerPickerResponse } from '../../../utils/toneEqualizerPicker';

export type ViewerPickerToolId = 'color-mixer' | 'point-color' | 'tone-equalizer';

export interface ViewerPickerSessionKey {
  readonly adjustmentRevision: number;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly normalizedImagePoint: ViewerPickerPoint['normalizedImagePoint'];
  readonly operationGeneration: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly toolId: ViewerPickerToolId;
}

export interface ViewerPickerPoint {
  readonly normalizedImagePoint: { readonly x: number; readonly y: number };
  readonly viewPoint: { readonly x: number; readonly y: number };
}

export interface ViewerPickerOverlayDescriptor extends ViewerPickerPoint {
  readonly ariaLabel: string;
  readonly geometryEpoch: number;
  readonly id: string;
  readonly status: 'sampling' | 'ready';
  readonly toolId: ViewerPickerToolId;
}

export type ViewerPickerCommitResult =
  | {
      readonly baseline: EditDocumentV2;
      readonly bands: readonly ColorMixerTargetedBandWeight[];
      readonly delta: number;
      readonly key: ViewerPickerSessionKey & { readonly toolId: 'color-mixer' };
      readonly kind: 'color-mixer';
      readonly mode: ColorMixerTargetedMode;
      readonly result: PointColorPickerResponse;
    }
  | {
      readonly baseline: EditDocumentV2;
      readonly deltaEv: number;
      readonly key: ViewerPickerSessionKey & { readonly toolId: 'tone-equalizer' };
      readonly kind: 'tone-equalizer';
      readonly result: ToneEqualizerPickerResponse;
    }
  | {
      readonly key: ViewerPickerSessionKey & { readonly toolId: 'point-color' };
      readonly kind: 'point-color';
      readonly ordinal: number;
      readonly result: PointColorPickerResponse;
    };

export type ViewerPickerCommand =
  | {
      readonly editDocumentV2: EditDocumentV2;
      readonly key: ViewerPickerSessionKey;
      readonly kind: 'sample-color-mixer' | 'sample-point-color' | 'sample-tone-equalizer';
      readonly normalizedImagePoint: ViewerPickerPoint['normalizedImagePoint'];
    }
  | {
      readonly baseline: EditDocumentV2;
      readonly bands: readonly ColorMixerTargetedBandWeight[];
      readonly delta: number;
      readonly key: ViewerPickerSessionKey & { readonly toolId: 'color-mixer' };
      readonly kind: 'commit-color-mixer';
      readonly mode: ColorMixerTargetedMode;
      readonly result: PointColorPickerResponse;
    }
  | {
      readonly baseline: EditDocumentV2;
      readonly deltaEv: number;
      readonly key: ViewerPickerSessionKey & { readonly toolId: 'tone-equalizer' };
      readonly kind: 'commit-tone-equalizer';
      readonly result: ToneEqualizerPickerResponse;
    }
  | {
      readonly key: ViewerPickerSessionKey & { readonly toolId: 'point-color' };
      readonly kind: 'commit-point-color';
      readonly ordinal: number;
      readonly result: PointColorPickerResponse;
    }
  | { readonly kind: 'clear-color-mixer-receipt' | 'clear-point-color-receipt' | 'clear-tone-equalizer-receipt' }
  | { readonly kind: 'deactivate-point-color' }
  | {
      readonly bands: readonly ColorMixerTargetedBandWeight[];
      readonly delta: number;
      readonly kind: 'publish-color-mixer-receipt';
      readonly mode: ColorMixerTargetedMode;
      readonly result: PointColorPickerResponse;
    }
  | { readonly kind: 'publish-point-color-receipt'; readonly result: PointColorPickerResponse }
  | { readonly kind: 'publish-tone-equalizer-receipt'; readonly result: ToneEqualizerPickerResponse };

interface ToneSession extends ViewerPickerPoint {
  readonly baseline: EditDocumentV2;
  readonly key: ViewerPickerSessionKey & { readonly toolId: 'tone-equalizer' };
  readonly pointerId: number;
  readonly startClientY: number;
  currentClientY: number;
  released: boolean;
  result: ToneEqualizerPickerResponse | null;
  readonly toolId: 'tone-equalizer';
}

interface ColorMixerSession extends ViewerPickerPoint {
  readonly baseline: EditDocumentV2;
  bands: readonly ColorMixerTargetedBandWeight[];
  readonly key: ViewerPickerSessionKey & { readonly toolId: 'color-mixer' };
  readonly mode: ColorMixerTargetedMode;
  readonly pointerId: number;
  currentClientY: number;
  released: boolean;
  result: PointColorPickerResponse | null;
  readonly startClientY: number;
  readonly toolId: 'color-mixer';
}

interface PointSession extends ViewerPickerPoint {
  readonly key: ViewerPickerSessionKey & { readonly toolId: 'point-color' };
  readonly ordinal: number;
  readonly pointerId: number;
  readonly toolId: 'point-color';
}

type PickerSession = ColorMixerSession | PointSession | ToneSession;

export interface ViewerPickerCurrentContext {
  readonly activeTool: ViewerPickerToolId | null;
  readonly adjustmentRevision: number;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export const isViewerPickerSessionCurrent = (
  key: ViewerPickerSessionKey,
  current: ViewerPickerCurrentContext,
): boolean =>
  current.activeTool === key.toolId &&
  current.adjustmentRevision === key.adjustmentRevision &&
  current.geometryEpoch === key.geometryEpoch &&
  current.imageSessionId === key.imageSessionId &&
  current.sourceIdentity === key.sourceIdentity &&
  current.sourceRevision === key.sourceRevision;

const sameViewerPickerSessionKey = (left: ViewerPickerSessionKey, right: ViewerPickerSessionKey): boolean =>
  left.adjustmentRevision === right.adjustmentRevision &&
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.normalizedImagePoint.x === right.normalizedImagePoint.x &&
  left.normalizedImagePoint.y === right.normalizedImagePoint.y &&
  left.operationGeneration === right.operationGeneration &&
  left.sourceIdentity === right.sourceIdentity &&
  left.sourceRevision === right.sourceRevision &&
  left.toolId === right.toolId;

export const resolveViewerPickerPoint = (
  normalizedImagePoint: ViewerPickerPoint['normalizedImagePoint'],
  displayedImageRect: { readonly height: number; readonly width: number; readonly x: number; readonly y: number },
): ViewerPickerPoint => ({
  normalizedImagePoint,
  viewPoint: {
    x: displayedImageRect.x + normalizedImagePoint.x * displayedImageRect.width,
    y: displayedImageRect.y + normalizedImagePoint.y * displayedImageRect.height,
  },
});

const responseMatchesKey = (
  result: PointColorPickerResponse | ToneEqualizerPickerResponse,
  key: ViewerPickerSessionKey,
): boolean => result.graphRevision === key.sourceRevision && result.sourceIdentity === key.sourceIdentity;

const toneDeltaEv = (session: ToneSession): number =>
  Math.max(-4, Math.min(4, (session.startClientY - session.currentClientY) / 80));

export interface ViewerPickerInteractionController {
  beginColorMixer(input: {
    editDocumentV2: EditDocumentV2;
    clientY: number;
    key: ViewerPickerSessionKey & { readonly toolId: 'color-mixer' };
    mode: ColorMixerTargetedMode;
    point: ViewerPickerPoint;
    pointerId: number;
  }): readonly ViewerPickerCommand[];
  beginPointColor(input: {
    editDocumentV2: EditDocumentV2;
    key: ViewerPickerSessionKey & { readonly toolId: 'point-color' };
    point: ViewerPickerPoint;
    pointerId: number;
  }): readonly ViewerPickerCommand[];
  beginToneEqualizer(input: {
    editDocumentV2: EditDocumentV2;
    clientY: number;
    key: ViewerPickerSessionKey & { readonly toolId: 'tone-equalizer' };
    point: ViewerPickerPoint;
    pointerId: number;
  }): readonly ViewerPickerCommand[];
  cancel(): readonly ViewerPickerCommand[];
  fail(key: ViewerPickerSessionKey, current: ViewerPickerCurrentContext): readonly ViewerPickerCommand[];
  move(pointerId: number, clientY: number): void;
  overlays(): readonly ViewerPickerOverlayDescriptor[];
  receivePointColor(
    key: ViewerPickerSessionKey,
    result: PointColorPickerResponse,
    current: ViewerPickerCurrentContext,
  ): readonly ViewerPickerCommand[];
  receiveColorMixer(
    key: ViewerPickerSessionKey,
    result: PointColorPickerResponse,
    current: ViewerPickerCurrentContext,
  ): readonly ViewerPickerCommand[];
  receiveToneEqualizer(
    key: ViewerPickerSessionKey,
    result: ToneEqualizerPickerResponse,
    current: ViewerPickerCurrentContext,
  ): readonly ViewerPickerCommand[];
  release(pointerId: number, clientY: number): readonly ViewerPickerCommand[];
}

export interface ViewerPickerContextSynchronizer {
  synchronize(context: ViewerPickerCurrentContext): readonly ViewerPickerCommand[];
}

const pickerContextIdentity = (context: ViewerPickerCurrentContext): string =>
  JSON.stringify([
    context.activeTool,
    context.adjustmentRevision,
    context.geometryEpoch,
    context.imageSessionId,
    context.sourceIdentity,
    context.sourceRevision,
  ]);

/** Invalidates before a render can accept input, avoiding activation/effect races. */
export const createViewerPickerContextSynchronizer = (
  controller: Pick<ViewerPickerInteractionController, 'cancel'>,
): ViewerPickerContextSynchronizer => {
  let identity: string | null = null;
  return {
    synchronize: (context) => {
      const nextIdentity = pickerContextIdentity(context);
      if (identity === null) {
        identity = nextIdentity;
        return [];
      }
      if (identity === nextIdentity) return [];
      identity = nextIdentity;
      return controller.cancel();
    },
  };
};

export const createViewerPickerInteractionController = (): ViewerPickerInteractionController => {
  let session: PickerSession | null = null;
  const clearReceipt = (toolId: ViewerPickerToolId): ViewerPickerCommand => ({
    kind:
      toolId === 'point-color'
        ? 'clear-point-color-receipt'
        : toolId === 'tone-equalizer'
          ? 'clear-tone-equalizer-receipt'
          : 'clear-color-mixer-receipt',
  });
  const finishColorMixer = (mixer: ColorMixerSession): readonly ViewerPickerCommand[] => {
    if (mixer.result === null) return [];
    session = null;
    const delta = (mixer.startClientY - mixer.currentClientY) / 2;
    return [
      {
        baseline: mixer.baseline,
        bands: mixer.bands,
        delta: Math.max(-100, Math.min(100, delta)),
        key: mixer.key,
        kind: 'commit-color-mixer',
        mode: mixer.mode,
        result: mixer.result,
      },
    ];
  };
  const finishTone = (tone: ToneSession): readonly ViewerPickerCommand[] => {
    if (tone.result === null) return [];
    session = null;
    return [
      {
        kind: 'commit-tone-equalizer',
        baseline: tone.baseline,
        deltaEv: toneDeltaEv(tone),
        key: tone.key,
        result: tone.result,
      },
    ];
  };
  return {
    beginColorMixer: ({ clientY, editDocumentV2, key, mode, point, pointerId }) => {
      if (session !== null) return [];
      session = {
        ...point,
        bands: [],
        baseline: editDocumentV2,
        currentClientY: clientY,
        key,
        mode,
        pointerId,
        released: false,
        result: null,
        startClientY: clientY,
        toolId: 'color-mixer',
      };
      return [{ editDocumentV2, key, kind: 'sample-color-mixer', normalizedImagePoint: point.normalizedImagePoint }];
    },
    beginPointColor: ({ editDocumentV2, key, point, pointerId }) => {
      if (session !== null) return [];
      if (
        selectEditDocumentNode(editDocumentV2, 'point_color').params.pointColor.points.length >=
        POINT_COLOR_MAX_POINTS_V1
      )
        return [];
      session = {
        ...point,
        key,
        ordinal: selectEditDocumentNode(editDocumentV2, 'point_color').params.pointColor.points.length + 1,
        pointerId,
        toolId: 'point-color',
      };
      return [{ editDocumentV2, key, kind: 'sample-point-color', normalizedImagePoint: point.normalizedImagePoint }];
    },
    beginToneEqualizer: ({ editDocumentV2, clientY, key, point, pointerId }) => {
      if (session !== null) return [];
      session = {
        ...point,
        baseline: editDocumentV2,
        currentClientY: clientY,
        key,
        pointerId,
        released: false,
        result: null,
        startClientY: clientY,
        toolId: 'tone-equalizer',
      };
      return [{ editDocumentV2, key, kind: 'sample-tone-equalizer', normalizedImagePoint: point.normalizedImagePoint }];
    },
    cancel: () => {
      if (session === null) return [];
      const command = clearReceipt(session.toolId);
      session = null;
      return [command];
    },
    fail: (key, current) => {
      if (session === null || !sameViewerPickerSessionKey(session.key, key)) return [];
      if (!isViewerPickerSessionCurrent(key, current)) return [];
      const command = clearReceipt(key.toolId);
      session = null;
      return [command];
    },
    move: (pointerId, clientY) => {
      if (
        (session?.toolId === 'tone-equalizer' || session?.toolId === 'color-mixer') &&
        session.pointerId === pointerId
      )
        session.currentClientY = clientY;
    },
    overlays: () =>
      session === null
        ? []
        : [
            {
              ariaLabel: `${session.toolId} sample point`,
              geometryEpoch: session.key.geometryEpoch,
              id: `${session.toolId}:${session.key.operationGeneration}`,
              normalizedImagePoint: session.normalizedImagePoint,
              status:
                (session.toolId === 'tone-equalizer' || session.toolId === 'color-mixer') && session.result !== null
                  ? 'ready'
                  : 'sampling',
              toolId: session.toolId,
              viewPoint: session.viewPoint,
            },
          ],
    receivePointColor: (key, result, current) => {
      if (
        session?.toolId !== 'point-color' ||
        !sameViewerPickerSessionKey(session.key, key) ||
        !isViewerPickerSessionCurrent(key, current) ||
        !responseMatchesKey(result, key)
      )
        return [];
      const ordinal = session.ordinal;
      const sessionKey = session.key;
      session = null;
      return [
        { key: sessionKey, kind: 'commit-point-color', ordinal, result },
        { kind: 'deactivate-point-color' },
        { kind: 'publish-point-color-receipt', result },
      ];
    },
    receiveColorMixer: (key, result, current) => {
      if (
        session?.toolId !== 'color-mixer' ||
        !sameViewerPickerSessionKey(session.key, key) ||
        !isViewerPickerSessionCurrent(key, current) ||
        !responseMatchesKey(result, key)
      )
        return [];
      session.result = result;
      session.bands = resolveColorMixerBandWeights(
        result.hueDegrees,
        selectEditDocumentNode(session.baseline, 'selective_color_mixer').params,
      );
      const commands: ViewerPickerCommand[] = [
        {
          bands: session.bands,
          delta: Math.max(-100, Math.min(100, (session.startClientY - session.currentClientY) / 2)),
          kind: 'publish-color-mixer-receipt',
          mode: session.mode,
          result,
        },
      ];
      if (session.released) commands.push(...finishColorMixer(session));
      return commands;
    },
    receiveToneEqualizer: (key, result, current) => {
      if (
        session?.toolId !== 'tone-equalizer' ||
        !sameViewerPickerSessionKey(session.key, key) ||
        !isViewerPickerSessionCurrent(key, current) ||
        !responseMatchesKey(result, key)
      )
        return [];
      session.result = result;
      const commands: ViewerPickerCommand[] = [{ kind: 'publish-tone-equalizer-receipt', result }];
      if (session.released) commands.push(...finishTone(session));
      return commands;
    },
    release: (pointerId, clientY) => {
      if (
        (session?.toolId !== 'tone-equalizer' && session?.toolId !== 'color-mixer') ||
        session.pointerId !== pointerId
      )
        return [];
      session.currentClientY = clientY;
      session.released = true;
      return session.toolId === 'color-mixer' ? finishColorMixer(session) : finishTone(session);
    },
  };
};
