import type { NegativeLabFrameCropStatus } from '../../schemas/negative-lab/negativeLabFrameHealthSchemas';
import type { NegativeLabFrameRgbBalanceOffset } from '../../schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas';
import {
  type NegativeLabSessionFrameState,
  type NegativeLabSessionRecipeState,
  type NegativeLabSessionState,
  parseNegativeLabSessionState,
} from '../../schemas/negative-lab/negativeLabSessionStateSchemas';
import type { NegativeLabBatchApplyReceipt } from './negativeLabBatchApplyReceipt';
import type { NegativeLabConversionBundleReplayReport } from './negativeLabConversionBundle';
import type {
  NegativeLabRollNormalizationApplyReceipt,
  NegativeLabRollNormalizationRestoreReceipt,
} from './negativeLabRollNormalizationApply';

export interface NegativeLabSessionProofState {
  batchApplyReceipt: NegativeLabBatchApplyReceipt | null;
  conversionBundleReplay: NegativeLabConversionBundleReplayReport | null;
  rollNormalizationApplyReceipt: NegativeLabRollNormalizationApplyReceipt | null;
  rollNormalizationRestoreReceipt: NegativeLabRollNormalizationRestoreReceipt | null;
}

export interface CreateNegativeLabSessionStateOptions {
  recipeState: NegativeLabSessionRecipeState;
  sessionId: string;
}

export interface NegativeLabSessionFrameViewState {
  activePathIndex: number;
  cropStatusByFrameId: Record<string, NegativeLabFrameCropStatus>;
  frameExposureOffsetByFrameId: Record<string, number>;
  frameRgbBalanceOffsetByFrameId: Record<string, NegativeLabFrameRgbBalanceOffset>;
  includedPathSet: Set<string>;
  qcDecisionByFrameId: Record<string, 'approved' | 'rejected'>;
}

export interface NegativeLabSessionSnapshot {
  planState: NegativeLabSessionState['planState'];
  proofState: NegativeLabSessionProofState;
  session: NegativeLabSessionState;
}

const DEFAULT_FRAME_STATE: NegativeLabSessionFrameState = {
  cropStatus: null,
  exposureOffset: null,
  included: true,
  qcDecision: null,
  rgbBalanceOffset: null,
};

const createFrameId = (index: number) => `negative-lab-frame-${index + 1}`;

const shallowEqualObject = <T extends Record<string, unknown>>(left: T, right: T): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
};

const frameStateEquals = (left: NegativeLabSessionFrameState, right: NegativeLabSessionFrameState): boolean =>
  left.included === right.included &&
  left.qcDecision === right.qcDecision &&
  left.cropStatus === right.cropStatus &&
  left.exposureOffset === right.exposureOffset &&
  ((left.rgbBalanceOffset === null && right.rgbBalanceOffset === null) ||
    (left.rgbBalanceOffset !== null &&
      right.rgbBalanceOffset !== null &&
      shallowEqualObject(left.rgbBalanceOffset, right.rgbBalanceOffset)));

const normalizeFrameState = (
  frameState: Partial<NegativeLabSessionFrameState> | NegativeLabSessionFrameState | undefined,
): NegativeLabSessionFrameState => ({
  cropStatus: frameState?.cropStatus ?? null,
  exposureOffset: frameState?.exposureOffset ?? null,
  included: frameState?.included ?? true,
  qcDecision: frameState?.qcDecision ?? null,
  rgbBalanceOffset: frameState?.rgbBalanceOffset ?? null,
});

const bumpSessionRevision = (state: NegativeLabSessionState): NegativeLabSessionState => ({
  ...state,
  sessionRevision: state.sessionRevision + 1,
});

const updateSessionFrameStateByPath = (
  state: NegativeLabSessionState,
  path: string,
  updater: (frameState: NegativeLabSessionFrameState) => NegativeLabSessionFrameState,
): NegativeLabSessionState => {
  if (!state.targetPaths.includes(path)) return state;
  const currentFrameState = normalizeFrameState(state.frameStateByPath[path]);
  const nextFrameState = normalizeFrameState(updater(currentFrameState));
  if (frameStateEquals(currentFrameState, nextFrameState)) return state;
  return bumpSessionRevision({
    ...state,
    frameStateByPath: {
      ...state.frameStateByPath,
      [path]: nextFrameState,
    },
  });
};

