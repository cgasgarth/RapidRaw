import { describe, expect, test } from 'bun:test';

import { filmEmulationNodeV1Schema } from '../../../packages/rawengine-schema/src/index';
import { ExportColorProfile, ExportRenderingIntent } from '../../../src/components/ui/ExportImportProperties';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  EditedPreviewEffectRunner,
  type EditedPreviewRequest,
  type ExecutedEditedPreview,
  type MaterializedEditedPreview,
  type ScheduledEditedPreviewRequest,
} from '../../../src/utils/editedPreviewEffectRunner';
import { EditorPersistenceEffectRunner } from '../../../src/utils/editorPersistenceEffectRunner';
import { REFERENCE_FILM_PROFILE_REF } from '../../../src/utils/film-look/filmEmulationOperation';
import type { InteractivePreviewScope } from '../../../src/utils/interactivePreviewPatch';
import {
  fingerprintPreviewGraphRevision,
  PreviewCoordinator,
  type PreviewCoordinatorEffect,
} from '../../../src/utils/previewCoordinator';
import { PreviewViewportSnapshotController } from '../../../src/utils/previewViewportSnapshot';

type BuildRequestOverrides = Omit<Partial<EditedPreviewRequest>, 'session' | 'viewerScope' | 'viewportAuthority'> & {
  imageSessionId?: number;
  session?: Partial<EditedPreviewRequest['session']>;
  sourceImagePath?: string;
  viewerScope?: Partial<InteractivePreviewScope>;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
};

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let depth = 0; depth < 8; depth += 1) await Promise.resolve();
};
const execution = (marker = 1): ExecutedEditedPreview => ({
  buffer: new Uint8Array([marker]).buffer,
  newlySentPatchIds: new Set(),
  transform: null,
});

const buildRequest = (overrides: BuildRequestOverrides = {}): EditedPreviewRequest => {
  const imageSessionId = overrides.imageSessionId ?? 1;
  const sourceImagePath = overrides.sourceImagePath ?? '/fixtures/a.raw';
  const snapshot = overrides.snapshot ?? publishAdjustmentSnapshot(null, structuredClone(INITIAL_ADJUSTMENTS));
  const targetResolution = overrides.targetResolution ?? 1200;
  const proofRevision = overrides.viewerScope?.proofRevision ?? overrides.session?.proofRevision ?? 1;
  const graphRevision = fingerprintPreviewGraphRevision({
    adjustmentRevision: snapshot.renderRevision,
    geometryRevision: snapshot.geometryRevision,
    imageSessionId,
    maskRevision: snapshot.maskRevision,
    patchRevision: snapshot.patchRevision,
    proofRevision,
    proposalFingerprint: 'committed',
  });
  const viewerScope: InteractivePreviewScope = {
    adjustmentRevision: snapshot.renderRevision,
    backend: 'cpu',
    basePreviewUrl: 'blob:base',
    devicePixelRatio: 2,
    geometryIdentity: snapshot.geometryRevision,
    graphIdentity: graphRevision,
    imageSessionId,
    maskRevision: snapshot.maskRevision,
    patchRevision: snapshot.patchRevision,
    proofRevision,
    roiH: null,
    roiW: null,
    roiX: null,
    roiY: null,
    sourceImagePath,
    targetResolution,
    viewportIdentity: 1,
    ...overrides.viewerScope,
  };
  const viewportController = new PreviewViewportSnapshotController();
  const requestedViewportRevision = overrides.session?.viewportRevision ?? viewerScope.viewportIdentity;
  for (let revision = 1; revision < requestedViewportRevision; revision += 1) {
    viewportController.snapshot({
      devicePixelRatio: viewerScope.devicePixelRatio,
      geometryRevision: snapshot.geometryRevision,
      layout: { containerHeight: 800, containerWidth: 1200, height: 800, offsetX: revision, offsetY: 0, width: 1200 },
      qualityPolicy: {
        editorPreviewResolution: 1920,
        enableZoomHifi: true,
        highResZoomMultiplier: 1,
        useFullDpiRendering: false,
      },
      roi: overrides.roi ?? null,
      sourceImagePath,
      sourceRevision: imageSessionId,
      targetHeight: targetResolution,
      targetWidth: targetResolution,
      transform: { positionX: 0, positionY: 0, scale: 1 },
      zoomMode: { kind: 'fit' },
    });
  }
  const viewportAuthority = viewportController.snapshot({
    devicePixelRatio: viewerScope.devicePixelRatio,
    geometryRevision: snapshot.geometryRevision,
    layout: { containerHeight: 800, containerWidth: 1200, height: 800, offsetX: 0, offsetY: 0, width: 1200 },
    qualityPolicy: {
      editorPreviewResolution: 1920,
      enableZoomHifi: true,
      highResZoomMultiplier: 1,
      useFullDpiRendering: false,
    },
    roi: overrides.roi ?? null,
    sourceImagePath,
    sourceRevision: imageSessionId,
    targetHeight: targetResolution,
    targetWidth: targetResolution,
    transform: { positionX: 0, positionY: 0, scale: 1 },
    zoomMode: { kind: 'fit' },
  });
  return {
    ...overrides,
    activeWaveformChannel: overrides.activeWaveformChannel ?? null,
    computeWaveform: overrides.computeWaveform ?? false,
    createdAt: overrides.createdAt ?? 1,
    kind: overrides.kind ?? 'settled',
    proof: overrides.proof ?? null,
    quality: overrides.quality ?? {
      backend: 'cpu',
      effectiveRoi: null,
      effectiveTargetResolution: targetResolution,
      estimatedWorkingBytes: 1,
      limitedBy: null,
      reason: 'test',
      requestedTargetResolution: targetResolution,
      sufficientForSemanticZoom: true,
      tier: 'settled_full',
    },
    roi: overrides.roi ?? null,
    scopeRecovery: overrides.scopeRecovery ?? false,
    session: {
      adjustmentRevision: snapshot.renderRevision,
      backend: 'cpu',
      displayGeneration: 1,
      geometryRevision: snapshot.geometryRevision,
      graphRevision,
      imageSessionId,
      maskRevision: snapshot.maskRevision,
      patchRevision: snapshot.patchRevision,
      proofRevision,
      roiFingerprint: '[0,0,1,1]',
      sourceImagePath,
      sourceRevision: imageSessionId,
      targetHeight: targetResolution,
      targetWidth: targetResolution,
      viewportRevision: viewportAuthority.coordinator.revision,
      ...overrides.session,
    },
    snapshot,
    targetResolution,
    viewerScope,
    viewportAuthority,
  };
};

