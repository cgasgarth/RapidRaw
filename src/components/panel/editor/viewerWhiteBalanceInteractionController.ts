export interface ViewerWhiteBalanceInteractionPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewerWhiteBalanceInteractionContext {
  readonly cropSize: { readonly height: number; readonly width: number };
  readonly geometryEpoch: number;
  readonly previewIdentity: string;
  readonly sourceIdentity: string;
}

export interface ViewerWhiteBalanceSampleIdentity {
  readonly geometryEpoch: number;
  readonly previewIdentity: string;
  readonly sequence: number;
  readonly sourceIdentity: string;
}

export interface ViewerWhiteBalanceInteractionResult {
  readonly imagePoint: ViewerWhiteBalanceInteractionPoint;
  readonly identity: ViewerWhiteBalanceSampleIdentity;
}

/** Converts a geometry-mapped viewer point into a session-keyed picker request. */
export const resolveViewerWhiteBalanceInteraction = (
  context: ViewerWhiteBalanceInteractionContext,
  point: ViewerWhiteBalanceInteractionPoint,
  sequence: number,
): ViewerWhiteBalanceInteractionResult | null => {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(context.cropSize.width) ||
    !Number.isFinite(context.cropSize.height) ||
    context.cropSize.width <= 0 ||
    context.cropSize.height <= 0 ||
    point.x < 0 ||
    point.y < 0 ||
    point.x > context.cropSize.width ||
    point.y > context.cropSize.height ||
    !Number.isInteger(sequence) ||
    sequence <= 0 ||
    context.previewIdentity.length === 0 ||
    context.sourceIdentity.length === 0
  ) {
    return null;
  }

  return {
    imagePoint: { x: point.x, y: point.y },
    identity: {
      geometryEpoch: context.geometryEpoch,
      previewIdentity: context.previewIdentity,
      sequence,
      sourceIdentity: context.sourceIdentity,
    },
  };
};

export const isViewerWhiteBalanceSampleCurrent = (
  expected: ViewerWhiteBalanceSampleIdentity,
  actual: ViewerWhiteBalanceSampleIdentity,
  active: boolean,
): boolean =>
  active &&
  expected.sequence === actual.sequence &&
  expected.geometryEpoch === actual.geometryEpoch &&
  expected.previewIdentity === actual.previewIdentity &&
  expected.sourceIdentity === actual.sourceIdentity;
