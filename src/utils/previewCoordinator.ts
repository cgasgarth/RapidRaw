import { z } from 'zod';
import { AdaptivePreviewQualityController } from './adaptivePreviewQuality';
import type { OriginalPreviewRequest } from './originalPreviewEffectRunner';
import type { PreparedPreviewRequestIntent } from './previewRequestIntentAdapter';

/** Creates the stateful quality policy owned by preview coordination. */
export const createPreviewQualityPolicy = (): AdaptivePreviewQualityController =>
  new AdaptivePreviewQualityController();

const revisionSchema = z.number().int().nonnegative().safe();
const positiveRevisionSchema = z.number().int().positive().safe();

export const previewOperationKindSchema = z.enum(['interactive', 'settled', 'original', 'analytics']);
export type PreviewOperationKind = z.infer<typeof previewOperationKindSchema>;

export const previewGraphRevisionSchema = z
  .object({
    adjustmentRevision: positiveRevisionSchema,
    geometryRevision: revisionSchema,
    imageSessionId: positiveRevisionSchema,
    maskRevision: revisionSchema,
    patchRevision: revisionSchema,
    proofRevision: revisionSchema,
    proposalFingerprint: z.string().trim().min(1),
  })
  .strict();

export type PreviewGraphRevision = z.infer<typeof previewGraphRevisionSchema>;

export const previewSessionIdentitySchema = z
  .object({
    adjustmentRevision: positiveRevisionSchema,
    backend: z.enum(['cpu', 'wgpu']),
    displayGeneration: positiveRevisionSchema,
    geometryRevision: revisionSchema,
    graphRevision: z.string().trim().min(1),
    imageSessionId: positiveRevisionSchema,
    maskRevision: revisionSchema,
    patchRevision: revisionSchema,
    proofRevision: revisionSchema,
    roiFingerprint: z.string().trim().min(1),
    sourceImagePath: z.string().trim().min(1),
    sourceRevision: positiveRevisionSchema,
    targetHeight: positiveRevisionSchema,
    targetWidth: positiveRevisionSchema,
    viewportRevision: revisionSchema,
  })
  .strict();

export type PreviewSessionIdentity = z.infer<typeof previewSessionIdentitySchema>;

export const previewOperationIdentitySchema = z
  .object({
    operationId: positiveRevisionSchema,
    kind: previewOperationKindSchema,
    generation: positiveRevisionSchema,
    session: previewSessionIdentitySchema,
  })
  .strict();

export type PreviewOperationIdentity = z.infer<typeof previewOperationIdentitySchema>;

export const previewArtifactSchema = z
  .object({
    identity: previewOperationIdentitySchema,
    url: z.string().trim().min(1),
  })
  .strict();

export type PreviewArtifact = z.infer<typeof previewArtifactSchema>;

export type PreviewOperationStatus =
  | 'cancelled'
  | 'failed'
  | 'idle'
  | 'presented'
  | 'queued'
  | 'running'
  | 'superseded';

export interface PreviewOperationState {
  error?: string;
  identity?: PreviewOperationIdentity;
  status: PreviewOperationStatus;
}

export interface PreviewIntent {
  identity: PreviewOperationIdentity;
  reason: string;
}

export interface PreviewViewportSnapshot {
  revision: number;
  roiFingerprint: string;
  targetHeight: number;
  targetWidth: number;
}

export interface PreviewViewportTransformSnapshot {
  positionX: number;
  positionY: number;
  scale: number;
}

export interface PreviewViewportLayoutSnapshot {
  containerHeight: number;
  containerWidth: number;
  height: number;
  offsetX: number;
  offsetY: number;
  width: number;
}

export type PreviewRoi = readonly [number, number, number, number] | null;

export function quantizePreviewRoi(roi: PreviewRoi, targetResolution: number): PreviewRoi {
  if (roi === null) return null;
  const resolution = Math.max(1, Math.round(targetResolution));
  return roi.map((value) => Math.round(value * resolution) / resolution) as [number, number, number, number];
}

export function fingerprintPreviewRoi(roi: PreviewRoi): string {
  return JSON.stringify(roi ?? [0, 0, 1, 1]);
}