const updateSessionRecipeState = (
  state: NegativeLabSessionState,
  updater: (recipeState: NegativeLabSessionRecipeState) => NegativeLabSessionRecipeState,
): NegativeLabSessionState => {
  const nextRecipeState = updater(state.recipeState);
  if (nextRecipeState === state.recipeState) return state;
  return bumpSessionRevision({
    ...state,
    recipeState: nextRecipeState,
  });
};

const resolvePathForFrameId = (targetPaths: readonly string[], frameId: string): string | null => {
  const frameIndex = Number(frameId.replace('negative-lab-frame-', '')) - 1;
  if (!Number.isInteger(frameIndex) || frameIndex < 0) return null;
  return targetPaths[frameIndex] ?? null;
};

const chooseNextActivePath = (
  previousActivePath: string | null,
  previousTargetPaths: readonly string[],
  nextTargetPaths: readonly string[],
): string | null => {
  if (nextTargetPaths.length === 0) return null;
  if (previousActivePath !== null && nextTargetPaths.includes(previousActivePath)) return previousActivePath;
  if (previousActivePath === null) return nextTargetPaths[0] ?? null;

  const previousActiveIndex = previousTargetPaths.indexOf(previousActivePath);
  if (previousActiveIndex === -1) return nextTargetPaths[0] ?? null;
  const nextIndex = Math.min(previousActiveIndex, nextTargetPaths.length - 1);
  return nextTargetPaths[nextIndex] ?? null;
};

export const createNegativeLabSessionState = (
  targetPaths: readonly string[],
  options: CreateNegativeLabSessionStateOptions,
): NegativeLabSessionSnapshot => {
  const uniqueTargetPaths = [...new Set(targetPaths)];
  const frameStateByPath = Object.fromEntries(uniqueTargetPaths.map((path) => [path, DEFAULT_FRAME_STATE]));
  const session = parseNegativeLabSessionState({
    activePath: uniqueTargetPaths[0] ?? null,
    frameStateByPath,
    planState: {
      acceptedApplyPlanFingerprint: null,
      acceptedSessionRevision: null,
      rollNormalizationRestoreRevision: 0,
    },
    recipeState: options.recipeState,
    sessionId: options.sessionId,
    sessionRevision: 0,
    targetPaths: uniqueTargetPaths,
    version: 1,
  });

  return {
    planState: session.planState,
    proofState: {
      batchApplyReceipt: null,
      conversionBundleReplay: null,
      rollNormalizationApplyReceipt: null,
      rollNormalizationRestoreReceipt: null,
    },
    session,
  };
};

export const reconcileNegativeLabSessionTargetPaths = (
  snapshot: NegativeLabSessionSnapshot,
  targetPaths: readonly string[],
): NegativeLabSessionSnapshot => {
  const uniqueTargetPaths = [...new Set(targetPaths)];
  const nextFrameStateByPath = Object.fromEntries(
    uniqueTargetPaths.map((path) => [path, normalizeFrameState(snapshot.session.frameStateByPath[path])]),
  );
  const nextActivePath = chooseNextActivePath(
    snapshot.session.activePath,
    snapshot.session.targetPaths,
    uniqueTargetPaths,
  );

  const targetPathsChanged =
    uniqueTargetPaths.length !== snapshot.session.targetPaths.length ||
    uniqueTargetPaths.some((path, index) => path !== snapshot.session.targetPaths[index]);
  const frameStatesChanged =
    Object.keys(nextFrameStateByPath).length !== Object.keys(snapshot.session.frameStateByPath).length ||
    uniqueTargetPaths.some(
      (path) =>
        !frameStateEquals(
          nextFrameStateByPath[path] ?? DEFAULT_FRAME_STATE,
          normalizeFrameState(snapshot.session.frameStateByPath[path]),
        ),
    );

  if (!targetPathsChanged && !frameStatesChanged && nextActivePath === snapshot.session.activePath) {
    return snapshot;
  }

  return {
    ...snapshot,
    session: bumpSessionRevision(
      parseNegativeLabSessionState({
        ...snapshot.session,
        activePath: nextActivePath,
        frameStateByPath: nextFrameStateByPath,
        targetPaths: uniqueTargetPaths,
      }),
    ),
  };
};

