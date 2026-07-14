import type { Crop, PercentCrop } from 'react-image-crop';
import type { ViewerOverlayDescriptor } from './viewerToolControllers';

export interface CropStraightenSessionIdentity {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly operationGeneration: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly tool: 'crop' | 'straighten';
}

export interface StraightenPoint {
  readonly x: number;
  readonly y: number;
}

export interface StraightenOverlayDescriptor extends ViewerOverlayDescriptor {
  readonly end: StraightenPoint;
  readonly kind: 'straighten-line';
  readonly start: StraightenPoint;
}

interface StraightenGesture {
  readonly end: StraightenPoint;
  readonly pointerId: number;
  readonly renderSize: { readonly height: number; readonly width: number };
  readonly rotationDegrees: number;
  readonly start: StraightenPoint;
}

export interface CropStraightenControllerState {
  readonly gesture: StraightenGesture | null;
  readonly session: CropStraightenSessionIdentity | null;
}

export type CropStraightenCleanupReason =
  | 'blur'
  | 'escape'
  | 'lost-pointer-capture'
  | 'pointer-cancel'
  | 'session-replaced'
  | 'source-changed'
  | 'tool-changed'
  | 'unmount';

export type CropStraightenControllerEvent =
  | { readonly session: CropStraightenSessionIdentity | null; readonly type: 'session-installed' }
  | { readonly identity: CropStraightenSessionIdentity; readonly type: 'crop-started' }
  | {
      readonly crop: Crop;
      readonly identity: CropStraightenSessionIdentity;
      readonly percentCrop: PercentCrop;
      readonly type: 'crop-changed';
    }
  | {
      readonly crop: Crop;
      readonly identity: CropStraightenSessionIdentity;
      readonly percentCrop: PercentCrop;
      readonly type: 'crop-completed';
    }
  | {
      readonly identity: CropStraightenSessionIdentity;
      readonly point: StraightenPoint;
      readonly pointerId: number;
      readonly renderSize: { readonly height: number; readonly width: number };
      readonly rotationDegrees: number;
      readonly type: 'pointer-started';
    }
  | {
      readonly identity: CropStraightenSessionIdentity;
      readonly point: StraightenPoint;
      readonly pointerId: number;
      readonly type: 'pointer-moved' | 'pointer-ended';
    }
  | {
      readonly identity?: CropStraightenSessionIdentity;
      readonly pointerId?: number;
      readonly reason: CropStraightenCleanupReason;
      readonly type: 'cancelled';
    };

export type CropStraightenSemanticCommand =
  | { readonly type: 'crop-started' }
  | { readonly crop: Crop; readonly percentCrop: PercentCrop; readonly type: 'crop-changed' }
  | {
      readonly crop: Crop;
      readonly identity: CropStraightenSessionIdentity;
      readonly percentCrop: PercentCrop;
      readonly type: 'crop-completed';
    }
  | { readonly pointerId: number; readonly type: 'capture-pointer' }
  | {
      readonly pointerId: number;
      readonly reason: CropStraightenCleanupReason | 'pointer-ended';
      readonly type: 'release-pointer';
    }
  | {
      readonly correctionDegrees: number;
      readonly identity: CropStraightenSessionIdentity;
      readonly type: 'straighten-committed';
    };

export interface CropStraightenControllerTransition {
  readonly commands: readonly CropStraightenSemanticCommand[];
  readonly ignored: boolean;
  readonly overlay: StraightenOverlayDescriptor | null;
  readonly state: CropStraightenControllerState;
}

export const initialCropStraightenControllerState = (): CropStraightenControllerState => ({
  gesture: null,
  session: null,
});

export const isCropStraightenSessionCurrent = (
  expected: CropStraightenSessionIdentity,
  actual: CropStraightenSessionIdentity,
): boolean =>
  expected.geometryEpoch === actual.geometryEpoch &&
  expected.imageSessionId === actual.imageSessionId &&
  expected.operationGeneration === actual.operationGeneration &&
  expected.sourceIdentity === actual.sourceIdentity &&
  expected.sourceRevision === actual.sourceRevision &&
  expected.tool === actual.tool;

export const resolveStraightenCorrection = (
  start: StraightenPoint,
  end: StraightenPoint,
  rotationDegrees: number,
  renderSize: { readonly height: number; readonly width: number },
): number | null => {
  if (start.x === end.x && start.y === end.y) return null;
  const thetaRadians = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(thetaRadians);
  const sine = Math.sin(thetaRadians);
  const centerX = renderSize.width / 2;
  const centerY = renderSize.height / 2;
  const unrotate = (point: StraightenPoint): StraightenPoint => {
    const x = point.x - centerX;
    const y = point.y - centerY;
    return { x: centerX + x * cosine + y * sine, y: centerY - x * sine + y * cosine };
  };
  const unrotatedStart = unrotate(start);
  const unrotatedEnd = unrotate(end);
  const angle = Math.atan2(unrotatedEnd.y - unrotatedStart.y, unrotatedEnd.x - unrotatedStart.x) * (180 / Math.PI);
  const targetAngle =
    angle > -45 && angle <= 45 ? 0 : angle > 45 && angle <= 135 ? 90 : angle > 135 || angle <= -135 ? 180 : -90;
  let correction = targetAngle - angle;
  if (correction > 180) correction -= 360;
  if (correction < -180) correction += 360;
  return correction;
};

