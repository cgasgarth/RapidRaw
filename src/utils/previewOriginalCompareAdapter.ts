import { OriginalPreviewEffectRunner, type OriginalPreviewEffectRunnerOptions } from './originalPreviewEffectRunner';
import type { PreviewCoordinatorEffect, PreviewSchedulingOriginalRequest } from './previewCoordinator';
import type { PreviewRequestScopeSnapshot } from './previewRequestScopeAdapter';

export type OriginalPreviewScopeCapture = (targetResolution: number) => PreviewRequestScopeSnapshot | null;

export interface PreviewOriginalCompareAdapterOptions extends Omit<OriginalPreviewEffectRunnerOptions, 'dispatch'> {
  readonly dispatch: OriginalPreviewEffectRunnerOptions['dispatch'];
}

/** Owns original/compare capture, scheduling effects, timers, and native completion reporting outside React. */
export class PreviewOriginalCompareAdapter {
  private readonly dispatch: OriginalPreviewEffectRunnerOptions['dispatch'];
  private readonly runner: OriginalPreviewEffectRunner;

  constructor(options: PreviewOriginalCompareAdapterOptions) {
    this.dispatch = options.dispatch;
    this.runner = new OriginalPreviewEffectRunner(options);
  }

  capture(
    active: boolean,
    targetResolution: number,
    captureScope: OriginalPreviewScopeCapture,
  ): PreviewSchedulingOriginalRequest | null {
    if (!active) return null;
    const scope = captureScope(targetResolution);
    if (scope === null) return null;
    return {
      request: {
        expectedImagePath: scope.session.sourceImagePath,
        editDocumentV2: structuredClone(scope.renderSnapshot.editDocumentV2),
        targetResolution: scope.session.targetWidth,
        viewerSampleGraphRevision: scope.session.graphRevision,
      },
      session: scope.session,
      viewport: scope.viewport.coordinator,
    };
  }

  consume(effects: readonly PreviewCoordinatorEffect[]): void {
    this.runner.consume(effects);
    for (const effect of effects) {
      if (effect.type !== 'schedule-original') continue;
      this.dispatch({ type: 'viewport-changed', viewport: effect.prepared.viewport });
      this.runner.request(effect.prepared.session, effect.prepared.request, effect.delayMs);
    }
  }

  dispose(): void {
    this.runner.dispose();
  }
}
