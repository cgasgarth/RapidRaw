import { z } from 'zod';

import { editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { ExportColorProfile, ExportRenderingIntent } from '../components/ui/ExportImportProperties';
import type { ExportSoftProofTransformState } from '../store/useEditorStore';
import { Invokes } from '../tauri/commands';
import type { PreviewQualityDecision } from './adaptivePreviewQuality';
import type { AdjustmentSnapshot, PatchResidencySnapshot } from './adjustmentSnapshots';
import { beginAppOperation, logAppOperationFailure, logAppOperationSuccess } from './appEventLogger';
import { prepareEditDocumentV2ForRender } from './editDocumentV2';
import {
  buildFilmPreviewRenderIdentity,
  type FilmRenderLease,
  FilmRenderScheduler,
} from './film-look/filmRenderScheduler';
import {
  InteractivePreviewGenerationController,
  type InteractivePreviewIdentity,
  type InteractivePreviewScope,
} from './interactivePreviewPatch';
import { PreparedAdjustmentPayloadCache } from './preparedAdjustmentPayloadCache';
import {
  fingerprintPreviewOperationIdentity,
  fingerprintPreviewRoi,
  type PreviewCoordinatorEffect,
  type PreviewCoordinatorEvent,
  type PreviewCoordinatorTransition,
  type PreviewOperationIdentity,
  type PreviewSessionIdentity,
} from './previewCoordinator';
import { invokeWithSchema } from './tauriSchemaInvoke';

const previewBufferResponseSchema = z.instanceof(ArrayBuffer);
const applyAdjustmentsInvokeSchema = z
  .object({
    activeWaveformChannel: z.string().nullable().optional(),
    computeWaveform: z.boolean(),
    editDocumentV2: editDocumentV2Schema,
    expectedImagePath: z.string().trim().min(1),
    isInteractive: z.boolean(),
    roi: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    targetResolution: z.number().int().positive(),
    viewerSampleGraphRevision: z.string().nullable().optional(),
  })
  .strict();
const exportSoftProofTransformResponseSchema = z
  .object({
    blackPointCompensation: z.string().trim().min(1),
    colorManagedTransform: z.string().trim().min(1),
    effectiveColorProfile: z.string().trim().min(1),
    effectiveRenderingIntent: z.string().trim().min(1),
    policyStatus: z.string().trim().min(1),
    policyVersion: z.string().trim().min(1),
    sourcePrecisionPath: z.string().trim().min(1),
    transformApplied: z.boolean(),
    transformPolicyFingerprint: z
      .string()
      .trim()
      .regex(/^sha256:/u),
  })
  .transform(
    (metadata): ExportSoftProofTransformState => ({
      blackPointCompensation: metadata.blackPointCompensation,
      colorManagedTransform: metadata.colorManagedTransform,
      effectiveColorProfile: metadata.effectiveColorProfile,
      effectiveRenderingIntent: metadata.effectiveRenderingIntent,
      policyStatus: metadata.policyStatus,
      policyVersion: metadata.policyVersion,
      sourcePrecisionPath: metadata.sourcePrecisionPath,
      transformApplied: metadata.transformApplied,
      transformPolicyFingerprint: metadata.transformPolicyFingerprint,
    }),
  );

export interface EditedPreviewSoftProofRequest {
  blackPointCompensation: boolean;
  colorProfile: ExportColorProfile;
  exportSoftProofRecipeId: string;
  renderingIntent: ExportRenderingIntent;
}

export interface EditedPreviewRequest {
  activeWaveformChannel: string | null;
  computeWaveform: boolean;
  createdAt: number;
  kind: 'interactive' | 'settled';
  proof: EditedPreviewSoftProofRequest | null;
  roi: [number, number, number, number] | null;
  quality: PreviewQualityDecision;
  scopeRecovery: boolean;
  session: PreviewSessionIdentity;
  snapshot: AdjustmentSnapshot;
  targetResolution: number;
  viewerScope: InteractivePreviewScope;
}

export interface ScheduledEditedPreviewRequest extends EditedPreviewRequest {
  filmRenderCancellationSignal: AbortSignal | null;
  filmRenderIdentity: FilmRenderLease['identity'] | null;
  interactiveIdentity: InteractivePreviewIdentity;
}

export interface ExecutedEditedPreview {
  buffer: ArrayBuffer;
  newlySentPatchIds: ReadonlySet<string>;
  transform: ExportSoftProofTransformState | null;
}

export interface MaterializedEditedPreview<T> {
  artifactUrl?: string;
  decodeMs?: number;
  value: T;
}

export interface EditedPreviewExecutionContext {
  identity: PreviewOperationIdentity;
  inputToDispatchMs: number;
  renderMs: number;
  request: ScheduledEditedPreviewRequest;
}

export type EditedPreviewExecutor = (
  request: ScheduledEditedPreviewRequest,
  residency: PatchResidencySnapshot,
  identity: PreviewOperationIdentity,
) => Promise<ExecutedEditedPreview>;
type PreviewCoordinatorDispatch = (event: PreviewCoordinatorEvent) => PreviewCoordinatorTransition;

export interface EditedPreviewEffectRunnerOptions<T> {
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  dispatch: PreviewCoordinatorDispatch;
  execute?: EditedPreviewExecutor;
  getPatchResidency: () => PatchResidencySnapshot;
  markPatchesResident: (imageSessionId: number, patchIds: ReadonlySet<string>) => void;
  materialize: (
    result: ExecutedEditedPreview,
    context: EditedPreviewExecutionContext,
  ) => Promise<MaterializedEditedPreview<T>>;
  onCurrentFailure?: (error: unknown, context: EditedPreviewExecutionContext) => void;
  onPresented: (result: MaterializedEditedPreview<T>, context: EditedPreviewExecutionContext) => void;
  releaseMaterialized?: (result: MaterializedEditedPreview<T>) => void;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
}

interface ScheduledEditedPreview {
  filmRenderLease: FilmRenderLease | null;
  identity: PreviewOperationIdentity;
  request: ScheduledEditedPreviewRequest;
  timer: ReturnType<typeof setTimeout> | null;
}

const previewNow = (): number => globalThis.performance?.now() ?? Date.now();

const validateRequestIdentity = (request: EditedPreviewRequest): void => {
  const { session, snapshot, targetResolution, viewerScope } = request;
  const mismatched =
    session.sourceImagePath !== viewerScope.sourceImagePath ||
    session.graphRevision !== viewerScope.graphIdentity ||
    session.imageSessionId !== viewerScope.imageSessionId ||
    session.adjustmentRevision !== snapshot.adjustmentRevision ||
    session.geometryRevision !== snapshot.geometryRevision ||
    session.geometryRevision !== viewerScope.geometryIdentity ||
    session.maskRevision !== snapshot.maskRevision ||
    session.maskRevision !== viewerScope.maskRevision ||
    session.patchRevision !== snapshot.patchRevision ||
    session.patchRevision !== viewerScope.patchRevision ||
    session.proofRevision !== viewerScope.proofRevision ||
    session.roiFingerprint !== fingerprintPreviewRoi(request.roi) ||
    session.targetWidth !== targetResolution ||
    session.targetHeight !== targetResolution ||
    session.viewportRevision !== viewerScope.viewportIdentity;
  if (mismatched) throw new Error('Edited preview request does not match its typed session identity.');
};

const executeNativeEditedPreview = async (
  request: ScheduledEditedPreviewRequest,
  payload: ReturnType<PreparedAdjustmentPayloadCache['prepare']>['payload'],
): Promise<Omit<ExecutedEditedPreview, 'newlySentPatchIds'>> => {
  if (request.proof !== null && request.kind === 'settled') {
    const proofRequest = {
      activeWaveformChannel: request.activeWaveformChannel,
      blackPointCompensation: request.proof.blackPointCompensation,
      colorProfile: request.proof.colorProfile,
      computeWaveform: request.computeWaveform,
      expectedImagePath: request.session.sourceImagePath,
      exportSoftProofRecipeId: request.proof.exportSoftProofRecipeId,
      jsAdjustments: payload,
      renderingIntent: request.proof.renderingIntent,
      targetResolution: request.targetResolution,
      viewerSampleGraphRevision: request.session.graphRevision,
    };
    const [buffer, transform] = await Promise.all([
      invokeWithSchema(Invokes.GenerateExportSoftProofPreview, { request: proofRequest }, previewBufferResponseSchema),
      invokeWithSchema(
        Invokes.ResolveExportSoftProofTransformMetadata,
        {
          blackPointCompensation: proofRequest.blackPointCompensation,
          colorProfile: proofRequest.colorProfile,
          jsAdjustments: proofRequest.jsAdjustments,
          renderingIntent: proofRequest.renderingIntent,
          targetResolution: proofRequest.targetResolution,
        },
        exportSoftProofTransformResponseSchema,
      ),
    ]);
    return { buffer, transform };
  }
  const buffer = await invokeWithSchema(
    Invokes.ApplyAdjustments,
    {
      request: applyAdjustmentsInvokeSchema.parse({
        activeWaveformChannel: request.activeWaveformChannel,
        computeWaveform: request.computeWaveform,
        editDocumentV2: prepareEditDocumentV2ForRender(payload, request.snapshot.editDocumentV2, [
          'scene_global_color_tone',
        ]),
        expectedImagePath: request.session.sourceImagePath,
        isInteractive: request.kind === 'interactive',
        roi: request.roi,
        targetResolution: request.targetResolution,
        viewerSampleGraphRevision: request.session.graphRevision,
      }),
    },
    previewBufferResponseSchema,
  );
  return { buffer, transform: null };
};

const executeEditedPreviewWithCache =
  (cache: PreparedAdjustmentPayloadCache): EditedPreviewExecutor =>
  async (request, residency, identity) => {
    const { newlySentPatchIds, payload } = cache.prepare(request.snapshot, residency);
    const operation =
      request.kind === 'settled'
        ? beginAppOperation({
            action: request.proof === null ? 'render_editor_preview' : 'render_soft_proof_preview',
            component: 'editor.preview',
            details: {
              computeWaveform: request.computeWaveform,
              generation: identity.generation,
              hasRoi: request.roi !== null,
              jobId: identity.operationId,
              previewQualityReason: request.quality.reason,
              previewQualitySufficient: request.quality.sufficientForSemanticZoom,
              previewQualityTier: request.quality.tier,
              softProof: request.proof !== null,
              targetResolution: request.targetResolution,
            },
            domain: 'preview',
            operationId: `preview_${String(identity.operationId)}`,
            ...(request.proof === null
              ? {}
              : { traceId: `preview_soft_proof_${request.proof.exportSoftProofRecipeId}` }),
          })
        : null;
    try {
      const result = await executeNativeEditedPreview(request, payload);
      if (operation !== null) {
        logAppOperationSuccess(operation, {
          byteLength: result.buffer.byteLength,
          jobId: identity.operationId,
          softProofTransformApplied: result.transform?.transformApplied ?? false,
        });
      }
      return { ...result, newlySentPatchIds };
    } catch (error) {
      if (operation !== null) {
        if (String(error).includes('preview_superseded')) {
          logAppOperationSuccess(operation, { droppedReason: 'superseded', jobId: identity.operationId });
        } else logAppOperationFailure(operation, error);
      }
      throw error;
    }
  };

/** Owns edited-preview scheduling, native work, cancellation, and exact-currentness. */
export class EditedPreviewEffectRunner<T> {
  private readonly active = new Map<number, ScheduledEditedPreview>();
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly dispatch: PreviewCoordinatorDispatch;
  private readonly execute: EditedPreviewExecutor;
  private readonly filmRenderScheduler = new FilmRenderScheduler();
  private readonly getPatchResidency: () => PatchResidencySnapshot;
  private readonly interactiveGeneration = new InteractivePreviewGenerationController();
  private interactivePending: ScheduledEditedPreview | null = null;
  private interactiveRunning = false;
  private readonly markPatchesResident: (imageSessionId: number, patchIds: ReadonlySet<string>) => void;
  private readonly materialize: EditedPreviewEffectRunnerOptions<T>['materialize'];
  private readonly onCurrentFailure: NonNullable<EditedPreviewEffectRunnerOptions<T>['onCurrentFailure']>;
  private readonly onPresented: EditedPreviewEffectRunnerOptions<T>['onPresented'];
  private readonly payloadCache = new PreparedAdjustmentPayloadCache();
  private readonly releaseMaterialized: (result: MaterializedEditedPreview<T>) => void;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(options: EditedPreviewEffectRunnerOptions<T>) {
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
    this.dispatch = options.dispatch;
    this.execute = options.execute ?? executeEditedPreviewWithCache(this.payloadCache);
    this.getPatchResidency = options.getPatchResidency;
    this.markPatchesResident = options.markPatchesResident;
    this.materialize = options.materialize;
    this.onCurrentFailure = options.onCurrentFailure ?? (() => {});
    this.onPresented = options.onPresented;
    this.releaseMaterialized = options.releaseMaterialized ?? (() => {});
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  }

  request(request: EditedPreviewRequest, delayMs = 0): PreviewOperationIdentity {
    if (this.disposed) throw new Error('Edited preview runner is disposed.');
    validateRequestIdentity(request);
    const synchronized =
      request.kind === 'interactive'
        ? this.interactiveGeneration.synchronize(request.viewerScope)
        : { identity: this.interactiveGeneration.supersede(request.viewerScope), invalidated: true };
    const scheduledRequest: ScheduledEditedPreviewRequest = {
      ...request,
      filmRenderCancellationSignal: null,
      filmRenderIdentity: null,
      interactiveIdentity: synchronized.identity,
    };
    const viewportTransition = this.dispatch({
      type: 'viewport-changed',
      viewport: {
        revision: request.session.viewportRevision,
        roiFingerprint: request.session.roiFingerprint,
        targetHeight: request.session.targetHeight,
        targetWidth: request.session.targetWidth,
      },
    });
    this.consume(viewportTransition.effects);
    const transition = this.dispatch({
      identity: request.session,
      kind: request.kind,
      reason: request.scopeRecovery ? 'scope-recovery' : `${request.kind}-inputs-changed`,
      type: 'render-inputs-changed',
    });
    this.consume(transition.effects);
    const identity = transition.state[request.kind].identity;
    if (identity === undefined) throw new Error('PreviewCoordinator did not create an edited preview operation.');

    const filmRenderIdentity = buildFilmPreviewRenderIdentity({
      adjustmentRevision: request.snapshot.adjustmentRevision,
      adjustments: request.snapshot.value,
      backend: request.viewerScope.backend,
      displayGeneration: request.session.displayGeneration,
      imageSessionId: request.session.imageSessionId,
      proofIdentity: request.proof,
      quality: request.kind === 'interactive' ? 'interactive_drag_v1' : 'settled_preview_v1',
      roi: request.roi,
      sourceImagePath: request.session.sourceImagePath,
      sourceRevision: request.session.sourceRevision,
      targetResolution: request.targetResolution,
      viewportRevision: request.session.viewportRevision,
    });
    const filmRenderLease = filmRenderIdentity === null ? null : this.filmRenderScheduler.begin(filmRenderIdentity);
    scheduledRequest.filmRenderCancellationSignal = filmRenderLease?.signal ?? null;
    scheduledRequest.filmRenderIdentity = filmRenderLease?.identity ?? null;
    const scheduled: ScheduledEditedPreview = { filmRenderLease, identity, request: scheduledRequest, timer: null };
    this.active.set(identity.operationId, scheduled);
    if (request.kind === 'interactive') {
      this.interactivePending = scheduled;
      this.flushInteractive();
    } else {
      this.clearInteractivePending();
      scheduled.timer = this.setTimer(
        () => {
          scheduled.timer = null;
          void this.executeScheduled(scheduled);
        },
        Math.max(0, delayMs),
      );
    }
    return identity;
  }

  consume(effects: readonly PreviewCoordinatorEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'cancel' && (effect.identity.kind === 'interactive' || effect.identity.kind === 'settled')) {
        this.cancelIdentity(effect.identity);
      }
    }
  }

  cancel(): void {
    this.clearInteractivePending();
    for (const scheduled of this.active.values()) {
      if (scheduled.timer !== null) this.clearTimer(scheduled.timer);
      if (scheduled.filmRenderLease !== null) this.filmRenderScheduler.cancel(scheduled.filmRenderLease);
    }
    this.active.clear();
    this.payloadCache.reset();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private cancelIdentity(identity: PreviewOperationIdentity): void {
    const scheduled = this.active.get(identity.operationId);
    if (scheduled === undefined) return;
    if (scheduled.timer !== null) this.clearTimer(scheduled.timer);
    if (scheduled.filmRenderLease !== null) this.filmRenderScheduler.cancel(scheduled.filmRenderLease);
    if (this.interactivePending?.identity.operationId === identity.operationId) this.interactivePending = null;
    this.active.delete(identity.operationId);
  }

  private clearInteractivePending(): void {
    if (this.interactivePending?.timer !== null && this.interactivePending?.timer !== undefined) {
      this.clearTimer(this.interactivePending.timer);
    }
    if (this.interactivePending?.filmRenderLease !== null && this.interactivePending?.filmRenderLease !== undefined) {
      this.filmRenderScheduler.cancel(this.interactivePending.filmRenderLease);
    }
    if (this.interactivePending !== null && !this.interactiveRunning) {
      this.active.delete(this.interactivePending.identity.operationId);
    }
    this.interactivePending = null;
  }

  private flushInteractive(): void {
    if (this.disposed || this.interactiveRunning || this.interactivePending === null) return;
    const scheduled = this.interactivePending;
    this.interactivePending = null;
    this.interactiveRunning = true;
    void this.executeScheduled(scheduled).finally(() => {
      this.interactiveRunning = false;
      this.flushInteractive();
    });
  }

  private async executeScheduled(scheduled: ScheduledEditedPreview): Promise<void> {
    if (this.disposed || !this.active.has(scheduled.identity.operationId)) return;
    if (scheduled.filmRenderLease !== null && !this.filmRenderScheduler.canCommit(scheduled.filmRenderLease)) {
      this.active.delete(scheduled.identity.operationId);
      return;
    }
    const dispatchedAt = previewNow();
    const context: EditedPreviewExecutionContext = {
      identity: scheduled.identity,
      inputToDispatchMs: Math.max(0, dispatchedAt - scheduled.request.createdAt),
      renderMs: 0,
      request: scheduled.request,
    };
    const started = this.dispatch({ identity: scheduled.identity, type: 'operation-started' });
    if (started.state.lastTransition?.staleCompletion === true) {
      if (scheduled.filmRenderLease !== null) this.filmRenderScheduler.finish(scheduled.filmRenderLease);
      this.active.delete(scheduled.identity.operationId);
      return;
    }

    try {
      const renderStartedAt = previewNow();
      const executed = await this.execute(scheduled.request, this.getPatchResidency(), scheduled.identity);
      context.renderMs = Math.max(0, previewNow() - renderStartedAt);
      if (!this.active.has(scheduled.identity.operationId)) return;
      if (scheduled.filmRenderLease !== null && !this.filmRenderScheduler.canCommit(scheduled.filmRenderLease)) return;
      const materialized = await this.materialize(executed, context);
      const artifact =
        materialized.artifactUrl === undefined
          ? undefined
          : { identity: scheduled.identity, url: materialized.artifactUrl };
      const completed = this.dispatch({
        ...(artifact === undefined ? {} : { artifact }),
        identity: scheduled.identity,
        type: 'operation-completed',
      });
      if (completed.state.lastTransition?.staleCompletion !== true) {
        if (executed.newlySentPatchIds.size > 0) {
          this.markPatchesResident(scheduled.request.session.imageSessionId, executed.newlySentPatchIds);
        }
        this.onPresented(materialized, context);
      } else this.releaseMaterialized(materialized);
    } catch (error) {
      const failed = this.dispatch({ error: String(error), identity: scheduled.identity, type: 'operation-failed' });
      if (failed.state.lastTransition?.staleCompletion !== true) this.onCurrentFailure(error, context);
    } finally {
      if (scheduled.filmRenderLease !== null) this.filmRenderScheduler.finish(scheduled.filmRenderLease);
      const current = this.active.get(scheduled.identity.operationId);
      if (
        current !== undefined &&
        fingerprintPreviewOperationIdentity(current.identity) ===
          fingerprintPreviewOperationIdentity(scheduled.identity)
      ) {
        this.active.delete(scheduled.identity.operationId);
      }
    }
  }
}