export function resolvePreviewViewportRoi(
  layout: PreviewViewportLayoutSnapshot,
  transform: PreviewViewportTransformSnapshot,
): PreviewRoi {
  const { containerHeight, containerWidth, height, offsetX, offsetY, width } = layout;
  const { positionX, positionY, scale } = transform;
  if (
    ![containerHeight, containerWidth, height, offsetX, offsetY, positionX, positionY, scale, width].every(
      Number.isFinite,
    ) ||
    width <= 0 ||
    height <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    scale <= 1.01
  ) {
    return null;
  }

  const visibleLeft = -positionX / scale;
  const visibleTop = -positionY / scale;
  const visibleRight = visibleLeft + containerWidth / scale;
  const visibleBottom = visibleTop + containerHeight / scale;
  const intersectLeft = Math.max(visibleLeft, offsetX);
  const intersectTop = Math.max(visibleTop, offsetY);
  const intersectRight = Math.min(visibleRight, offsetX + width);
  const intersectBottom = Math.min(visibleBottom, offsetY + height);
  if (intersectLeft >= intersectRight || intersectTop >= intersectBottom) return null;

  const roi: Exclude<PreviewRoi, null> = [
    (intersectLeft - offsetX) / width,
    (intersectTop - offsetY) / height,
    (intersectRight - intersectLeft) / width,
    (intersectBottom - intersectTop) / height,
  ];
  return roi[2] > 0.999 && roi[3] > 0.999 ? null : roi;
}

export interface PreviewQualitySnapshot {
  effectiveTargetResolution: number;
  interacting: boolean;
  reason: string;
  requestedTargetResolution: number;
  roiFingerprint: string;
  sufficientForSemanticZoom: boolean;
  tier: string;
}

export interface PreviewSchedulingOriginalRequest {
  readonly request: OriginalPreviewRequest;
  readonly session: PreviewSessionIdentity;
  readonly viewport: PreviewViewportSnapshot;
}

export interface PreviewSchedulingInputSnapshot {
  readonly compareActive: boolean;
  readonly devicePixelRatio: number;
  readonly displayHeight: number;
  readonly displayWidth: number;
  readonly edited: PreparedPreviewRequestIntent | null;
  readonly enableLivePreviews: boolean;
  readonly original: PreviewSchedulingOriginalRequest | null;
  readonly ready: boolean;
}

export interface PreviewInvalidationRequest {
  readonly displayGeneration: number;
  readonly reason: 'display-generation-changed' | 'scope-recovery-requested';
  readonly requestId: number | null;
  readonly sessionFingerprint: string;
  readonly targetResolution: number;
}

export interface PreviewTransitionReceipt {
  event: PreviewCoordinatorEvent['type'];
  operationId?: number;
  reason: string;
  staleCompletion: boolean;
}

export interface PreviewCoordinatorState {
  analytics: PreviewOperationState;
  desired: PreviewIntent | null;
  displayGeneration: number;
  interactive: PreviewOperationState;
  interactionGeneration: number;
  interactionActive: boolean;
  invalidationSourceFingerprint: string | null;
  handledScopeRecoveryRequestId: number | null;
  lastTransition: PreviewTransitionReceipt | null;
  nextOperationId: number;
  original: PreviewOperationState;
  originalArtifact: PreviewArtifact | null;
  persistence: PreviewOperationState;
  quality: PreviewQualitySnapshot | null;
  schedulingInputs: PreviewSchedulingInputSnapshot | null;
  settled: PreviewOperationState;
  session: PreviewSessionIdentity | null;
  staleCompletionCount: number;
  visibleArtifact: PreviewArtifact | null;
  viewport: PreviewViewportSnapshot | null;
}

export type PreviewCoordinatorEffect =
  | { type: 'capture-invalidation'; invalidation: PreviewInvalidationRequest; scopeRecovery: boolean }
  | { type: 'cancel'; identity: PreviewOperationIdentity; reason: string }
  | { type: 'clear-original'; reason: string }
  | { type: 'present'; identity: PreviewOperationIdentity; reason: string }
  | { type: 'publish'; artifact: PreviewArtifact; identity: PreviewOperationIdentity; reason: string }
  | { type: 'release-url'; url: string; reason: string }
  | { type: 'schedule-edited'; delayMs: number; prepared: PreparedPreviewRequestIntent; reason: string }
  | { type: 'schedule-original'; delayMs: number; prepared: PreviewSchedulingOriginalRequest; reason: string }
  | { type: 'start'; identity: PreviewOperationIdentity; reason: string };

export type PreviewCoordinatorEvent =
  | { type: 'cancel-session'; reason?: string }
  | { type: 'display-generation-changed'; generation: number }
  | { type: 'image-session-installed'; session: PreviewSessionIdentity }
  | { type: 'invalidation-source-installed'; scopeRecoveryRequestId: number; session: PreviewSessionIdentity }
  | { type: 'interaction-ended'; settledIdentity?: PreviewSessionIdentity }
  | { type: 'interaction-started' }
  | { type: 'operation-completed'; artifact?: PreviewArtifact; identity: PreviewOperationIdentity }
  | { type: 'operation-failed'; error: string; identity: PreviewOperationIdentity }
  | { type: 'original-preview-cleared'; reason: string }
  | { type: 'operation-started'; identity: PreviewOperationIdentity }
  | { type: 'quality-decision-changed'; quality: PreviewQualitySnapshot }
  | {
      type: 'preview-invalidation-captured';
      inputs: PreviewSchedulingInputSnapshot;
      invalidation: PreviewInvalidationRequest;
    }
  | { type: 'preview-invalidation-requested'; invalidation: PreviewInvalidationRequest }
  | { type: 'scheduling-inputs-changed'; inputs: PreviewSchedulingInputSnapshot }
  | { type: 'viewport-changed'; viewport: PreviewViewportSnapshot }
  | { identity: PreviewSessionIdentity; kind: PreviewOperationKind; reason?: string; type: 'render-inputs-changed' };

