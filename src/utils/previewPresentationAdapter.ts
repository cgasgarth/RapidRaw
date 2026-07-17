import type {
  ExportSoftProofTransformState,
  InteractivePatch,
  NavigatorPreviewArtifact,
  PreviewScopeStatus,
} from '../store/useEditorStore';
import {
  getPreviewReadyPhase,
  type PreviewQualityDecision,
  type PreviewQualityStatus,
  type PreviewTimingSample,
} from './adaptivePreviewQuality';
import type { MaterializedEditedPreview } from './editedPreviewEffectRunner';
import type { InteractivePreviewIdentity, InteractivePreviewPatchPayload } from './interactivePreviewPatch';
import {
  fingerprintPreviewOperationIdentity,
  type PreviewCoordinatorState,
  type PreviewOperationIdentity,
} from './previewCoordinator';
import type { WgpuPreviewCommit } from './wgpuFramePresentationAuthority';

export type PreviewPresentationValue =
  | { kind: 'empty' }
  | { kind: 'wgpu' }
  | { kind: 'limited'; reason: string }
  | { kind: 'patch'; patch: InteractivePreviewPatchPayload; url: string }
  | { kind: 'full'; transform: ExportSoftProofTransformState | null; url: string };

export interface PreviewPresentationContext {
  createdAt: number;
  identity: PreviewOperationIdentity;
  inputToDispatchMs: number;
  interactiveIdentity: InteractivePreviewIdentity;
  quality: PreviewQualityDecision;
  renderMs: number;
  scopeRecovery: boolean;
  targetResolution: number;
}

export interface PreviewPresentationState {
  imageSessionId: string | null;
  previewScopeStatus: PreviewScopeStatus | null;
}

export interface PreviewPresentationUpdate {
  exportSoftProofTransform?: ExportSoftProofTransformState | null;
  interactivePatch?: InteractivePatch | null;
  navigatorPreviewArtifact?: NavigatorPreviewArtifact;
  previewQualityStatus: PreviewQualityStatus;
  previewScopeRecoveryError?: null;
  previewScopeStatus?: PreviewScopeStatus | null;
  renderedPreviewResolution?: number;
}

export interface PreviewPresentationAdapterOptions {
  acceptWgpuPresentation: (commit: WgpuPreviewCommit) => void;
  getCoordinatorState: () => Readonly<PreviewCoordinatorState>;
  getPresentationState: () => PreviewPresentationState;
  now?: () => number;
  publish: (update: PreviewPresentationUpdate) => void;
  recordTiming: (sample: PreviewTimingSample) => void;
}

const isPresentedOperation = (
  state: Readonly<PreviewCoordinatorState>,
  identity: PreviewOperationIdentity,
): boolean => {
  const operation = state[identity.kind];
  return (
    operation.status === 'presented' &&
    operation.identity !== undefined &&
    fingerprintPreviewOperationIdentity(operation.identity) === fingerprintPreviewOperationIdentity(identity)
  );
};

/** Publishes only the exact operation the coordinator accepted as presented. */
export class PreviewPresentationAdapter {
  private readonly now: () => number;

  constructor(private readonly options: PreviewPresentationAdapterOptions) {
    this.now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  }

  present(result: MaterializedEditedPreview<PreviewPresentationValue>, context: PreviewPresentationContext): boolean {
    if (!isPresentedOperation(this.options.getCoordinatorState(), context.identity)) return false;
    const commitStartedAt = this.now();
    const { interactiveIdentity, quality, targetResolution } = context;
    const readyStatus: PreviewQualityStatus = {
      ...quality,
      generation: interactiveIdentity.generation,
      phase: getPreviewReadyPhase(quality),
      requestId: context.identity.operationId,
    };
    const value = result.value;
    let update: PreviewPresentationUpdate;

    if (value.kind === 'empty' || value.kind === 'limited') {
      update = {
        previewQualityStatus: {
          ...quality,
          generation: interactiveIdentity.generation,
          limitedBy: 'backend',
          phase: 'degraded_limited',
          reason: value.kind === 'empty' ? 'empty_render_buffer' : value.reason,
          requestId: context.identity.operationId,
          sufficientForSemanticZoom: false,
        },
      };
    } else if (value.kind === 'wgpu') {
      // The WGPU worker response only acknowledges GPU work submission. It is
      // not a visibility receipt: native presentation health is joined later
      // by the wgpu-frame-ready event. Keeping the existing CPU layer visible
      // here prevents a black/stale GPU texture from replacing the current
      // preview during zoom, resize, or surface recovery.
      this.recordTiming(result, context, commitStartedAt);
      return true;
    } else if (value.kind === 'patch') {
      update = {
        interactivePatch: {
          basePreviewUrl: interactiveIdentity.basePreviewUrl,
          fullHeight: value.patch.fullHeight,
          fullWidth: value.patch.fullWidth,
          geometryIdentity: interactiveIdentity.geometryIdentity,
          normH: value.patch.normH,
          normW: value.patch.normW,
          normX: value.patch.normX,
          normY: value.patch.normY,
          pixelHeight: value.patch.pixelHeight,
          pixelWidth: value.patch.pixelWidth,
          sourceImagePath: interactiveIdentity.sourceImagePath,
          url: value.url,
        },
        previewQualityStatus: readyStatus,
        ...(context.identity.kind === 'settled' ? { renderedPreviewResolution: targetResolution } : {}),
      };
    } else {
      const presentationState = this.options.getPresentationState();
      const completedScopeStatus = presentationState.previewScopeStatus;
      const transform = value.transform;
      update = {
        exportSoftProofTransform: transform,
        interactivePatch: null,
        navigatorPreviewArtifact: {
          graphIdentity: interactiveIdentity.graphIdentity,
          id: `${interactiveIdentity.graphIdentity}:${String(interactiveIdentity.generation)}:${String(context.identity.operationId)}`,
          imageSessionId: presentationState.imageSessionId ?? String(interactiveIdentity.imageSessionId),
          url: value.url,
        },
        previewQualityStatus: readyStatus,
        previewScopeStatus:
          transform &&
          completedScopeStatus?.path === interactiveIdentity.sourceImagePath &&
          completedScopeStatus.histogramReady &&
          completedScopeStatus.waveformReady
            ? {
                ...completedScopeStatus,
                displayTransformLabel: transform.colorManagedTransform ?? 'Display preview transform',
                exportProfileLabel: transform.effectiveColorProfile,
                exportRenderingIntentLabel: transform.effectiveRenderingIntent,
                renderBasis: 'export_preview',
                softProofTransformApplied: transform.transformApplied === true,
                sourceLabel: 'Export preview',
                warningCodes: [
                  transform.transformApplied ? 'export_profile_transform_applied' : 'export_profile_transform_missing',
                  'render_target_matches_export_recipe',
                ],
              }
            : completedScopeStatus,
        renderedPreviewResolution: targetResolution,
        ...(context.scopeRecovery ? { previewScopeRecoveryError: null } : {}),
      };
    }

    this.options.publish(update);
    this.recordTiming(result, context, commitStartedAt);
    return true;
  }

  private recordTiming(
    result: MaterializedEditedPreview<PreviewPresentationValue>,
    context: PreviewPresentationContext,
    commitStartedAt: number,
  ): void {
    this.options.recordTiming({
      commitMs: Math.max(0, this.now() - commitStartedAt),
      decodeMs: result.decodeMs ?? 0,
      displayedAgeMs: Math.max(0, this.now() - context.createdAt),
      inputToDispatchMs: context.inputToDispatchMs,
      renderMs: context.renderMs,
      tier: context.quality.tier,
    });
  }
}