export const buildNegativeLabSessionFrameViewState = (
  snapshot: NegativeLabSessionSnapshot,
): NegativeLabSessionFrameViewState => {
  const activePathIndex = (() => {
    if (snapshot.session.activePath === null) return 0;
    const index = snapshot.session.targetPaths.indexOf(snapshot.session.activePath);
    return index >= 0 ? index : 0;
  })();

  const cropStatusByFrameId: Record<string, NegativeLabFrameCropStatus> = {};
  const frameExposureOffsetByFrameId: Record<string, number> = {};
  const frameRgbBalanceOffsetByFrameId: Record<string, NegativeLabFrameRgbBalanceOffset> = {};
  const qcDecisionByFrameId: Record<string, 'approved' | 'rejected'> = {};
  const includedPathSet = new Set<string>();

  snapshot.session.targetPaths.forEach((path, index) => {
    const frameId = createFrameId(index);
    const frameState = normalizeFrameState(snapshot.session.frameStateByPath[path]);
    if (frameState.included) includedPathSet.add(path);
    if (frameState.cropStatus !== null) cropStatusByFrameId[frameId] = frameState.cropStatus;
    if (frameState.exposureOffset !== null) frameExposureOffsetByFrameId[frameId] = frameState.exposureOffset;
    if (frameState.rgbBalanceOffset !== null) frameRgbBalanceOffsetByFrameId[frameId] = frameState.rgbBalanceOffset;
    if (frameState.qcDecision !== null) qcDecisionByFrameId[frameId] = frameState.qcDecision;
  });

  return {
    activePathIndex,
    cropStatusByFrameId,
    frameExposureOffsetByFrameId,
    frameRgbBalanceOffsetByFrameId,
    includedPathSet,
    qcDecisionByFrameId,
  };
};

export const setNegativeLabSessionActiveFrame = (
  snapshot: NegativeLabSessionSnapshot,
  frameId: string,
): NegativeLabSessionSnapshot => {
  const nextActivePath = resolvePathForFrameId(snapshot.session.targetPaths, frameId);
  if (nextActivePath === null || nextActivePath === snapshot.session.activePath) return snapshot;
  return {
    ...snapshot,
    session: bumpSessionRevision({
      ...snapshot.session,
      activePath: nextActivePath,
    }),
  };
};

export const setNegativeLabSessionIncludedPathSet = (
  snapshot: NegativeLabSessionSnapshot,
  includedPathSet: ReadonlySet<string>,
): NegativeLabSessionSnapshot => {
  let nextSession = snapshot.session;
  for (const path of snapshot.session.targetPaths) {
    const shouldInclude = includedPathSet.has(path);
    nextSession = updateSessionFrameStateByPath(nextSession, path, (frameState) => ({
      ...frameState,
      included: shouldInclude,
    }));
  }
  return nextSession === snapshot.session ? snapshot : { ...snapshot, session: nextSession };
};

export const setNegativeLabSessionFrameCropStatus = (
  snapshot: NegativeLabSessionSnapshot,
  frameId: string,
  cropStatus: NegativeLabFrameCropStatus | null,
): NegativeLabSessionSnapshot => {
  const path = resolvePathForFrameId(snapshot.session.targetPaths, frameId);
  if (path === null) return snapshot;
  const nextSession = updateSessionFrameStateByPath(snapshot.session, path, (frameState) => ({
    ...frameState,
    cropStatus,
  }));
  return nextSession === snapshot.session ? snapshot : { ...snapshot, session: nextSession };
};

export const setNegativeLabSessionFrameExposureOffset = (
  snapshot: NegativeLabSessionSnapshot,
  frameId: string,
  exposureOffset: number | null,
): NegativeLabSessionSnapshot => {
  const path = resolvePathForFrameId(snapshot.session.targetPaths, frameId);
  if (path === null) return snapshot;
  const nextSession = updateSessionFrameStateByPath(snapshot.session, path, (frameState) => ({
    ...frameState,
    exposureOffset,
  }));
  return nextSession === snapshot.session ? snapshot : { ...snapshot, session: nextSession };
};