export interface PreviewCoordinatorTransition {
  effects: PreviewCoordinatorEffect[];
  state: PreviewCoordinatorState;
}

const idleOperation = (): PreviewOperationState => ({ status: 'idle' });

export function createPreviewCoordinatorState(): PreviewCoordinatorState {
  return {
    analytics: idleOperation(),
    desired: null,
    displayGeneration: 1,
    interactive: idleOperation(),
    interactionGeneration: 1,
    interactionActive: false,
    invalidationSourceFingerprint: null,
    handledScopeRecoveryRequestId: null,
    lastTransition: null,
    nextOperationId: 1,
    original: idleOperation(),
    originalArtifact: null,
    persistence: idleOperation(),
    quality: null,
    schedulingInputs: null,
    settled: idleOperation(),
    session: null,
    staleCompletionCount: 0,
    visibleArtifact: null,
    viewport: null,
  };
}

export function fingerprintPreviewSessionIdentity(value: PreviewSessionIdentity): string {
  return JSON.stringify(previewSessionIdentitySchema.parse(value));
}

export function fingerprintPreviewGraphRevision(value: PreviewGraphRevision): string {
  return JSON.stringify(previewGraphRevisionSchema.parse(value));
}

export function fingerprintPreviewOperationIdentity(value: PreviewOperationIdentity): string {
  return JSON.stringify(previewOperationIdentitySchema.parse(value));
}

function sameSession(left: PreviewSessionIdentity | null, right: PreviewSessionIdentity): boolean {
  return (
    left !== null &&
    left.imageSessionId === right.imageSessionId &&
    left.sourceImagePath === right.sourceImagePath &&
    left.sourceRevision === right.sourceRevision
  );
}

function sameOperation(left: PreviewOperationIdentity | undefined, right: PreviewOperationIdentity): boolean {
  return left !== undefined && fingerprintPreviewOperationIdentity(left) === fingerprintPreviewOperationIdentity(right);
}

function operationForKind(state: PreviewCoordinatorState, kind: PreviewOperationKind): PreviewOperationState {
  return state[kind];
}

function updateOperation(
  state: PreviewCoordinatorState,
  kind: PreviewOperationKind,
  operation: PreviewOperationState,
): PreviewCoordinatorState {
  return { ...state, [kind]: operation };
}

function withReceipt(
  state: PreviewCoordinatorState,
  event: PreviewCoordinatorEvent,
  reason: string,
  operationId?: number,
  staleCompletion = false,
): PreviewCoordinatorState {
  const receipt: PreviewTransitionReceipt = {
    event: event.type,
    reason,
    staleCompletion,
    ...(operationId === undefined ? {} : { operationId }),
  };
  return {
    ...state,
    lastTransition: receipt,
  };
}

function cancelActiveOperations(
  state: PreviewCoordinatorState,
  effects: PreviewCoordinatorEffect[],
  reason: string,
  releaseVisibleArtifact = true,
): PreviewCoordinatorState {
  let next = state;
  const releasedUrls = new Set<string>();
  for (const kind of previewOperationKindSchema.options) {
    const operation = operationForKind(next, kind);
    if (operation.identity === undefined || !['queued', 'running'].includes(operation.status)) continue;
    effects.push({ type: 'cancel', identity: operation.identity, reason });
    next = updateOperation(next, kind, { ...operation, status: 'cancelled' });
  }
  if (releaseVisibleArtifact && next.visibleArtifact !== null) {
    effects.push({ type: 'release-url', url: next.visibleArtifact.url, reason });
    releasedUrls.add(next.visibleArtifact.url);
    next = { ...next, visibleArtifact: null };
  }
  if (releaseVisibleArtifact && next.originalArtifact !== null) {
    if (!releasedUrls.has(next.originalArtifact.url)) {
      effects.push({ type: 'release-url', url: next.originalArtifact.url, reason });
    }
    next = { ...next, originalArtifact: null };
  }
  return next;
}