function harness<T>({
  execute,
  materialize = async (result) => ({ value: new Uint8Array(result.buffer)[0] as T }),
  onEffects = () => {},
  onFailure = () => {},
  onPresented,
  releaseMaterialized = () => {},
}: {
  execute: (request: ScheduledEditedPreviewRequest) => Promise<ExecutedEditedPreview>;
  materialize?: (result: ExecutedEditedPreview) => Promise<MaterializedEditedPreview<T>>;
  onEffects?: (effects: readonly PreviewCoordinatorEffect[]) => void;
  onFailure?: (error: unknown) => void;
  onPresented: (value: T) => void;
  releaseMaterialized?: (result: MaterializedEditedPreview<T>) => void;
}) {
  const coordinator = new PreviewCoordinator();
  let runner: EditedPreviewEffectRunner<T>;
  const dispatch = (event: Parameters<PreviewCoordinator['dispatch']>[0]) => {
    const transition = coordinator.dispatch(event);
    runner?.consume(transition.effects);
    onEffects(transition.effects);
    return transition;
  };
  runner = new EditedPreviewEffectRunner<T>({
    dispatch,
    execute: (request) => execute(request),
    getPatchResidency: () => ({ residentIds: new Set(), revision: 1, sessionId: 1 }),
    markPatchesResident: () => {},
    materialize,
    onCurrentFailure: onFailure,
    onPresented: ({ value }) => onPresented(value),
    releaseMaterialized,
  });
  return { coordinator, dispatch, runner };
}

