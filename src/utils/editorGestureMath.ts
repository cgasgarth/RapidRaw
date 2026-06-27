export const TRACKPAD_ZOOM_SPEED_FACTOR = 5;
export const WHEEL_ZOOM_SENSITIVITY = 0.002;
export const WHEEL_PAN_RESISTANCE = 0.5;
export const POINTER_OVERSCROLL_RESISTANCE = 0.35;
export const MAX_PAN_VELOCITY_SAMPLES = 6;
export const PAN_VELOCITY_RECENCY_MS = 50;
export const PAN_VELOCITY_THRESHOLD = 0.05;
export const WHEEL_SNAP_DELAY_MS = 150;

export interface WheelGestureInput {
  altKey: boolean;
  ctrlKey: boolean;
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
}

export interface PanVelocitySample {
  t: number;
  x: number;
  y: number;
}

export interface TransformBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export const getPrimaryWheelDelta = ({ deltaX, deltaY }: Pick<WheelGestureInput, 'deltaX' | 'deltaY'>): number =>
  deltaY !== 0 ? deltaY : deltaX;

export const getWheelZoomMultiplier = (isTrackpad: boolean, zoomSpeedMultiplier = 1): number =>
  isTrackpad ? zoomSpeedMultiplier * TRACKPAD_ZOOM_SPEED_FACTOR : zoomSpeedMultiplier;

export const isWheelZoomIntent = (event: WheelGestureInput, isTrackpad: boolean): boolean =>
  event.ctrlKey || (!isTrackpad && !event.shiftKey && !event.altKey);

export const getWheelZoomExponent = (event: WheelGestureInput, zoomSpeedMultiplier: number): number =>
  getPrimaryWheelDelta(event) * WHEEL_ZOOM_SENSITIVITY * zoomSpeedMultiplier;

export const getWheelPanDelta = (event: WheelGestureInput, isTrackpad: boolean): { dx: number; dy: number } => {
  if (isTrackpad) return { dx: event.deltaX, dy: event.deltaY };

  const primaryDelta = getPrimaryWheelDelta(event);

  if (event.shiftKey && event.altKey) {
    return { dx: primaryDelta, dy: primaryDelta };
  }
  if (event.shiftKey) {
    return { dx: primaryDelta, dy: 0 };
  }
  if (event.altKey) {
    return { dx: 0, dy: primaryDelta };
  }

  return { dx: event.deltaX, dy: event.deltaY };
};

export const applyBoundResistance = (value: number, min: number, max: number, resistance: number): number => {
  if (value > max) return max + (value - max) * resistance;
  if (value < min) return min + (value - min) * resistance;
  return value;
};

export const applyWheelPanResistance = (x: number, y: number, bounds: TransformBounds): { x: number; y: number } => ({
  x: applyBoundResistance(x, bounds.minX, bounds.maxX, WHEEL_PAN_RESISTANCE),
  y: applyBoundResistance(y, bounds.minY, bounds.maxY, WHEEL_PAN_RESISTANCE),
});

export const applyPointerOverscrollResistance = (
  dx: number,
  dy: number,
  current: { x: number; y: number },
  bounds: TransformBounds,
): { dx: number; dy: number } => ({
  dx:
    (current.x < bounds.minX && dx < 0) || (current.x > bounds.maxX && dx > 0)
      ? dx * POINTER_OVERSCROLL_RESISTANCE
      : dx,
  dy:
    (current.y < bounds.minY && dy < 0) || (current.y > bounds.maxY && dy > 0)
      ? dy * POINTER_OVERSCROLL_RESISTANCE
      : dy,
});

export const getRecentPanVelocity = (
  history: readonly PanVelocitySample[],
  now: number,
): { vx: number; vy: number } => {
  if (history.length <= 1) return { vx: 0, vy: 0 };

  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last) return { vx: 0, vy: 0 };

  const dt = last.t - first.t;
  if (dt <= 0 || now - last.t >= PAN_VELOCITY_RECENCY_MS) {
    return { vx: 0, vy: 0 };
  }

  return {
    vx: (last.x - first.x) / dt,
    vy: (last.y - first.y) / dt,
  };
};