function makeOperationIdentity(
  state: PreviewCoordinatorState,
  session: PreviewSessionIdentity,
  kind: PreviewOperationKind,
): PreviewOperationIdentity {
  return previewOperationIdentitySchema.parse({
    generation: state.interactionGeneration,
    kind,
    operationId: state.nextOperationId,
    session,
  });
}

const editedSchedulingFingerprint = (inputs: PreviewSchedulingInputSnapshot | null): string | null => {
  if (inputs === null || inputs.edited === null) return null;
  const request = inputs.edited.request;
  return JSON.stringify({
    activeWaveformChannel: request.activeWaveformChannel,
    computeWaveform: request.computeWaveform,
    devicePixelRatio: inputs.devicePixelRatio,
    kind: request.kind,
    proof: request.proof,
    quality: request.quality,
    roi: request.roi,
    scopeRecovery: request.scopeRecovery,
    session: fingerprintPreviewSessionIdentity(request.session),
    targetResolution: request.targetResolution,
  });
};

const originalSchedulingFingerprint = (inputs: PreviewSchedulingInputSnapshot | null): string | null => {
  if (inputs === null || inputs.original === null) return null;
  const session = inputs.original.session;
  return JSON.stringify({
    devicePixelRatio: inputs.devicePixelRatio,
    displayHeight: inputs.displayHeight,
    displayWidth: inputs.displayWidth,
    geometryRevision: session.geometryRevision,
    imageSessionId: session.imageSessionId,
    sourceImagePath: session.sourceImagePath,
    sourceRevision: session.sourceRevision,
    targetHeight: session.targetHeight,
    targetWidth: session.targetWidth,
  });
};

const schedulingSession = (inputs: PreviewSchedulingInputSnapshot | null): PreviewSessionIdentity | null =>
  inputs?.edited?.request.session ?? inputs?.original?.session ?? null;

const sameSchedulingSource = (a: PreviewSessionIdentity, b: PreviewSessionIdentity): boolean =>
  a.imageSessionId === b.imageSessionId &&
  a.sourceImagePath === b.sourceImagePath &&
  a.sourceRevision === b.sourceRevision;

const fingerprintInvalidationSource = (session: PreviewSessionIdentity): string =>
  JSON.stringify({
    imageSessionId: session.imageSessionId,
    sourceImagePath: session.sourceImagePath,
    sourceRevision: session.sourceRevision,
  });

const sameInvalidationAuthority = (current: PreviewSessionIdentity, captured: PreviewSessionIdentity): boolean =>
  current.adjustmentRevision === captured.adjustmentRevision &&
  current.backend === captured.backend &&
  current.displayGeneration === captured.displayGeneration &&
  current.geometryRevision === captured.geometryRevision &&
  current.graphRevision === captured.graphRevision &&
  current.imageSessionId === captured.imageSessionId &&
  current.maskRevision === captured.maskRevision &&
  current.patchRevision === captured.patchRevision &&
  current.proofRevision === captured.proofRevision &&
  current.sourceImagePath === captured.sourceImagePath &&
  current.sourceRevision === captured.sourceRevision;

const clearScheduledOriginal = (
  state: PreviewCoordinatorState,
  effects: PreviewCoordinatorEffect[],
  reason: string,
): PreviewCoordinatorState => {
  const original = state.original;
  if (
    original.identity !== undefined &&
    ['queued', 'running'].includes(original.status) &&
    !effects.some(
      (effect) => effect.type === 'cancel' && effect.identity.operationId === original.identity?.operationId,
    )
  ) {
    effects.push({ type: 'cancel', identity: original.identity, reason });
  }
  if (state.originalArtifact !== null && state.originalArtifact.url !== state.visibleArtifact?.url) {
    effects.push({ type: 'release-url', url: state.originalArtifact.url, reason });
  }
  effects.push({ type: 'clear-original', reason });
  return { ...state, original: idleOperation(), originalArtifact: null };
};

