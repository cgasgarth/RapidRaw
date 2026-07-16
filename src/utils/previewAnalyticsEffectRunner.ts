import { listen } from '@tauri-apps/api/event';

import type { ChannelConfig } from '../components/adjustments/Curves';
import type { WaveformData } from '../components/ui/AppProperties';
import { type AnalyticsResultPayload, analyticsResultPayloadSchema } from '../schemas/tauriEventSchemas';
import type { ExportSoftProofTransformState, PreviewScopeStatus } from '../store/useEditorStore';
import {
  fingerprintPreviewOperationIdentity,
  type PreviewCoordinatorEffect,
  type PreviewCoordinatorEvent,
  type PreviewCoordinatorTransition,
  type PreviewOperationIdentity,
} from './previewCoordinator';
import type { ReferenceSpatialAnalysis } from './referenceMatch';
import { ANALYTICS_RESULT_EVENT } from './tauriEventNames';

type PreviewCoordinatorDispatch = (event: PreviewCoordinatorEvent) => PreviewCoordinatorTransition;
type AnalyticsSubscribe = (onPayload: (payload: unknown) => void) => Promise<() => void>;

export interface PreviewAnalyticsPresentationState {
  readonly exportSoftProofTransform: ExportSoftProofTransformState | null;
  readonly isExportSoftProofEnabled: boolean;
  readonly selectedImagePath: string | null;
}

export interface PreviewAnalyticsUpdate {
  histogram?: ChannelConfig | null;
  previewScopeRecoveryError?: string | null;
  previewScopeRecoveryState?: 'error' | 'idle';
  previewScopeStatus?: PreviewScopeStatus | null;
  referenceMatchSpatialAnalysis?: ReferenceSpatialAnalysis | null;
  waveform?: WaveformData | null;
}

export interface PreviewAnalyticsEffectRunnerOptions {
  readonly analyticsTimeoutMs?: number;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly dispatch: PreviewCoordinatorDispatch;
  readonly now?: () => Date;
  readonly publish: (update: PreviewAnalyticsUpdate) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly subscribe?: AnalyticsSubscribe;
}

const subscribeAnalytics = async (onPayload: (payload: unknown) => void): Promise<() => void> =>
  listen<unknown>(ANALYTICS_RESULT_EVENT, (event) => onPayload(event.payload));

const clearUpdate = (): PreviewAnalyticsUpdate => ({
  histogram: null,
  previewScopeRecoveryError: null,
  previewScopeRecoveryState: 'idle',
  previewScopeStatus: null,
  referenceMatchSpatialAnalysis: null,
  waveform: null,
});

const ANALYTICS_ADVANCED_SCOPE_PRODUCTS = (1 << 2) | (1 << 3) | (1 << 4);

/** Owns analytics listener lifetime, exact artifact presentation binding, and coordinator publication effects. */
export class PreviewAnalyticsEffectRunner {
  private active = false;
  private epoch = 0;
  private nextReceiptId = 1;
  private presentedIdentity: string | null = null;
  private readonly awaitingPresentation = new Map<number, string>();
  private readonly pending = new Map<number, AnalyticsResultPayload>();
  private readonly presentations = new Map<string, PreviewAnalyticsPresentationState>();
  private readonly subscribe: AnalyticsSubscribe;
  private readonly timeoutMs: number;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unlisten: (() => void) | null = null;

  constructor(private readonly options: PreviewAnalyticsEffectRunnerOptions) {
    this.subscribe = options.subscribe ?? subscribeAnalytics;
    this.timeoutMs = options.analyticsTimeoutMs ?? 15_000;
  }

