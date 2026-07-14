import { z } from 'zod';
import { AdaptivePreviewQualityController } from './adaptivePreviewQuality';

/** Creates the stateful quality policy owned by preview coordination. */
export const createPreviewQualityPolicy = (): AdaptivePreviewQualityController =>
  new AdaptivePreviewQualityController();

const revisionSchema = z.number().int().nonnegative().safe();
const positiveRevisionSchema = z.number().int().positive().safe();

export const previewOperationKindSchema = z.enum(['interactive', 'settled', 'original', 'analytics']);
export type PreviewOperationKind = z.infer<typeof previewOperationKindSchema>;

export const previewSessionIdentitySchema = z
  .object({
    adjustmentRevision: positiveRevisionSchema,
    backend: z.enum(['cpu', 'wgpu']),
    displayGeneration: positiveRevisionSchema,
    geometryRevision: revisionSchema,
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

export type PreviewRoi = readonly [number, number, number, number] | null;

export function quantizePreviewRoi(roi: PreviewRoi, targetResolution: number): PreviewRoi {
  if (roi === null) return null;
  const resolution = Math.max(1, Math.round(targetResolution));
  return roi.map((value) => Math.round(value * resolution) / resolution) as [number, number, number, number];
}

export function fingerprintPreviewRoi(roi: PreviewRoi): string {
  return JSON.stringify(roi ?? [0, 0, 1, 1]);
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
  lastTransition: PreviewTransitionReceipt | null;
  nextOperationId: number;
  original: PreviewOperationState;
  persistence: PreviewOperationState;
  quality: PreviewQualitySnapshot | null;
  settled: PreviewOperationState;
  session: PreviewSessionIdentity | null;
  staleCompletionCount: number;
  visibleArtifact: PreviewArtifact | null;
  viewport: PreviewViewportSnapshot | null;
}

export type PreviewCoordinatorEffect =
  | { type: 'cancel'; identity: PreviewOperationIdentity; reason: string }
  | { type: 'publish'; artifact: PreviewArtifact; identity: PreviewOperationIdentity; reason: string }
  | { type: 'release-url'; url: string; reason: string }
  | { type: 'start'; identity: PreviewOperationIdentity; reason: string };

export type PreviewCoordinatorEvent =
  | { type: 'cancel-session'; reason?: string }
  | { type: 'display-generation-changed'; generation: number }
  | { type: 'image-session-installed'; session: PreviewSessionIdentity }
  | { type: 'interaction-ended'; settledIdentity?: PreviewSessionIdentity }
  | { type: 'interaction-started' }
  | { type: 'operation-completed'; artifact?: PreviewArtifact; identity: PreviewOperationIdentity }
  | { type: 'operation-failed'; error: string; identity: PreviewOperationIdentity }
  | { type: 'operation-started'; identity: PreviewOperationIdentity }
  | { type: 'quality-decision-changed'; quality: PreviewQualitySnapshot }
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
    lastTransition: null,
    nextOperationId: 1,
    original: idleOperation(),
    persistence: idleOperation(),
    quality: null,
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
): PreviewCoordinatorState {
  let next = state;
  for (const kind of previewOperationKindSchema.options) {
    const operation = operationForKind(next, kind);
    if (operation.identity === undefined || !['queued', 'running'].includes(operation.status)) continue;
    effects.push({ type: 'cancel', identity: operation.identity, reason });
    next = updateOperation(next, kind, { ...operation, status: 'cancelled' });
  }
  if (next.visibleArtifact !== null) {
    effects.push({ type: 'release-url', url: next.visibleArtifact.url, reason });
    next = { ...next, visibleArtifact: null };
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

export function reducePreviewCoordinator(
  input: PreviewCoordinatorState,
  event: PreviewCoordinatorEvent,
): PreviewCoordinatorTransition {
  let state = input;
  const effects: PreviewCoordinatorEffect[] = [];

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
      interactive: idleOperation(),
      original: idleOperation(),
      settled: idleOperation(),
      session: null,
      viewport: null,
    };
    return { effects, state: withReceipt(state, event, event.reason ?? 'session-cancelled') };
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
    state = cancelActiveOperations(state, effects, 'display-generation-changed');
    state = {
      ...state,
      desired: null,
      displayGeneration: positiveRevisionSchema.parse(event.generation),
      interactive: idleOperation(),
      original: idleOperation(),
      quality: null,
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
    state = cancelActiveOperations(state, effects, 'viewport-changed');
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

    state = updateOperation(state, identity.kind, { identity, status: 'presented' });
    const shouldPublish =
      event.artifact !== undefined &&
      identity.kind !== 'analytics' &&
      !(identity.kind === 'interactive' && state.visibleArtifact?.identity.kind === 'settled');
    if (event.artifact !== undefined && !shouldPublish && event.artifact.url !== state.visibleArtifact?.url) {
      effects.push({ type: 'release-url', url: event.artifact.url, reason: 'artifact-not-presented' });
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