export function reducePreviewCoordinator(
  input: PreviewCoordinatorState,
  event: PreviewCoordinatorEvent,
): PreviewCoordinatorTransition {
  let state = input;
  const effects: PreviewCoordinatorEffect[] = [];

  if (event.type === 'invalidation-source-installed') {
    const installedSession = previewSessionIdentitySchema.parse(event.session);
    const scopeRecoveryRequestId = revisionSchema.parse(event.scopeRecoveryRequestId);
    const sourceFingerprint = fingerprintInvalidationSource(installedSession);
    const installed = reducePreviewCoordinator(state, {
      session: installedSession,
      type: 'image-session-installed',
    });
    state = {
      ...installed.state,
      handledScopeRecoveryRequestId:
        sourceFingerprint === state.invalidationSourceFingerprint
          ? state.handledScopeRecoveryRequestId
          : scopeRecoveryRequestId,
      invalidationSourceFingerprint: sourceFingerprint,
    };
    return {
      effects: installed.effects,
      state: withReceipt(state, event, 'invalidation-source-installed'),
    };
  }

  if (event.type === 'preview-invalidation-requested') {
    const invalidation: PreviewInvalidationRequest = {
      ...event.invalidation,
      displayGeneration: positiveRevisionSchema.parse(event.invalidation.displayGeneration),
      requestId: event.invalidation.requestId === null ? null : revisionSchema.parse(event.invalidation.requestId),
      targetResolution: positiveRevisionSchema.parse(event.invalidation.targetResolution),
    };
    const currentSession = state.session;
    if (
      currentSession === null ||
      fingerprintPreviewSessionIdentity(currentSession) !== invalidation.sessionFingerprint
    ) {
      return { effects, state: withReceipt(state, event, 'preview-invalidation-stale') };
    }

    if (invalidation.reason === 'scope-recovery-requested') {
      if (
        invalidation.requestId === null ||
        (state.handledScopeRecoveryRequestId !== null && invalidation.requestId <= state.handledScopeRecoveryRequestId)
      ) {
        return { effects, state: withReceipt(state, event, 'scope-recovery-duplicate') };
      }
      state = { ...state, handledScopeRecoveryRequestId: invalidation.requestId };
    } else {
      if (invalidation.requestId !== null || invalidation.displayGeneration <= state.displayGeneration) {
        return { effects, state: withReceipt(state, event, 'display-generation-stale') };
      }
      const invalidated = reducePreviewCoordinator(state, {
        generation: invalidation.displayGeneration,
        type: 'display-generation-changed',
      });
      state = invalidated.state;
      effects.push(...invalidated.effects);
    }

    effects.push({
      invalidation,
      scopeRecovery: invalidation.reason === 'scope-recovery-requested',
      type: 'capture-invalidation',
    });
    return { effects, state: withReceipt(state, event, 'preview-invalidation-current') };
  }

  if (event.type === 'preview-invalidation-captured') {
    const invalidation = event.invalidation;
    const currentSession = state.session;
    const capturedSession = schedulingSession(event.inputs);
    const displayAdjustedSession =
      currentSession === null ? null : { ...currentSession, displayGeneration: state.displayGeneration };
    const tokenCurrent =
      currentSession !== null &&
      state.displayGeneration === invalidation.displayGeneration &&
      fingerprintPreviewSessionIdentity(currentSession) === invalidation.sessionFingerprint &&
      (invalidation.reason !== 'scope-recovery-requested' ||
        state.handledScopeRecoveryRequestId === invalidation.requestId);
    if (
      !tokenCurrent ||
      capturedSession === null ||
      displayAdjustedSession === null ||
      !sameInvalidationAuthority(displayAdjustedSession, capturedSession)
    ) {
      return { effects, state: withReceipt(state, event, 'captured-invalidation-stale') };
    }
    const scheduled = reducePreviewCoordinator(state, {
      inputs: event.inputs,
      type: 'scheduling-inputs-changed',
    });
    return {
      effects: scheduled.effects,
      state: withReceipt(scheduled.state, event, 'captured-invalidation-scheduled'),
    };
  }

  if (event.type === 'scheduling-inputs-changed') {
    const inputs = event.inputs;
    if (
      !Number.isFinite(inputs.devicePixelRatio) ||
      inputs.devicePixelRatio <= 0 ||
      !Number.isFinite(inputs.displayHeight) ||
      inputs.displayHeight < 0 ||
      !Number.isFinite(inputs.displayWidth) ||
      inputs.displayWidth < 0
    ) {
      throw new Error('preview_coordinator.invalid_scheduling_inputs');
    }
    const previous = state.schedulingInputs;
    const previousSession = schedulingSession(previous);
    const nextSession = schedulingSession(inputs);
    const sourceChanged =
      previousSession !== null && (nextSession === null || !sameSchedulingSource(previousSession, nextSession));
    const geometryChanged =
      previousSession !== null &&
      nextSession !== null &&
      previousSession.geometryRevision !== nextSession.geometryRevision;
    const previousInteraction = previous?.edited?.request.kind === 'interactive';
    const nextInteraction = inputs.edited?.request.kind === 'interactive';
    const interactionStarted = !previousInteraction && nextInteraction;
    const interactionEnded = previousInteraction && !nextInteraction;

    if (!inputs.ready || inputs.edited === null || nextSession === null) {
      const shouldClearOriginal =
        previous?.compareActive === true || state.original.identity !== undefined || state.originalArtifact !== null;
      state = cancelActiveOperations(state, effects, 'preview-inputs-not-ready');
      if (shouldClearOriginal) state = clearScheduledOriginal(state, effects, 'preview-inputs-not-ready');
      state = {
        ...state,
        desired: null,
        interactionActive: false,
        interactive: idleOperation(),
        original: idleOperation(),
        schedulingInputs: inputs,
        session: null,
        settled: idleOperation(),
        viewport: null,
      };
      return { effects, state: withReceipt(state, event, 'preview-inputs-not-ready') };
    }

    if (sourceChanged) {
      state = cancelActiveOperations(state, effects, 'scheduling-source-changed');
      state = clearScheduledOriginal(state, effects, 'scheduling-source-changed');
      state = {
        ...state,
        desired: null,
        interactive: idleOperation(),
        original: idleOperation(),
        session: null,
        settled: idleOperation(),
        viewport: null,
      };
    } else if (geometryChanged || (previous?.compareActive === true && !inputs.compareActive)) {
      state = clearScheduledOriginal(
        state,
        effects,
        geometryChanged ? 'original-geometry-changed' : 'compare-disabled',
      );
    }

    if (interactionStarted || interactionEnded) {
      state = {
        ...state,
        interactionActive: nextInteraction,
        interactionGeneration: state.interactionGeneration + 1,
      };
    }

    const editedChanged =
      sourceChanged ||
      editedSchedulingFingerprint(previous) !== editedSchedulingFingerprint(inputs) ||
      previous?.enableLivePreviews !== inputs.enableLivePreviews;
    if (editedChanged && (!nextInteraction || inputs.enableLivePreviews)) {
      effects.push({
        delayMs: nextInteraction ? 0 : 50,
        prepared: inputs.edited,
        reason: interactionEnded
          ? 'interaction-settled-successor'
          : nextInteraction
            ? 'interactive-inputs-changed'
            : 'settled-inputs-changed',
        type: 'schedule-edited',
      });
    }

    const originalReady =
      inputs.compareActive &&
      !nextInteraction &&
      inputs.displayWidth > 0 &&
      inputs.displayHeight > 0 &&
      inputs.original !== null;
    const originalChanged =
      sourceChanged ||
      geometryChanged ||
      interactionEnded ||
      previous?.compareActive !== inputs.compareActive ||
      originalSchedulingFingerprint(previous) !== originalSchedulingFingerprint(inputs);
    if (originalReady && originalChanged && inputs.original !== null) {
      effects.push({
        delayMs: state.originalArtifact === null ? 0 : 200,
        prepared: inputs.original,
        reason: 'compare-original-inputs-changed',
        type: 'schedule-original',
      });
    }

    state = { ...state, schedulingInputs: inputs };
    return {
      effects,
      state: withReceipt(
        state,
        event,
        editedChanged || (originalReady && originalChanged)
          ? 'scheduling-inputs-applied'
          : 'scheduling-inputs-unchanged',
      ),
    };
  }

  if (event.type === 'image-session-installed') {
    const sessionChanged = state.session !== null && !sameSession(state.session, event.session);
    if (sessionChanged) state = cancelActiveOperations(state, effects, 'image-session-replaced');
    state = {
      ...state,
      session: event.session,
      desired: null,
      displayGeneration: event.session.displayGeneration,
      interactive: sessionChanged ? idleOperation() : state.interactive,
      original: sessionChanged ? idleOperation() : state.original,
      settled: sessionChanged ? idleOperation() : state.settled,
    };
    return {
      effects,
      state: withReceipt(state, event, sessionChanged ? 'session-replaced' : 'session-installed'),
    };
  }

  if (event.type === 'cancel-session') {
    state = cancelActiveOperations(state, effects, event.reason ?? 'session-cancelled');
    state = {
      ...state,
      desired: null,
      handledScopeRecoveryRequestId: null,
      invalidationSourceFingerprint: null,
      interactive: idleOperation(),
      original: idleOperation(),
      schedulingInputs: null,
      settled: idleOperation(),
      session: null,
      viewport: null,
    };
    return { effects, state: withReceipt(state, event, event.reason ?? 'session-cancelled') };
  }

  if (event.type === 'original-preview-cleared') {
    const original = state.original;
    if (original.identity !== undefined && ['queued', 'running'].includes(original.status)) {
      effects.push({ type: 'cancel', identity: original.identity, reason: event.reason });
    }
    if (state.originalArtifact !== null && state.originalArtifact.url !== state.visibleArtifact?.url) {
      effects.push({ type: 'release-url', url: state.originalArtifact.url, reason: event.reason });
    }
    state = { ...state, original: idleOperation(), originalArtifact: null };
    return { effects, state: withReceipt(state, event, event.reason) };
  }

  if (event.type === 'interaction-started') {
    state = {
      ...state,
      interactionActive: true,
      interactionGeneration: state.interactionGeneration + 1,
    };
    return { effects, state: withReceipt(state, event, 'interaction-started') };
  }

  if (event.type === 'interaction-ended') {
    state = { ...state, interactionActive: false, interactionGeneration: state.interactionGeneration + 1 };
    if (event.settledIdentity !== undefined && state.session !== null) {
      const identity = previewOperationIdentitySchema.parse({
        generation: state.interactionGeneration,
        kind: 'settled',
        operationId: state.nextOperationId,
        session: event.settledIdentity,
      });
      state = {
        ...state,
        desired: { identity, reason: 'interaction-ended' },
        nextOperationId: state.nextOperationId + 1,
        settled: { identity, status: 'queued' },
      };
      effects.push({ type: 'start', identity, reason: 'interaction-ended' });
    }
    return { effects, state: withReceipt(state, event, 'interaction-ended') };
  }

  if (event.type === 'display-generation-changed') {
    const displayGeneration = positiveRevisionSchema.parse(event.generation);
    if (displayGeneration <= state.displayGeneration) {
      return { effects, state: withReceipt(state, event, 'display-generation-stale') };
    }
    state = cancelActiveOperations(state, effects, 'display-generation-changed');
    state = {
      ...state,
      desired: null,
      displayGeneration,
      interactive: idleOperation(),
      original: idleOperation(),
      quality: null,
      schedulingInputs: null,
      settled: idleOperation(),
      viewport: null,
    };
    return { effects, state: withReceipt(state, event, 'display-generation-changed') };
  }

  if (event.type === 'viewport-changed') {
    const viewport = event.viewport;
    const unchanged =
      state.viewport?.revision === viewport.revision &&
      state.viewport?.roiFingerprint === viewport.roiFingerprint &&
      state.viewport?.targetHeight === viewport.targetHeight &&
      state.viewport?.targetWidth === viewport.targetWidth;
    if (unchanged) return { effects, state: withReceipt(state, event, 'viewport-unchanged') };
    state = cancelActiveOperations(state, effects, 'viewport-changed', false);
    state = { ...state, desired: null, viewport };
    return { effects, state: withReceipt(state, event, 'viewport-changed') };
  }

  if (event.type === 'quality-decision-changed') {
    return { effects, state: withReceipt({ ...state, quality: event.quality }, event, 'quality-decision-changed') };
  }

  if (event.type === 'render-inputs-changed') {
    const sessionChanged = state.session !== null && !sameSession(state.session, event.identity);
    if (sessionChanged) state = cancelActiveOperations(state, effects, 'render-session-replaced');
    const session = event.identity;
    const kind = event.kind;
    const identity = makeOperationIdentity(
      { ...state, interactionGeneration: state.interactionGeneration + (kind === 'interactive' ? 1 : 0) },
      session,
      kind,
    );
    const previous = operationForKind(state, kind);
    if (previous.identity !== undefined && ['queued', 'running'].includes(previous.status)) {
      effects.push({ type: 'cancel', identity: previous.identity, reason: 'newer-render-inputs' });
    }
    state = {
      ...state,
      session,
      desired: { identity, reason: event.reason ?? 'render-inputs-changed' },
      interactionGeneration: identity.generation,
      nextOperationId: state.nextOperationId + 1,
      [kind]: { identity, status: 'queued' },
    };
    effects.push({ type: 'start', identity, reason: event.reason ?? 'render-inputs-changed' });
    return { effects, state: withReceipt(state, event, 'render-inputs-changed', identity.operationId) };
  }

  if (event.type === 'operation-started') {
    const identity = previewOperationIdentitySchema.parse(event.identity);
    const operation = operationForKind(state, identity.kind);
    if (!sameOperation(operation.identity, identity)) {
      state = { ...state, staleCompletionCount: state.staleCompletionCount + 1 };
      return {
        effects,
        state: withReceipt(state, event, 'stale-operation-start', identity.operationId, true),
      };
    }
    state = updateOperation(state, identity.kind, { identity, status: 'running' });
    return { effects, state: withReceipt(state, event, 'operation-started', identity.operationId) };
  }

  if (event.type === 'operation-completed' || event.type === 'operation-failed') {
    const identity = previewOperationIdentitySchema.parse(event.identity);
    const operation = operationForKind(state, identity.kind);
    const artifactIdentityMatches =
      event.type === 'operation-failed' ||
      event.artifact === undefined ||
      sameOperation(event.artifact.identity, identity);
    if (
      !sameOperation(operation.identity, identity) ||
      !['queued', 'running'].includes(operation.status) ||
      !artifactIdentityMatches ||
      state.session === null ||
      !sameSession(state.session, identity.session)
    ) {
      if (event.type === 'operation-completed' && event.artifact !== undefined) {
        const artifactAlreadyOwned =
          event.artifact.url === state.originalArtifact?.url || event.artifact.url === state.visibleArtifact?.url;
        if (!artifactAlreadyOwned) {
          effects.push({
            type: 'release-url',
            url: event.artifact.url,
            reason: identity.kind === 'original' ? 'stale-original-artifact' : 'artifact-not-presented',
          });
        }
      }
      state = { ...state, staleCompletionCount: state.staleCompletionCount + 1 };
      return {
        effects,
        state: withReceipt(state, event, 'stale-operation-completion', identity.operationId, true),
      };
    }

    if (event.type === 'operation-failed') {
      state = updateOperation(state, identity.kind, { error: event.error, identity, status: 'failed' });
      return { effects, state: withReceipt(state, event, 'operation-failed', identity.operationId) };
    }

    if (identity.kind === 'settled') {
      const interactive = state.interactive;
      if (interactive.identity !== undefined && ['queued', 'running'].includes(interactive.status)) {
        effects.push({
          type: 'cancel',
          identity: interactive.identity,
          reason: 'settled-operation-presented',
        });
        state = updateOperation(state, 'interactive', { ...interactive, status: 'superseded' });
      }
    }
    state = updateOperation(state, identity.kind, { identity, status: 'presented' });
    if (identity.kind === 'original') {
      if (event.artifact !== undefined) {
        const previousUrl = state.originalArtifact?.url;
        if (previousUrl !== undefined && previousUrl !== event.artifact.url) {
          effects.push({ type: 'release-url', url: previousUrl, reason: 'original-artifact-replaced' });
        }
        effects.push({ type: 'publish', artifact: event.artifact, identity, reason: 'operation-presented' });
        state = { ...state, originalArtifact: event.artifact };
      }
      return { effects, state: withReceipt(state, event, 'operation-presented', identity.operationId) };
    }
    const shouldPublish =
      event.artifact !== undefined &&
      identity.kind !== 'analytics' &&
      !(identity.kind === 'interactive' && state.visibleArtifact?.identity.kind === 'settled');
    if (event.artifact !== undefined && !shouldPublish && event.artifact.url !== state.visibleArtifact?.url) {
      effects.push({ type: 'release-url', url: event.artifact.url, reason: 'artifact-not-presented' });
    }
    if (shouldPublish || (event.artifact === undefined && identity.kind !== 'analytics')) {
      effects.push({ type: 'present', identity, reason: 'operation-presented' });
    }
    if (shouldPublish && event.artifact !== undefined) {
      const previousUrl = state.visibleArtifact?.url;
      if (previousUrl !== undefined && previousUrl !== event.artifact.url) {
        effects.push({ type: 'release-url', url: previousUrl, reason: 'artifact-replaced' });
      }
      effects.push({ type: 'publish', artifact: event.artifact, identity, reason: 'operation-presented' });
      state = { ...state, visibleArtifact: event.artifact };
    }
    return { effects, state: withReceipt(state, event, 'operation-presented', identity.operationId) };
  }

  return { effects, state };
}