  consume(effects: readonly PreviewCoordinatorEffect[]): void {
    const publishedReceiptIds = new Set(
      effects.filter((effect) => effect.type === 'publish-analytics').map((effect) => effect.receiptId),
    );
    for (const effect of effects) {
      if (effect.type === 'present' && effect.identity.kind !== 'original') {
        this.presentedIdentity = fingerprintPreviewOperationIdentity(effect.identity);
        this.presentations.clear();
      } else if (effect.type === 'publish-analytics') {
        const result = this.pending.get(effect.receiptId);
        const identity = fingerprintPreviewOperationIdentity(effect.identity);
        const presentation = this.presentations.get(identity);
        if (result !== undefined && presentation !== undefined) {
          this.pending.delete(effect.receiptId);
          this.publishResult(result, presentation);
        } else if (result !== undefined) {
          this.awaitingPresentation.set(effect.receiptId, identity);
        }
      } else if (effect.type === 'discard-analytics') {
        this.pending.delete(effect.receiptId);
        this.awaitingPresentation.delete(effect.receiptId);
      } else if (effect.type === 'clear-analytics') {
        this.clearTimers();
        for (const receiptId of this.pending.keys()) {
          if (!publishedReceiptIds.has(receiptId)) this.pending.delete(receiptId);
        }
        for (const receiptId of this.awaitingPresentation.keys()) {
          if (!publishedReceiptIds.has(receiptId)) this.awaitingPresentation.delete(receiptId);
        }
        this.presentedIdentity = null;
        this.presentations.clear();
        this.options.publish(clearUpdate());
      }
    }
  }

  bindPresentation(identity: PreviewOperationIdentity, presentation: PreviewAnalyticsPresentationState): boolean {
    const fingerprint = fingerprintPreviewOperationIdentity(identity);
    if (fingerprint !== this.presentedIdentity) return false;
    const capturedPresentation = structuredClone(presentation);
    this.presentations.clear();
    this.presentations.set(fingerprint, capturedPresentation);
    this.armTimeout(fingerprint, capturedPresentation);
    for (const [receiptId, awaitingIdentity] of this.awaitingPresentation) {
      if (awaitingIdentity !== fingerprint) continue;
      const result = this.pending.get(receiptId);
      this.awaitingPresentation.delete(receiptId);
      this.pending.delete(receiptId);
      if (result !== undefined) {
        this.clearTimeout(fingerprint);
        this.publishResult(result, capturedPresentation);
      }
    }
    return true;
  }

  start(): Promise<void> {
    if (this.active) return Promise.resolve();
    this.active = true;
    const epoch = ++this.epoch;
    return this.subscribe((payload) => {
      if (!this.active || epoch !== this.epoch) return;
      const parsed = analyticsResultPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const receiptId = this.nextReceiptId++;
      this.pending.set(receiptId, parsed.data);
      this.options.dispatch({
        identity: parsed.data.previewOperationIdentity,
        receiptId,
        type: 'analytics-result-received',
      });
    }).then((unlisten) => {
      if (!this.active || epoch !== this.epoch) {
        unlisten();
        return;
      }
      this.unlisten = unlisten;
    });
  }