export const cropStraightenOverlay = (state: CropStraightenControllerState): StraightenOverlayDescriptor | null => {
  if (state.session === null || state.gesture === null) return null;
  return {
    ariaLabel: 'Straighten guide',
    end: state.gesture.end,
    geometryEpoch: state.session.geometryEpoch,
    id: `straighten:${state.session.operationGeneration}:${state.gesture.pointerId}`,
    kind: 'straighten-line',
    pointerPolicy: 'capture',
    start: state.gesture.start,
    zOrder: 'active-tool',
  };
};

const transition = (
  state: CropStraightenControllerState,
  commands: readonly CropStraightenSemanticCommand[],
  ignored = false,
): CropStraightenControllerTransition => ({ commands, ignored, overlay: cropStraightenOverlay(state), state });

const cleanup = (
  state: CropStraightenControllerState,
  reason: CropStraightenCleanupReason,
  session = state.session,
): CropStraightenControllerTransition => {
  const commands =
    state.gesture === null ? [] : [{ pointerId: state.gesture.pointerId, reason, type: 'release-pointer' as const }];
  return transition({ gesture: null, session }, commands);
};

const replacementReason = (
  previous: CropStraightenSessionIdentity | null,
  next: CropStraightenSessionIdentity | null,
): CropStraightenCleanupReason => {
  if (previous === null) return 'session-replaced';
  if (next === null || previous.tool !== next.tool) return 'tool-changed';
  if (
    previous.imageSessionId !== next.imageSessionId ||
    previous.sourceIdentity !== next.sourceIdentity ||
    previous.sourceRevision !== next.sourceRevision
  )
    return 'source-changed';
  return 'session-replaced';
};

export const reduceCropStraightenController = (
  state: CropStraightenControllerState,
  event: CropStraightenControllerEvent,
): CropStraightenControllerTransition => {
  if (event.type === 'session-installed') {
    if (
      state.session === event.session ||
      (state.session !== null && event.session !== null && isCropStraightenSessionCurrent(state.session, event.session))
    )
      return transition(state, []);
    return cleanup(state, replacementReason(state.session, event.session), event.session);
  }
  if (event.type === 'cancelled') {
    if (
      (event.identity !== undefined &&
        (state.session === null || !isCropStraightenSessionCurrent(event.identity, state.session))) ||
      (event.pointerId !== undefined && state.gesture !== null && event.pointerId !== state.gesture.pointerId)
    )
      return transition(state, [], true);
    return cleanup(state, event.reason);
  }
  if (state.session === null || !isCropStraightenSessionCurrent(event.identity, state.session))
    return transition(state, [], true);

  if (event.type === 'crop-started') {
    if (state.session.tool !== 'crop') return transition(state, [], true);
    return transition(state, [{ type: 'crop-started' }]);
  }
  if (event.type === 'crop-changed' || event.type === 'crop-completed') {
    if (state.session.tool !== 'crop') return transition(state, [], true);
    return transition(state, [
      event.type === 'crop-completed'
        ? { crop: event.crop, identity: state.session, percentCrop: event.percentCrop, type: event.type }
        : { crop: event.crop, percentCrop: event.percentCrop, type: event.type },
    ]);
  }
  if (event.type === 'pointer-started') {
    if (state.session.tool !== 'straighten' || state.gesture !== null) return transition(state, [], true);
    const next = {
      ...state,
      gesture: {
        end: event.point,
        pointerId: event.pointerId,
        renderSize: event.renderSize,
        rotationDegrees: event.rotationDegrees,
        start: event.point,
      },
    };
    return transition(next, [{ pointerId: event.pointerId, type: 'capture-pointer' }]);
  }
  if (state.gesture === null || state.gesture.pointerId !== event.pointerId) return transition(state, [], true);
  if (event.type === 'pointer-moved')
    return transition({ ...state, gesture: { ...state.gesture, end: event.point } }, []);

  const correction = resolveStraightenCorrection(
    state.gesture.start,
    event.point,
    state.gesture.rotationDegrees,
    state.gesture.renderSize,
  );
  const commands: CropStraightenSemanticCommand[] = [
    { pointerId: event.pointerId, reason: 'pointer-ended', type: 'release-pointer' },
  ];
  if (correction !== null)
    commands.push({ correctionDegrees: correction, identity: state.session, type: 'straighten-committed' });
  return transition({ ...state, gesture: null }, commands);
};

export interface CropStraightenController {
  dispatch(event: CropStraightenControllerEvent): CropStraightenControllerTransition;
  getState(): CropStraightenControllerState;
}

export const createCropStraightenController = (): CropStraightenController => {
  let state = initialCropStraightenControllerState();
  return {
    dispatch: (event) => {
      const result = reduceCropStraightenController(state, event);
      state = result.state;
      return result;
    },
    getState: () => state,
  };
};