export const setNegativeLabSessionFrameRgbBalanceOffset = (
  snapshot: NegativeLabSessionSnapshot,
  frameId: string,
  rgbBalanceOffset: NegativeLabFrameRgbBalanceOffset | null,
): NegativeLabSessionSnapshot => {
  const path = resolvePathForFrameId(snapshot.session.targetPaths, frameId);
  if (path === null) return snapshot;
  const nextSession = updateSessionFrameStateByPath(snapshot.session, path, (frameState) => ({
    ...frameState,
    rgbBalanceOffset,
  }));
  return nextSession === snapshot.session ? snapshot : { ...snapshot, session: nextSession };
};

export const setNegativeLabSessionQcDecision = (
  snapshot: NegativeLabSessionSnapshot,
  frameId: string,
  qcDecision: 'approved' | 'pending' | 'rejected',
): NegativeLabSessionSnapshot => {
  const path = resolvePathForFrameId(snapshot.session.targetPaths, frameId);
  if (path === null) return snapshot;
  const nextSession = updateSessionFrameStateByPath(snapshot.session, path, (frameState) => ({
    ...frameState,
    qcDecision: qcDecision === 'pending' ? null : qcDecision,
  }));
  return nextSession === snapshot.session ? snapshot : { ...snapshot, session: nextSession };
};

export const updateNegativeLabSessionRecipe = (
  snapshot: NegativeLabSessionSnapshot,
  updater: (recipeState: NegativeLabSessionRecipeState) => NegativeLabSessionRecipeState,
): NegativeLabSessionSnapshot => {
  const nextSession = updateSessionRecipeState(snapshot.session, updater);
  return nextSession === snapshot.session ? snapshot : { ...snapshot, session: nextSession };
};

export const acceptNegativeLabSessionPlan = (
  snapshot: NegativeLabSessionSnapshot,
  acceptedApplyPlanFingerprint: string | null,
): NegativeLabSessionSnapshot => {
  if (snapshot.planState.acceptedApplyPlanFingerprint === acceptedApplyPlanFingerprint) return snapshot;
  return {
    ...snapshot,
    planState: {
      ...snapshot.planState,
      acceptedApplyPlanFingerprint,
      acceptedSessionRevision: acceptedApplyPlanFingerprint === null ? null : snapshot.session.sessionRevision,
    },
  };
};

export const setNegativeLabSessionRollNormalizationRestoreRevision = (
  snapshot: NegativeLabSessionSnapshot,
  rollNormalizationRestoreRevision: number,
): NegativeLabSessionSnapshot => {
  if (snapshot.planState.rollNormalizationRestoreRevision === rollNormalizationRestoreRevision) return snapshot;
  return {
    ...snapshot,
    planState: {
      ...snapshot.planState,
      rollNormalizationRestoreRevision,
    },
  };
};

export const setNegativeLabSessionBatchApplyReceipt = (
  snapshot: NegativeLabSessionSnapshot,
  batchApplyReceipt: NegativeLabBatchApplyReceipt | null,
): NegativeLabSessionSnapshot =>
  snapshot.proofState.batchApplyReceipt === batchApplyReceipt
    ? snapshot
    : {
        ...snapshot,
        proofState: {
          ...snapshot.proofState,
          batchApplyReceipt,
        },
      };

export const setNegativeLabSessionRollNormalizationApplyReceipt = (
  snapshot: NegativeLabSessionSnapshot,
  rollNormalizationApplyReceipt: NegativeLabRollNormalizationApplyReceipt | null,
): NegativeLabSessionSnapshot =>
  snapshot.proofState.rollNormalizationApplyReceipt === rollNormalizationApplyReceipt
    ? snapshot
    : {
        ...snapshot,
        proofState: {
          ...snapshot.proofState,
          rollNormalizationApplyReceipt,
        },
      };

export const setNegativeLabSessionRollNormalizationRestoreReceipt = (
  snapshot: NegativeLabSessionSnapshot,
  rollNormalizationRestoreReceipt: NegativeLabRollNormalizationRestoreReceipt | null,
): NegativeLabSessionSnapshot =>
  snapshot.proofState.rollNormalizationRestoreReceipt === rollNormalizationRestoreReceipt
    ? snapshot
    : {
        ...snapshot,
        proofState: {
          ...snapshot.proofState,
          rollNormalizationRestoreReceipt,
        },
      };
