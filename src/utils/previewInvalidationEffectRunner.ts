import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';

import { displayTargetChangePayloadSchema } from '../schemas/tauriEventSchemas';
import {
  fingerprintPreviewSessionIdentity,
  type PreviewCoordinatorEffect,
  type PreviewCoordinatorEvent,
  type PreviewCoordinatorState,
  type PreviewCoordinatorTransition,
  type PreviewInvalidationRequest,
  type PreviewSchedulingInputSnapshot,
  type PreviewSessionIdentity,
  previewSessionIdentitySchema,
} from './previewCoordinator';
import { DISPLAY_TARGET_CHANGED_EVENT } from './tauriEventNames';

const requestIdSchema = z.number().int().nonnegative().safe();
const displayGenerationSchema = z.number().int().positive().safe();
const targetResolutionSchema = z.number().int().positive().safe();

type PreviewCoordinatorDispatch = (event: PreviewCoordinatorEvent) => PreviewCoordinatorTransition;
type DisplayTargetSubscribe = (onPayload: (payload: unknown) => void) => Promise<() => void>;

export interface PreviewInvalidationSource {
  readonly capture: (scopeRecovery: boolean, targetResolution: number) => PreviewSchedulingInputSnapshot;
  readonly scopeRecoveryRequestId: number;
  readonly targetResolution: number;
}

export interface PreviewInvalidationEffectRunnerOptions {
  readonly dispatch: PreviewCoordinatorDispatch;
  readonly getState: () => Readonly<PreviewCoordinatorState>;
  readonly subscribeDisplayTarget?: DisplayTargetSubscribe;
}

const subscribeDisplayTarget = async (onPayload: (payload: unknown) => void): Promise<() => void> =>
  listen<unknown>(DISPLAY_TARGET_CHANGED_EVENT, (event) => onPayload(event.payload));

/** Owns invalidation event currentness, capture effects, and display-listener lifetime outside React. */
export class PreviewInvalidationEffectRunner {
  private active = false;
  private listenerEpoch = 0;
  private source: PreviewInvalidationSource | null = null;
  private unlisten: (() => void) | null = null;
  private readonly subscribeDisplayTarget: DisplayTargetSubscribe;

  constructor(private readonly options: PreviewInvalidationEffectRunnerOptions) {
    this.subscribeDisplayTarget = options.subscribeDisplayTarget ?? subscribeDisplayTarget;
  }

  consume(effects: readonly PreviewCoordinatorEffect[]): void {
    for (const effect of effects) {
      if (effect.type !== 'capture-invalidation') continue;
      const source = this.source;
      if (!this.active || source === null) continue;
      const inputs = source.capture(effect.scopeRecovery, effect.invalidation.targetResolution);
      this.options.dispatch({ inputs, invalidation: effect.invalidation, type: 'preview-invalidation-captured' });
    }
  }

  installSession(session: PreviewSessionIdentity, scopeRecoveryRequestId: number): PreviewCoordinatorTransition {
    return this.options.dispatch({
      scopeRecoveryRequestId: requestIdSchema.parse(scopeRecoveryRequestId),
      session: previewSessionIdentitySchema.parse(session),
      type: 'invalidation-source-installed',
    });
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    const epoch = ++this.listenerEpoch;
    void this.subscribeDisplayTarget((payload) => {
      if (this.active && epoch === this.listenerEpoch) this.onDisplayTargetPayload(payload);
    })
      .then((unlisten) => {
        if (!this.active || epoch !== this.listenerEpoch) {
          unlisten();
          return;
        }
        this.unlisten = unlisten;
      })
      .catch(() => undefined);
  }

  stop(reason: string): PreviewCoordinatorTransition {
    this.active = false;
    this.listenerEpoch += 1;
    this.unlisten?.();
    this.unlisten = null;
    this.source = null;
    return this.options.dispatch({ reason, type: 'cancel-session' });
  }

  updateSource(source: PreviewInvalidationSource): void {
    this.source = {
      capture: source.capture,
      scopeRecoveryRequestId: requestIdSchema.parse(source.scopeRecoveryRequestId),
      targetResolution: targetResolutionSchema.parse(source.targetResolution),
    };
    this.requestInvalidation('scope-recovery-requested', this.source.scopeRecoveryRequestId);
  }

  private onDisplayTargetPayload(payload: unknown): void {
    if (!this.active) return;
    const parsed = displayTargetChangePayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    const generation = displayGenerationSchema.safeParse(parsed.data.displayResourceGeneration);
    if (!generation.success) return;
    this.requestInvalidation('display-generation-changed', generation.data);
  }

  private requestInvalidation(reason: PreviewInvalidationRequest['reason'], requestIdOrGeneration: number): void {
    const source = this.source;
    const session = this.options.getState().session;
    if (!this.active || source === null || session === null) return;
    const invalidation: PreviewInvalidationRequest = {
      displayGeneration:
        reason === 'display-generation-changed' ? requestIdOrGeneration : this.options.getState().displayGeneration,
      reason,
      requestId: reason === 'scope-recovery-requested' ? requestIdOrGeneration : null,
      sessionFingerprint: fingerprintPreviewSessionIdentity(session),
      targetResolution: source.targetResolution,
    };
    this.options.dispatch({ invalidation, type: 'preview-invalidation-requested' });
  }
}