/**
 * Session-owned façade for the pure reducer and external request bindings.
 * React adapters report events; this object alone owns coordinator state and
 * decides whether a native request still maps to the current typed operation.
 */
export class PreviewCoordinator {
  private requestOperations = new Map<number, PreviewOperationIdentity>();
  private state = createPreviewCoordinatorState();

  dispatch(event: PreviewCoordinatorEvent): PreviewCoordinatorTransition {
    const transition = reducePreviewCoordinator(this.state, event);
    this.state = transition.state;
    const cancelledOperationIds = new Set(
      transition.effects.filter((effect) => effect.type === 'cancel').map((effect) => effect.identity.operationId),
    );
    if (cancelledOperationIds.size > 0) {
      for (const [requestId, identity] of this.requestOperations) {
        if (cancelledOperationIds.has(identity.operationId)) this.requestOperations.delete(requestId);
      }
    }
    return transition;
  }

  bindRequest(requestId: number, identity: PreviewOperationIdentity): boolean {
    const parsedRequestId = positiveRevisionSchema.parse(requestId);
    const parsedIdentity = previewOperationIdentitySchema.parse(identity);
    const operation = operationForKind(this.state, parsedIdentity.kind);
    if (!sameOperation(operation.identity, parsedIdentity) || !['queued', 'running'].includes(operation.status)) {
      return false;
    }
    this.requestOperations.set(parsedRequestId, parsedIdentity);
    return true;
  }

  forgetRequest(requestId: number): void {
    this.requestOperations.delete(requestId);
  }

  operationForRequest(requestId: number): PreviewOperationIdentity | undefined {
    return this.requestOperations.get(requestId);
  }

  snapshot(): Readonly<PreviewCoordinatorState> {
    return this.state;
  }
}
