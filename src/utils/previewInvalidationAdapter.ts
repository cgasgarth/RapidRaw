import { z } from 'zod';

import {
  fingerprintPreviewSessionIdentity,
  type PreviewCoordinatorEvent,
  type PreviewCoordinatorState,
  type PreviewCoordinatorTransition,
  type PreviewSessionIdentity,
  previewSessionIdentitySchema,
} from './previewCoordinator';

const requestIdSchema = z.number().int().nonnegative().safe();
const displayGenerationSchema = z.number().int().positive().safe();

type PreviewCoordinatorDispatch = (event: PreviewCoordinatorEvent) => PreviewCoordinatorTransition;

export interface PreviewInvalidationToken {
  displayGeneration: number;
  reason: 'display-generation-changed' | 'scope-recovery-requested';
  requestId: number | null;
  sessionFingerprint: string;
}

export interface PreviewInvalidationAdapterOptions {
  dispatch: PreviewCoordinatorDispatch;
  getState: () => Readonly<PreviewCoordinatorState>;
}

const sourceSessionFingerprint = (session: PreviewSessionIdentity): string =>
  JSON.stringify({
    imageSessionId: session.imageSessionId,
    sourceImagePath: session.sourceImagePath,
    sourceRevision: session.sourceRevision,
  });

/** Owns frontend invalidation currentness without React render-updated refs. */
export class PreviewInvalidationAdapter {
  private handledScopeRecoveryRequestId: number | null = null;
  private sourceSession: string | null = null;

  constructor(private readonly options: PreviewInvalidationAdapterOptions) {}

  cancelSession(reason: string): PreviewCoordinatorTransition {
    this.handledScopeRecoveryRequestId = null;
    this.sourceSession = null;
    return this.options.dispatch({ reason, type: 'cancel-session' });
  }

  consume(token: PreviewInvalidationToken, render: (scopeRecovery: boolean) => void): boolean {
    const state = this.options.getState();
    const session = state.session;
    if (
      session === null ||
      state.displayGeneration !== token.displayGeneration ||
      fingerprintPreviewSessionIdentity(session) !== token.sessionFingerprint ||
      (token.reason === 'scope-recovery-requested' && token.requestId !== this.handledScopeRecoveryRequestId)
    ) {
      return false;
    }
    render(token.reason === 'scope-recovery-requested');
    return true;
  }

  displayTargetChanged(generation: number): PreviewInvalidationToken | null {
    const parsedGeneration = displayGenerationSchema.parse(generation);
    const session = this.options.getState().session;
    if (session === null) return null;
    const transition = this.options.dispatch({
      generation: parsedGeneration,
      type: 'display-generation-changed',
    });
    if (transition.state.lastTransition?.reason !== 'display-generation-changed') return null;
    return {
      displayGeneration: parsedGeneration,
      reason: 'display-generation-changed',
      requestId: null,
      sessionFingerprint: fingerprintPreviewSessionIdentity(session),
    };
  }

  installSession(session: PreviewSessionIdentity, scopeRecoveryRequestId: number): PreviewCoordinatorTransition {
    const parsedSession = previewSessionIdentitySchema.parse(session);
    const parsedRequestId = requestIdSchema.parse(scopeRecoveryRequestId);
    const sourceSession = sourceSessionFingerprint(parsedSession);
    if (sourceSession !== this.sourceSession) {
      this.sourceSession = sourceSession;
      this.handledScopeRecoveryRequestId = parsedRequestId;
    }
    return this.options.dispatch({ session: parsedSession, type: 'image-session-installed' });
  }

  requestScopeRecovery(requestId: number): PreviewInvalidationToken | null {
    const parsedRequestId = requestIdSchema.parse(requestId);
    const state = this.options.getState();
    const session = state.session;
    if (session === null) return null;
    const sourceSession = sourceSessionFingerprint(session);
    if (sourceSession !== this.sourceSession) {
      this.sourceSession = sourceSession;
      this.handledScopeRecoveryRequestId = parsedRequestId;
      return null;
    }
    if (this.handledScopeRecoveryRequestId !== null && parsedRequestId <= this.handledScopeRecoveryRequestId) {
      return null;
    }
    this.handledScopeRecoveryRequestId = parsedRequestId;
    return {
      displayGeneration: state.displayGeneration,
      reason: 'scope-recovery-requested',
      requestId: parsedRequestId,
      sessionFingerprint: fingerprintPreviewSessionIdentity(session),
    };
  }
}
