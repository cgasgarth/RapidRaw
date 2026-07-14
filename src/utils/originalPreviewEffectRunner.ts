import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';

import { Invokes } from '../tauri/commands';
import type { Adjustments } from './adjustments';
import {
  fingerprintPreviewSessionIdentity,
  type PreviewCoordinatorEffect,
  type PreviewCoordinatorEvent,
  type PreviewCoordinatorTransition,
  type PreviewOperationIdentity,
  type PreviewSessionIdentity,
} from './previewCoordinator';

export interface OriginalPreviewRequest {
  expectedImagePath: string;
  jsAdjustments: Adjustments;
  targetResolution: number;
  viewerSampleGraphRevision: string;
}

export type OriginalPreviewExecutor = (request: OriginalPreviewRequest) => Promise<string>;
export type PreviewCoordinatorDispatch = (event: PreviewCoordinatorEvent) => PreviewCoordinatorTransition;
type OriginalPreviewClearTimer = (timer: ReturnType<typeof setTimeout>) => void;
type OriginalPreviewSetTimer = (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;

interface ScheduledOriginalPreview {
  identity: PreviewOperationIdentity;
  request: OriginalPreviewRequest;
  timer: ReturnType<typeof setTimeout> | null;
  token: number;
}

export interface OriginalPreviewEffectRunnerOptions {
  clearTimer?: OriginalPreviewClearTimer;
  dispatch: PreviewCoordinatorDispatch;
  execute?: OriginalPreviewExecutor;
  onCurrentFailure?: (error: unknown) => void;
  onPresented?: (request: OriginalPreviewRequest) => void;
  setTimer?: OriginalPreviewSetTimer;
}

const originalPreviewDataUrlSchema = z.string().startsWith('data:image/');

export const executeOriginalPreview: OriginalPreviewExecutor = async (request) => {
  const result = await invoke<unknown>(Invokes.GenerateOriginalTransformedPreview, {
    expectedImagePath: request.expectedImagePath,
    jsAdjustments: request.jsAdjustments,
    targetResolution: request.targetResolution,
    viewerSampleGraphRevision: request.viewerSampleGraphRevision,
  });
  return originalPreviewDataUrlSchema.parse(result);
};

/**
 * Owns original/compare preview timers and async effects for one editor session.
 * The PreviewCoordinator remains the sole publication/currentness authority.
 */
export class OriginalPreviewEffectRunner {
  private active: ScheduledOriginalPreview | null = null;
  private readonly clearTimer: OriginalPreviewClearTimer;
  private readonly dispatch: PreviewCoordinatorDispatch;
  private readonly execute: OriginalPreviewExecutor;
  private readonly onCurrentFailure: (error: unknown) => void;
  private readonly onPresented: (request: OriginalPreviewRequest) => void;
  private readonly setTimer: OriginalPreviewSetTimer;
  private nextToken = 1;
  private presented: { resolution: number; sessionFingerprint: string } | null = null;

  constructor(options: OriginalPreviewEffectRunnerOptions) {
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
    this.dispatch = options.dispatch;
    this.execute = options.execute ?? executeOriginalPreview;
    this.onCurrentFailure = options.onCurrentFailure ?? (() => {});
    this.onPresented = options.onPresented ?? (() => {});
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  }

  request(session: PreviewSessionIdentity, request: OriginalPreviewRequest, delayMs = 0): PreviewOperationIdentity {
    if (
      request.expectedImagePath !== session.sourceImagePath ||
      request.viewerSampleGraphRevision !== session.graphRevision ||
      request.targetResolution !== session.targetWidth ||
      request.targetResolution !== session.targetHeight
    ) {
      throw new Error('Original preview request does not match its typed session identity.');
    }
    const transition = this.dispatch({
      identity: session,
      kind: 'original',
      reason: 'original-preview-requested',
      type: 'render-inputs-changed',
    });
    this.consume(transition.effects);
    const identity = transition.state.original.identity;
    if (identity === undefined) throw new Error('PreviewCoordinator did not create an original preview operation.');

    const token = this.nextToken++;
    const scheduled: ScheduledOriginalPreview = { identity, request, timer: null, token };
    this.active = scheduled;
    scheduled.timer = this.setTimer(
      () => {
        scheduled.timer = null;
        void this.executeScheduled(scheduled);
      },
      Math.max(0, delayMs),
    );
    return identity;
  }

  needsRequest(session: PreviewSessionIdentity, targetResolution: number): boolean {
    return (
      this.presented === null ||
      this.presented.sessionFingerprint !== fingerprintPreviewSessionIdentity(session) ||
      this.presented.resolution < targetResolution
    );
  }

  cancel(reason: string): void {
    const transition = this.dispatch({ reason, type: 'original-preview-cleared' });
    this.consume(transition.effects);
    this.cancelActive();
    this.presented = null;
  }

  consume(effects: readonly PreviewCoordinatorEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'cancel' && effect.identity.kind === 'original') this.cancelIdentity(effect.identity);
    }
  }

  dispose(): void {
    this.cancel('editor-unmounted');
  }

  private cancelActive(): void {
    if (this.active?.timer !== null && this.active?.timer !== undefined) this.clearTimer(this.active.timer);
    this.active = null;
  }

  private cancelIdentity(identity: PreviewOperationIdentity): void {
    if (this.active?.identity.operationId !== identity.operationId) return;
    this.cancelActive();
  }

  private async executeScheduled(scheduled: ScheduledOriginalPreview): Promise<void> {
    this.dispatch({ identity: scheduled.identity, type: 'operation-started' });
    try {
      const url = await this.execute(scheduled.request);
      const transition = this.dispatch({
        artifact: { identity: scheduled.identity, url },
        identity: scheduled.identity,
        type: 'operation-completed',
      });
      if (transition.state.lastTransition?.staleCompletion !== true) {
        this.presented = {
          resolution: scheduled.request.targetResolution,
          sessionFingerprint: fingerprintPreviewSessionIdentity(scheduled.identity.session),
        };
        this.onPresented(scheduled.request);
      }
    } catch (error) {
      const transition = this.dispatch({
        error: String(error),
        identity: scheduled.identity,
        type: 'operation-failed',
      });
      if (transition.state.lastTransition?.staleCompletion !== true) this.onCurrentFailure(error);
    } finally {
      if (this.active?.token === scheduled.token) this.active = null;
    }
  }
}
