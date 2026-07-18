import type {
  EditDocumentNodeParamsV2,
  EditDocumentV2,
} from '../../../../packages/rawengine-schema/src/editDocumentV2';
import type { ActiveChannel } from '../../../utils/adjustments';
import { selectEditDocumentNode } from '../../../utils/editDocumentSelectors';
import {
  type ToneCurveTargetMode,
  type ToneCurveTargetRegion,
  toneCurveChannelValue,
  toneCurveParametricRegion,
  updateToneCurveParametric,
  updateToneCurvePoint,
} from '../../../utils/toneCurveTarget';
import type { ViewerSampleRequest, ViewerSampleResult } from '../../../utils/viewerSampler';

export interface ToneCurveTargetSessionKey {
  readonly adjustmentRevision: number;
  readonly channel: ActiveChannel;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly mode: ToneCurveTargetMode;
  readonly operationGeneration: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly selectedPointIndex: number | null;
  readonly toolId: 'tone-curve';
}

export interface ToneCurveTargetPoint {
  readonly normalizedImagePoint: { readonly x: number; readonly y: number };
  readonly viewPoint: { readonly x: number; readonly y: number };
}

export interface ToneCurveTargetOverlayDescriptor extends ToneCurveTargetPoint {
  readonly ariaLabel: string;
  readonly channel: ActiveChannel;
  readonly geometryEpoch: number;
  readonly id: string;
  readonly mode: ToneCurveTargetMode;
  readonly region: ToneCurveTargetRegion;
  readonly status: 'ready' | 'sampling';
}

export type ToneCurveTargetCommitResult = {
  readonly baseline: EditDocumentV2;
  readonly curve: EditDocumentNodeParamsV2<'scene_curve'>;
  readonly delta: number;
  readonly key: ToneCurveTargetSessionKey;
  readonly kind: 'tone-curve';
};

export type ToneCurveTargetCommand =
  | {
      readonly baseline: EditDocumentV2;
      readonly key: ToneCurveTargetSessionKey;
      readonly kind: 'sample';
      readonly request: ViewerSampleRequest;
    }
  | { readonly kind: 'clear' }
  | { readonly command: ToneCurveTargetCommitResult; readonly kind: 'commit' };

export interface ToneCurveTargetCurrentContext {
  readonly active: boolean;
  readonly adjustmentRevision: number;
  readonly channel: ActiveChannel;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly mode: ToneCurveTargetMode;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly selectedPointIndex: number | null;
}

interface Session extends ToneCurveTargetPoint {
  readonly baseline: EditDocumentV2;
  readonly key: ToneCurveTargetSessionKey;
  readonly request: ViewerSampleRequest;
  readonly pointerId: number;
  readonly selectedPointIndex: number | null;
  readonly startClientY: number;
  currentClientY: number;
  delta: number;
  released: boolean;
  region: ToneCurveTargetRegion;
  result: Extract<ViewerSampleResult, { status: 'available' }> | null;
}

const sameKey = (left: ToneCurveTargetSessionKey, right: ToneCurveTargetSessionKey): boolean =>
  left.adjustmentRevision === right.adjustmentRevision &&
  left.channel === right.channel &&
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.mode === right.mode &&
  left.operationGeneration === right.operationGeneration &&
  left.sourceIdentity === right.sourceIdentity &&
  left.sourceRevision === right.sourceRevision &&
  left.selectedPointIndex === right.selectedPointIndex &&
  left.toolId === right.toolId;

const currentKey = (key: ToneCurveTargetSessionKey, context: ToneCurveTargetCurrentContext): boolean =>
  context.active &&
  context.adjustmentRevision === key.adjustmentRevision &&
  context.channel === key.channel &&
  context.geometryEpoch === key.geometryEpoch &&
  context.imageSessionId === key.imageSessionId &&
  context.mode === key.mode &&
  context.sourceIdentity === key.sourceIdentity &&
  context.sourceRevision === key.sourceRevision &&
  context.selectedPointIndex === key.selectedPointIndex;

const deltaFor = (session: Session): number => {
  const pixelDelta = session.startClientY - session.currentClientY;
  return session.key.mode === 'point' ? pixelDelta : (pixelDelta / 120) * 100;
};

export interface ToneCurveTargetInteractionController {
  begin(input: {
    baseline: EditDocumentV2;
    clientY: number;
    key: ToneCurveTargetSessionKey;
    point: ToneCurveTargetPoint;
    pointerId: number;
    request: ViewerSampleRequest;
  }): readonly ToneCurveTargetCommand[];
  cancel(): readonly ToneCurveTargetCommand[];
  commitKeyboard(
    direction: number,
    currentCurve: EditDocumentNodeParamsV2<'scene_curve'>,
  ): readonly ToneCurveTargetCommand[];
  move(pointerId: number, clientY: number): void;
  overlays(): readonly ToneCurveTargetOverlayDescriptor[];
  receive(
    key: ToneCurveTargetSessionKey,
    result: ViewerSampleResult,
    current: ToneCurveTargetCurrentContext,
  ): readonly ToneCurveTargetCommand[];
  release(
    pointerId: number,
    clientY: number,
    currentCurve: EditDocumentNodeParamsV2<'scene_curve'>,
  ): readonly ToneCurveTargetCommand[];
}