describe('edited preview effect runner', () => {
  test('rejects source, graph, geometry, patch-residency, and target mismatches before native execution', () => {
    let executions = 0;
    const { runner } = harness<number>({
      execute: async () => {
        executions += 1;
        return execution();
      },
      onPresented: () => {},
    });
    const base = buildRequest();

    expect(() => runner.request({ ...base, targetResolution: 900 })).toThrow('typed session identity');
    expect(() =>
      runner.request({ ...base, viewerScope: { ...base.viewerScope, sourceImagePath: '/fixtures/b.raw' } }),
    ).toThrow('typed session identity');
    expect(() =>
      runner.request({ ...base, viewerScope: { ...base.viewerScope, graphIdentity: 'stale-graph' } }),
    ).toThrow('typed session identity');
    expect(() => runner.request({ ...base, viewerScope: { ...base.viewerScope, geometryIdentity: 99 } })).toThrow(
      'typed session identity',
    );
    expect(() => runner.request({ ...base, viewerScope: { ...base.viewerScope, patchRevision: 99 } })).toThrow(
      'typed session identity',
    );
    expect(executions).toBe(0);
  });

  test('A to B to successor-A publishes only the exact successor across reversed completions', async () => {
    const firstA = deferred<ExecutedEditedPreview>();
    const b = deferred<ExecutedEditedPreview>();
    const successorA = deferred<ExecutedEditedPreview>();
    const executions = [firstA.promise, b.promise, successorA.promise];
    const presented: number[] = [];
    const { runner } = harness<number>({
      execute: async () => executions.shift() ?? Promise.reject(new Error('unexpected execution')),
      onPresented: (value) => presented.push(value),
    });

    runner.request(buildRequest());
    await tick();
    runner.request(buildRequest({ imageSessionId: 2, sourceImagePath: '/fixtures/b.raw' }));
    await tick();
    runner.request(buildRequest({ imageSessionId: 3, sourceImagePath: '/fixtures/a.raw' }));
    await tick();
    firstA.resolve(execution(1));
    b.resolve(execution(2));
    successorA.resolve(execution(3));
    await tick();

    expect(presented).toEqual([3]);
  });

  test('display, proof, geometry, viewport, and target changes supersede running results', async () => {
    const stale = deferred<ExecutedEditedPreview>();
    const current = deferred<ExecutedEditedPreview>();
    const executions = [stale.promise, current.promise];
    const presented: number[] = [];
    const { runner } = harness<number>({
      execute: async () => executions.shift() ?? Promise.reject(new Error('unexpected execution')),
      onPresented: (value) => presented.push(value),
    });
    const base = buildRequest({
      proof: {
        blackPointCompensation: false,
        colorProfile: ExportColorProfile.Srgb,
        exportSoftProofRecipeId: 'proof-a',
        renderingIntent: ExportRenderingIntent.RelativeColorimetric,
      },
    });
    runner.request(base);
    await tick();
    const changedSnapshot = publishAdjustmentSnapshot(base.snapshot, {
      ...base.snapshot.value,
      rotation: base.snapshot.value.rotation + 1,
    });
    const changed = buildRequest({
      snapshot: changedSnapshot,
      targetResolution: 1800,
      viewerScope: { proofRevision: 2, viewportIdentity: 2 },
      proof: {
        blackPointCompensation: true,
        colorProfile: ExportColorProfile.DisplayP3,
        exportSoftProofRecipeId: 'proof-b',
        renderingIntent: ExportRenderingIntent.Perceptual,
      },
      session: { displayGeneration: 2, proofRevision: 2, viewportRevision: 2 },
    });
    runner.request(changed);
    await tick();
    stale.resolve(execution(1));
    current.resolve(execution(2));
    await tick();

    expect(presented).toEqual([2]);
  });

  test('queued cancellation and unmount prevent native execution', async () => {
    let executions = 0;
    const { dispatch, runner } = harness<number>({
      execute: async () => {
        executions += 1;
        return execution();
      },
      onPresented: () => {},
    });
    runner.request(buildRequest(), 25);
    dispatch({ reason: 'editor-unmounted', type: 'cancel-session' });
    runner.dispose();
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(executions).toBe(0);
  });

  test('reversible session cancellation supports React Strict Mode remount', async () => {
    const presented: number[] = [];
    let executions = 0;
    const { dispatch, runner } = harness<number>({
      execute: async () => {
        executions += 1;
        return execution(2);
      },
      onPresented: (value) => presented.push(value),
    });
    runner.request(buildRequest(), 25);
    dispatch({ reason: 'strict-mode-cleanup', type: 'cancel-session' });
    runner.cancel();
    runner.request(buildRequest());
    await tick();

    expect(executions).toBe(1);
    expect(presented).toEqual([2]);
  });

  test('running cancellation drops late completion and stale error without callbacks', async () => {
    const late = deferred<ExecutedEditedPreview>();
    const staleError = deferred<ExecutedEditedPreview>();
    const executions = [late.promise, staleError.promise];
    const failures: string[] = [];
    const presented: number[] = [];
    const { dispatch, runner } = harness<number>({
      execute: async () => executions.shift() ?? Promise.reject(new Error('unexpected execution')),
      onFailure: (error) => failures.push(String(error)),
      onPresented: (value) => presented.push(value),
    });
    runner.request(buildRequest());
    await tick();
    dispatch({ generation: 2, type: 'display-generation-changed' });
    late.resolve(execution(1));
    await tick();
    runner.request(buildRequest({ session: { displayGeneration: 2 } }));
    await tick();
    dispatch({ reason: 'editor-unmounted', type: 'cancel-session' });
    staleError.reject(new Error('late failure'));
    await tick();

    expect(presented).toEqual([]);
    expect(failures).toEqual([]);
  });

  test('reports one current error and permits an exact retry', async () => {
    const failures: string[] = [];
    const presented: number[] = [];
    let attempt = 0;
    const { runner } = harness<number>({
      execute: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('native failed');
        return execution(2);
      },
      onFailure: (error) => failures.push(String(error)),
      onPresented: (value) => presented.push(value),
    });
    const request = buildRequest();
    runner.request(request);
    await tick();
    runner.request(request);
    await tick();

    expect(failures).toEqual(['Error: native failed']);
    expect(presented).toEqual([2]);
  });

  test('latest-only interactive queue skips the superseded pending render', async () => {
    const running = deferred<ExecutedEditedPreview>();
    const calls: number[] = [];
    const presented: number[] = [];
    const { runner } = harness<number>({
      execute: async (request) => {
        calls.push(request.snapshot.renderRevision);
        if (calls.length === 1) return running.promise;
        return execution(request.snapshot.renderRevision);
      },
      onPresented: (value) => presented.push(value),
    });
    const first = buildRequest({ kind: 'interactive' });
    const secondSnapshot = publishAdjustmentSnapshot(first.snapshot, { ...first.snapshot.value, exposure: 1 });
    const thirdSnapshot = publishAdjustmentSnapshot(secondSnapshot, { ...secondSnapshot.value, exposure: 2 });
    runner.request(first);
    await tick();
    runner.request(buildRequest({ kind: 'interactive', snapshot: secondSnapshot }));
    runner.request(buildRequest({ kind: 'interactive', snapshot: thirdSnapshot }));
    running.resolve(execution(1));
    await tick();
    await tick();

    expect(calls).toEqual([1, 3]);
    expect(presented).toEqual([3]);
  });

  test('Film pointer release aborts interactive identity and only presents exact settled quality', async () => {
    const interactive = deferred<ExecutedEditedPreview>();
    const settled = deferred<ExecutedEditedPreview>();
    const executions = [interactive.promise, settled.promise];
    const scheduled: ScheduledEditedPreviewRequest[] = [];
    const presented: number[] = [];
    const { runner } = harness<number>({
      execute: async (request) => {
        scheduled.push(request);
        return executions.shift() ?? Promise.reject(new Error('unexpected execution'));
      },
      onPresented: (value) => presented.push(value),
    });
    const filmEmulation = filmEmulationNodeV1Schema.parse({
      contractVersion: 1,
      enabled: true,
      mix: 1,
      nodeType: 'film_emulation',
      profileRef: REFERENCE_FILM_PROFILE_REF,
      seedPolicy: 'source_stable_v1',
      workingSpace: 'acescg_linear_v1',
    });
    const snapshot = publishAdjustmentSnapshot(null, { ...structuredClone(INITIAL_ADJUSTMENTS), filmEmulation });

    runner.request(buildRequest({ kind: 'interactive', snapshot }));
    await tick();
    runner.request(buildRequest({ kind: 'settled', snapshot }));
    await tick();

    expect(scheduled.map((request) => request.filmRenderIdentity?.quality)).toEqual([
      'interactive_drag_v1',
      'settled_preview_v1',
    ]);
    expect(scheduled[0]?.filmRenderCancellationSignal?.aborted).toBeTrue();
    expect(scheduled[1]?.filmRenderCancellationSignal?.aborted).toBeFalse();

    settled.resolve(execution(2));
    interactive.resolve(execution(1));
    await tick();
    expect(presented).toEqual([2]);
  });

  test('settled completion suppresses a materializing interactive result and releases its URL exactly once', async () => {
    const interactiveMaterializing = deferred<void>();
    const releaseInteractiveMaterialization = deferred<void>();
    const presented: number[] = [];
    const released: Array<{ reason: string; url: string }> = [];
    const fallbackReleases: string[] = [];
    const { runner } = harness<number>({
      execute: async (request) => execution(request.kind === 'interactive' ? 1 : 2),
      materialize: async (result) => {
        const marker = new Uint8Array(result.buffer)[0] ?? 0;
        if (marker === 1) {
          interactiveMaterializing.resolve();
          await releaseInteractiveMaterialization.promise;
          return { artifactUrl: 'blob:interactive', value: marker };
        }
        return { artifactUrl: 'blob:settled', value: marker };
      },
      onEffects: (effects) => {
        for (const effect of effects) {
          if (effect.type === 'release-url') released.push({ reason: effect.reason, url: effect.url });
        }
      },
      onPresented: (value) => presented.push(value),
      releaseMaterialized: ({ artifactUrl }) => {
        if (artifactUrl !== undefined) fallbackReleases.push(artifactUrl);
      },
    });
    const request = buildRequest();

    runner.request(buildRequest({ kind: 'interactive', snapshot: request.snapshot }));
    await interactiveMaterializing.promise;
    runner.request(buildRequest({ kind: 'settled', snapshot: request.snapshot }));
    await tick();
    await tick();
    expect(presented).toEqual([2]);

    releaseInteractiveMaterialization.resolve();
    await tick();
    await tick();

    expect(presented).toEqual([2]);
    expect(released).toEqual([{ reason: 'artifact-not-presented', url: 'blob:interactive' }]);
    expect(fallbackReleases).toEqual([]);
  });

  test('settled completion releases a late patch URL through the materialized-value owner exactly once', async () => {
    const interactiveMaterializing = deferred<void>();
    const releaseInteractiveMaterialization = deferred<void>();
    const presented: number[] = [];
    const coordinatorReleases: string[] = [];
    const materializedReleases: string[] = [];
    const { runner } = harness<{ marker: number; url?: string }>({
      execute: async (request) => execution(request.kind === 'interactive' ? 1 : 2),
      materialize: async (result) => {
        const marker = new Uint8Array(result.buffer)[0] ?? 0;
        if (marker === 1) {
          interactiveMaterializing.resolve();
          await releaseInteractiveMaterialization.promise;
          return { value: { marker, url: 'blob:interactive-patch' } };
        }
        return { value: { marker } };
      },
      onEffects: (effects) => {
        for (const effect of effects) {
          if (effect.type === 'release-url') coordinatorReleases.push(effect.url);
        }
      },
      onPresented: ({ marker }) => presented.push(marker),
      releaseMaterialized: ({ value }) => {
        if (value.url !== undefined) materializedReleases.push(value.url);
      },
    });
    const request = buildRequest();

    runner.request(buildRequest({ kind: 'interactive', snapshot: request.snapshot }));
    await interactiveMaterializing.promise;
    runner.request(buildRequest({ kind: 'settled', snapshot: request.snapshot }));
    await tick();
    await tick();
    releaseInteractiveMaterialization.resolve();
    await tick();
    await tick();

    expect(presented).toEqual([2]);
    expect(materializedReleases).toEqual(['blob:interactive-patch']);
    expect(coordinatorReleases).toEqual([]);
  });

  test('preview presentation remains independent from a concurrent persistence failure', async () => {
    const persistenceFailures: string[] = [];
    const persistence = new EditorPersistenceEffectRunner({
      execute: async () => {
        throw new Error('sidecar unavailable');
      },
      onAccepted: () => {},
      onCurrentFailure: (error) => persistenceFailures.push(String(error)),
      onSnapshot: () => {},
      setTimer: (callback) => setTimeout(callback, 0),
    });
    const presented: number[] = [];
    const preview = harness<number>({
      execute: async () => execution(7),
      onPresented: (value) => presented.push(value),
    });

    const persistenceInput = {
      adjustmentRevision: 2,
      adjustments: { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 1 },
      editDocumentV2: legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 1 }),
      imageSessionId: 'session-a',
      interactionActive: false,
      multiSelection: null,
      path: '/fixtures/a.raw',
      receipt: {
        adjustmentRevision: 2,
        baseAdjustmentRevision: 1,
        changedKeys: ['exposure'],
        imageSessionId: 'session-a',
        persistence: 'commit' as const,
        source: 'manual-control' as const,
        transactionId: 'persistence-failure-2',
      },
      sessionGeneration: 1,
    };
    persistence.installSession({
      ...persistenceInput,
      adjustmentRevision: 0,
      adjustments: structuredClone(INITIAL_ADJUSTMENTS),
      editDocumentV2: legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS),
    });
    persistence.submitCommitted(persistenceInput);
    preview.runner.request(buildRequest());
    await tick();

    expect(persistenceFailures).toEqual(['Error: sidecar unavailable']);
    expect(presented).toEqual([7]);
  });
});
