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
  previewScopeRecoveryState?: 'idle';
  previewScopeStatus?: PreviewScopeStatus | null;
  referenceMatchSpatialAnalysis?: ReferenceSpatialAnalysis | null;
  waveform?: WaveformData | null;
}

export interface PreviewAnalyticsEffectRunnerOptions {
  readonly dispatch: PreviewCoordinatorDispatch;
  readonly getPresentationState: () => PreviewAnalyticsPresentationState;
  readonly now?: () => Date;
  readonly publish: (update: PreviewAnalyticsUpdate) => void;
  readonly subscribe?: AnalyticsSubscribe;
}

const subscribeAnalytics = async (onPayload: (payload: unknown) => void): Promise<() => void> =>
  listen<unknown>(ANALYTICS_RESULT_EVENT, (event) => onPayload(event.payload));

const clearUpdate = (): PreviewAnalyticsUpdate => ({
  histogram: null,
  previewScopeStatus: null,
  referenceMatchSpatialAnalysis: null,
  waveform: null,
});

/** Owns native analytics listener lifetime and executes coordinator publication decisions. */
export class PreviewAnalyticsEffectRunner {
  private active = false;
  private epoch = 0;
  private nextReceiptId = 1;
  private readonly pending = new Map<number, AnalyticsResultPayload>();
  private readonly presentations = new Map<string, PreviewAnalyticsPresentationState>();
  private readonly subscribe: AnalyticsSubscribe;
  private unlisten: (() => void) | null = null;

  constructor(private readonly options: PreviewAnalyticsEffectRunnerOptions) {
    this.subscribe = options.subscribe ?? subscribeAnalytics;
  }

  consume(effects: readonly PreviewCoordinatorEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'publish' && effect.identity.kind !== 'original') {
        this.presentations.clear();
        this.presentations.set(
          fingerprintPreviewOperationIdentity(effect.identity),
          structuredClone(this.options.getPresentationState()),
        );
      } else if (effect.type === 'publish-analytics') {
        const result = this.pending.get(effect.receiptId);
        this.pending.delete(effect.receiptId);
        const presentation = this.presentations.get(fingerprintPreviewOperationIdentity(effect.identity));
        if (result !== undefined && presentation !== undefined) this.publishResult(result, presentation);
      } else if (effect.type === 'discard-analytics') {
        this.pending.delete(effect.receiptId);
      } else if (effect.type === 'clear-analytics') {
        this.pending.clear();
        this.presentations.clear();
        this.options.publish(clearUpdate());
      }
    }
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
    this.presentations.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private publishResult(result: AnalyticsResultPayload, presentation: PreviewAnalyticsPresentationState): void {
    if (presentation.selectedImagePath !== result.path) return;
    const histogram: ChannelConfig | null = result.histogram
      ? {
          blue: { color: '#3b82f6', data: result.histogram.blue },
          green: { color: '#22c55e', data: result.histogram.green },
          luma: { color: '#ffffff', data: result.histogram.luma },
          red: { color: '#ef4444', data: result.histogram.red },
        }
      : null;
    const scopes = result.scopes;
    const waveform: WaveformData | null = scopes
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
    this.options.publish({
      histogram,
      previewScopeRecoveryState: 'idle',
      previewScopeStatus: {
        displayTransformLabel: transform?.colorManagedTransform ?? 'Display preview transform',
        exportProfileLabel: exportPreview ? transform.effectiveColorProfile : null,
        exportRenderingIntentLabel: exportPreview ? transform.effectiveRenderingIntent : null,
        histogramReady: histogram !== null,
        path: result.path,
        renderBasis: exportPreview ? 'export_preview' : 'editor_preview',
        softProofTransformApplied: transform?.transformApplied ?? false,
        sourceLabel: exportPreview ? 'Export preview' : 'Edited preview',
        updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
        waveformReady: waveform !== null,
        warningCodes: exportPreview
          ? [
              transform.transformApplied ? 'export_profile_transform_applied' : 'export_profile_transform_missing',
              'render_target_matches_export_recipe',
            ]
          : [],
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
}
