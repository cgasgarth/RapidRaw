import { ExportColorProfile, ExportRenderingIntent } from '../components/ui/ExportImportProperties';
import type { PreviewQualityDecision } from './adaptivePreviewQuality';
import type { EditedPreviewRequest } from './editedPreviewEffectRunner';
import {
  fingerprintPreviewRoi,
  type PreviewCoordinatorEvent,
  type PreviewOperationIdentity,
  type PreviewQualitySnapshot,
} from './previewCoordinator';
import type { PreviewRequestScopeSnapshot } from './previewRequestScopeAdapter';

export interface PreviewProofRecipeInput {
  blackPointCompensation?: boolean;
  colorProfile?: ExportColorProfile;
  id: string;
  renderingIntent?: ExportRenderingIntent;
}

export interface PreviewRequestIntent {
  activeWaveformChannel: string | null;
  delayMs: number;
  dragging: boolean;
  isWaveformVisible: boolean;
  proofRecipe: PreviewProofRecipeInput | null;
  requestedTargetResolution: number;
  scopeRecovery: boolean;
}

export interface PreviewRequestPendingUpdate {
  previewQualityStatus: PreviewQualityDecision & {
    generation: number;
    phase: 'refining_current_view' | 'rendering_interaction';
    requestId: number;
  };
  requestedPreviewResolution?: number;
}

export interface PreviewRequestIntentAdapterOptions {
  captureScope: (
    targetResolution: number,
    roi: PreviewQualityDecision['effectiveRoi'],
  ) => PreviewRequestScopeSnapshot | null;
  decideQuality: (requestedTargetResolution: number, interacting: boolean) => PreviewQualityDecision;
  dispatch: (event: PreviewCoordinatorEvent) => void;
  installSession: (scope: PreviewRequestScopeSnapshot) => void;
  now?: () => number;
  publish: (update: PreviewRequestPendingUpdate) => void;
  schedule: (request: EditedPreviewRequest, delayMs: number) => PreviewOperationIdentity;
}

/** Converts immutable UI intent into one exact scheduled preview request. */
export class PreviewRequestIntentAdapter {
  private readonly now: () => number;

  constructor(private readonly options: PreviewRequestIntentAdapterOptions) {
    this.now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  }

  request(intent: PreviewRequestIntent): PreviewOperationIdentity | null {
    const requestedTargetResolution = Math.max(1, Math.round(intent.requestedTargetResolution));
    const quality = this.options.decideQuality(requestedTargetResolution, intent.dragging);
    const qualitySnapshot: PreviewQualitySnapshot = {
      effectiveTargetResolution: quality.effectiveTargetResolution,
      interacting: intent.dragging,
      reason: quality.reason,
      requestedTargetResolution: quality.requestedTargetResolution,
      roiFingerprint: fingerprintPreviewRoi(quality.effectiveRoi),
      sufficientForSemanticZoom: quality.sufficientForSemanticZoom,
      tier: quality.tier,
    };
    this.options.dispatch({ quality: qualitySnapshot, type: 'quality-decision-changed' });
    const scope = this.options.captureScope(quality.effectiveTargetResolution, quality.effectiveRoi);
    if (scope === null) return null;
    this.options.installSession(scope);
    const identity = this.options.schedule(
      {
        activeWaveformChannel: intent.activeWaveformChannel,
        computeWaveform: intent.isWaveformVisible || intent.scopeRecovery,
        createdAt: this.now(),
        kind: intent.dragging ? 'interactive' : 'settled',
        proof:
          !intent.dragging && intent.proofRecipe !== null
            ? {
                blackPointCompensation: intent.proofRecipe.blackPointCompensation ?? false,
                colorProfile: intent.proofRecipe.colorProfile ?? ExportColorProfile.Srgb,
                exportSoftProofRecipeId: intent.proofRecipe.id,
                renderingIntent: intent.proofRecipe.renderingIntent ?? ExportRenderingIntent.RelativeColorimetric,
              }
            : null,
        quality,
        roi: scope.roi,
        scopeRecovery: intent.scopeRecovery,
        session: scope.session,
        snapshot: scope.renderSnapshot,
        targetResolution: quality.effectiveTargetResolution,
        viewerScope: scope.scope,
        viewportAuthority: scope.viewport,
      },
      Math.max(0, intent.delayMs),
    );
    this.options.publish({
      ...(!intent.dragging ? { requestedPreviewResolution: quality.requestedTargetResolution } : {}),
      previewQualityStatus: {
        ...quality,
        generation: identity.generation,
        phase: intent.dragging ? 'rendering_interaction' : 'refining_current_view',
        requestId: identity.operationId,
      },
    });
    return identity;
  }
}
