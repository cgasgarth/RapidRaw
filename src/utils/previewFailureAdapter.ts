import type { PreviewScopeRecoveryState } from '../store/useEditorStore';
import type { PreviewQualityDecision, PreviewQualityStatus } from './adaptivePreviewQuality';
import type { InteractivePreviewIdentity } from './interactivePreviewPatch';
import {
  fingerprintPreviewOperationIdentity,
  type PreviewCoordinatorState,
  type PreviewOperationIdentity,
} from './previewCoordinator';

export interface PreviewFailureContext {
  identity: PreviewOperationIdentity;
  interactiveIdentity: InteractivePreviewIdentity;
  quality: PreviewQualityDecision;
  scopeRecovery: boolean;
}

export interface PreviewFailureUpdate {
  previewQualityStatus: PreviewQualityStatus;
  previewScopeRecoveryError?: string;
  previewScopeRecoveryState?: PreviewScopeRecoveryState;
}

export interface PreviewFailureAdapterOptions {
  getCoordinatorState: () => Readonly<PreviewCoordinatorState>;
  publish: (update: PreviewFailureUpdate) => void;
  reportError?: (error: unknown) => void;
}

/** Publishes each exact-current render failure once and keeps supersession silent. */
export class PreviewFailureAdapter {
  private readonly published = new Set<string>();
  private readonly reportError: (error: unknown) => void;

  constructor(private readonly options: PreviewFailureAdapterOptions) {
    this.reportError = options.reportError ?? ((error) => console.error('Failed to apply adjustments:', error));
  }

  fail(error: unknown, context: PreviewFailureContext): boolean {
    if (String(error).includes('preview_superseded')) return false;
    const state = this.options.getCoordinatorState();
    const operation = state[context.identity.kind];
    const fingerprint = fingerprintPreviewOperationIdentity(context.identity);
    if (
      operation.status !== 'failed' ||
      operation.identity === undefined ||
      fingerprintPreviewOperationIdentity(operation.identity) !== fingerprint ||
      this.published.has(fingerprint)
    ) {
      return false;
    }

    this.published.add(fingerprint);
    while (this.published.size > 16) {
      const oldest = this.published.values().next().value;
      if (oldest === undefined) break;
      this.published.delete(oldest);
    }
    const message = error instanceof Error ? error.message : String(error);
    this.reportError(error);
    this.options.publish({
      previewQualityStatus: {
        ...context.quality,
        generation: context.interactiveIdentity.generation,
        limitedBy: 'error',
        phase: 'degraded_limited',
        reason: 'render_error',
        requestId: context.identity.operationId,
        sufficientForSemanticZoom: false,
      },
      ...(context.scopeRecovery
        ? {
            previewScopeRecoveryError: message,
            previewScopeRecoveryState: 'error' as const,
          }
        : {}),
    });
    return true;
  }
}