  stop(): void {
    this.active = false;
    this.epoch += 1;
    this.unlisten?.();
    this.unlisten = null;
    this.pending.clear();
    this.awaitingPresentation.clear();
    this.clearTimers();
    this.presentedIdentity = null;
    this.presentations.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private publishResult(result: AnalyticsResultPayload, presentation: PreviewAnalyticsPresentationState): void {
    if (presentation.selectedImagePath !== result.path) return;
    this.clearTimeout(fingerprintPreviewOperationIdentity(result.previewOperationIdentity));
    const histogram: ChannelConfig | null = result.histogram
      ? {
          blue: { color: '#3b82f6', data: result.histogram.blue },
          green: { color: '#22c55e', data: result.histogram.green },
          luma: { color: '#ffffff', data: result.histogram.luma },
          red: { color: '#ef4444', data: result.histogram.red },
        }
      : null;
    const scopes = result.scopes;
    const scopesComplete =
      scopes !== null &&
      scopes.luma !== null &&
      scopes.parade !== null &&
      scopes.rgb !== null &&
      scopes.vectorscope !== null;
    const waveform: WaveformData | null = scopesComplete
      ? {
          blue: '',
          green: '',
          height: scopes.height,
          luma: scopes.luma?.url ?? '',
          parade: scopes.parade?.url ?? '',
          red: '',
          rgb: scopes.rgb?.url ?? '',
          vectorscope: scopes.vectorscope?.url ?? '',
          width: scopes.width,
        }
      : null;
    const transform = presentation.exportSoftProofTransform;
    const exportPreview = presentation.isExportSoftProofEnabled && transform !== null;
    const histogramComplete =
      result.histogram !== null &&
      result.histogram.blue.length > 0 &&
      result.histogram.green.length > 0 &&
      result.histogram.luma.length > 0 &&
      result.histogram.red.length > 0;
    const advancedScopesRequested = (result.requestedProducts & ANALYTICS_ADVANCED_SCOPE_PRODUCTS) !== 0;
    const terminalError = !histogramComplete
      ? 'Analytics completed without a nonempty histogram.'
      : advancedScopesRequested && !scopesComplete
        ? 'Analytics completed without all current preview scopes.'
        : null;
    this.options.publish({
      histogram,
      previewScopeRecoveryError: terminalError,
      previewScopeRecoveryState: terminalError === null ? 'idle' : 'error',
      previewScopeStatus: {
        displayTransformLabel: transform?.colorManagedTransform ?? 'Display preview transform',
        exportProfileLabel: exportPreview ? transform.effectiveColorProfile : null,
        exportRenderingIntentLabel: exportPreview ? transform.effectiveRenderingIntent : null,
        histogramReady: histogramComplete,
        path: result.path,
        renderBasis: exportPreview ? 'export_preview' : 'editor_preview',
        softProofTransformApplied: transform?.transformApplied ?? false,
        sourceLabel: exportPreview ? 'Export preview' : 'Edited preview',
        updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
        waveformReady: scopesComplete,
        warningCodes: [
          ...(terminalError === null
            ? []
            : [
                histogramComplete
                  ? 'preview_scope_error:incomplete_advanced_scopes_receipt'
                  : 'preview_scope_error:incomplete_histogram_receipt',
              ]),
          ...(exportPreview
            ? [
                transform.transformApplied ? 'export_profile_transform_applied' : 'export_profile_transform_missing',
                'render_target_matches_export_recipe',
              ]
            : []),
        ],
        workingTransformLabel: 'Working RGB',
      },
      referenceMatchSpatialAnalysis: result.spatial
        ? {
            ...result.spatial,
            frameId: result.frameId,
            path: result.path,
            previewOperationIdentity: result.previewOperationIdentity,
          }
        : null,
      waveform,
    });
  }

  private armTimeout(identity: string, presentation: PreviewAnalyticsPresentationState): void {
    this.clearTimers();
    const setTimer = this.options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    const timer = setTimer(() => {
      this.timers.delete(identity);
      if (!this.active || this.presentedIdentity !== identity) return;
      const path = presentation.selectedImagePath;
      if (path === null) return;
      const message = 'Current preview analytics did not reach a terminal receipt.';
      this.options.publish({
        histogram: null,
        previewScopeRecoveryError: message,
        previewScopeRecoveryState: 'error',
        previewScopeStatus: {
          displayTransformLabel:
            presentation.exportSoftProofTransform?.colorManagedTransform ?? 'Display preview transform',
          exportProfileLabel: null,
          exportRenderingIntentLabel: null,
          histogramReady: false,
          path,
          renderBasis: 'editor_preview',
          softProofTransformApplied: false,
          sourceLabel: 'Edited preview',
          updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
          waveformReady: false,
          warningCodes: ['preview_scope_error:analytics_timeout'],
          workingTransformLabel: 'Working RGB',
        },
        referenceMatchSpatialAnalysis: null,
        waveform: null,
      });
    }, this.timeoutMs);
    this.timers.set(identity, timer);
  }

  private clearTimeout(identity: string): void {
    const timer = this.timers.get(identity);
    if (timer === undefined) return;
    (this.options.clearTimer ?? ((value) => globalThis.clearTimeout(value)))(timer);
    this.timers.delete(identity);
  }

  private clearTimers(): void {
    for (const identity of this.timers.keys()) this.clearTimeout(identity);
  }
}