export const createToneCurveTargetInteractionController = (): ToneCurveTargetInteractionController => {
  let session: Session | null = null;
  let lastReady: Session | null = null;
  const clear = (): readonly ToneCurveTargetCommand[] => {
    if (session === null && lastReady === null) return [];
    session = null;
    lastReady = null;
    return [{ kind: 'clear' }];
  };
  const commit = (
    active: Session,
    curve: EditDocumentNodeParamsV2<'scene_curve'>,
    delta: number,
  ): ToneCurveTargetCommand => ({
    kind: 'commit',
    command: { baseline: active.baseline, curve, delta, key: active.key, kind: 'tone-curve' },
  });
  return {
    begin: ({ baseline, clientY, key, point, pointerId, request }) => {
      lastReady = null;
      session = {
        ...point,
        baseline,
        currentClientY: clientY,
        delta: 0,
        key,
        pointerId,
        released: false,
        selectedPointIndex: key.selectedPointIndex,
        region: 'point',
        request,
        result: null,
        startClientY: clientY,
      };
      return [{ baseline, key, kind: 'sample', request }];
    },
    cancel: clear,
    commitKeyboard: (direction, currentCurve) => {
      if (lastReady === null || lastReady.result === null) return [];
      const delta = lastReady.key.mode === 'point' ? direction : direction;
      const curve =
        lastReady.key.mode === 'point'
          ? updateToneCurvePoint(
              currentCurve,
              lastReady.key.channel,
              toneCurveChannelValue(lastReady.key.channel, lastReady.result.rgb, lastReady.result.luma) * 255,
              delta,
              lastReady.selectedPointIndex,
            )
          : updateToneCurveParametric(currentCurve, lastReady.key.channel, lastReady.region, delta);
      return [commit(lastReady, curve, delta)];
    },
    move: (pointerId, clientY) => {
      if (session === null || session.pointerId !== pointerId) return;
      session.currentClientY = clientY;
      session.delta = deltaFor(session);
    },
    overlays: () => {
      const active = session ?? lastReady;
      if (active === null) return [];
      return [
        {
          ariaLabel: `Tone Curve ${active.key.channel} target ${active.region}`,
          channel: active.key.channel,
          geometryEpoch: active.key.geometryEpoch,
          id: `tone-curve:${String(active.key.operationGeneration)}`,
          mode: active.key.mode,
          normalizedImagePoint: active.normalizedImagePoint,
          region: active.result === null ? 'point' : active.region,
          status: active.result === null ? 'sampling' : 'ready',
          viewPoint: active.viewPoint,
        },
      ];
    },
    receive: (key, result, current) => {
      if (session === null || !sameKey(session.key, key)) return [];
      if (
        !currentKey(key, current) ||
        result.status !== 'available' ||
        result.requestIdentity !== session.request.requestIdentity
      )
        return clear();
      const params = selectEditDocumentNode(session.baseline, 'scene_curve').params;
      session.result = result;
      session.region =
        session.key.mode === 'parametric'
          ? toneCurveParametricRegion(result.luma, params.parametricCurve[session.key.channel])
          : 'point';
      if (session.released) {
        const active = session;
        session = null;
        lastReady = active;
        if (Math.abs(active.delta) < 0.01) return [];
        const channelValue = toneCurveChannelValue(active.key.channel, result.rgb, result.luma);
        const curve =
          active.key.mode === 'point'
            ? updateToneCurvePoint(
                params,
                active.key.channel,
                channelValue * 255,
                active.delta,
                active.selectedPointIndex,
              )
            : updateToneCurveParametric(params, active.key.channel, active.region, active.delta);
        return [commit(active, curve, active.delta)];
      }
      lastReady = session;
      return [];
    },
    release: (pointerId, clientY, currentCurve) => {
      if (session === null || session.pointerId !== pointerId) return [];
      session.currentClientY = clientY;
      session.delta = deltaFor(session);
      session.released = true;
      if (session.result === null) return [];
      const active = session;
      session = null;
      lastReady = active;
      if (Math.abs(active.delta) < 0.01) return [];
      const result = active.result;
      if (result === null) return [];
      const channelValue = toneCurveChannelValue(active.key.channel, result.rgb, result.luma);
      const curve =
        active.key.mode === 'point'
          ? updateToneCurvePoint(
              currentCurve,
              active.key.channel,
              channelValue * 255,
              active.delta,
              active.selectedPointIndex,
            )
          : updateToneCurveParametric(currentCurve, active.key.channel, active.region, active.delta);
      return [commit(active, curve, active.delta)];
    },
  };
};
