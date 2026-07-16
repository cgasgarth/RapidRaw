import { describe, expect, test } from 'bun:test';

import { ExportColorProfile, ExportRenderingIntent } from '../../../src/components/ui/ExportImportProperties';
import type { PreviewQualityDecision } from '../../../src/utils/adaptivePreviewQuality';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import type { EditedPreviewRequest } from '../../../src/utils/editedPreviewEffectRunner';
import { PreviewCoordinator, type PreviewOperationIdentity } from '../../../src/utils/previewCoordinator';
import { PreviewInteractionSchedulingEffectRunner } from '../../../src/utils/previewInteractionSchedulingEffectRunner';
import {
  PreviewRequestIntentAdapter,
  type PreviewRequestPendingUpdate,
} from '../../../src/utils/previewRequestIntentAdapter';
import {
  PreviewRequestScopeAdapter,
  type PreviewRequestScopeInput,
} from '../../../src/utils/previewRequestScopeAdapter';

const source = (path: string, imageSessionId: number): PreviewRequestScopeInput => ({
  adjustmentRevision: 1,
  adjustmentSnapshot: publishAdjustmentSnapshot(null, createDefaultEditDocumentV2()),
  autoEditPreviewSession: null,
  baseRenderSize: { containerHeight: 800, containerWidth: 1200, height: 800, offsetX: 0, offsetY: 0, width: 1200 },
  basicToneSliderInteraction: null,
  finalPreviewUrl: `blob:${path}`,
  hasRenderedFirstFrame: false,
  imageSession: { id: `session:${String(imageSessionId)}:${path}` },
  imageSessionId,
  previewViewportTransform: { positionX: 0, positionY: 0, scale: 1 },
  proofRevision: 1,
  referenceMatchPreview: null,
  selectedImage: { isReady: true, path, thumbnailUrl: `blob:thumb:${path}` },
  settings: { editorPreviewResolution: 1200, enableZoomHifi: true, useWgpuRenderer: false },
  zoomMode: { kind: 'fit' },
});

const quality = (overrides: Partial<PreviewQualityDecision> = {}): PreviewQualityDecision => ({
  backend: 'cpu',
  effectiveRoi: null,
  effectiveTargetResolution: 1200,
  estimatedWorkingBytes: 1,
  limitedBy: null,
  reason: 'settled viewport',
  requestedTargetResolution: 1200,
  sufficientForSemanticZoom: true,
  tier: 'settled_full',
  ...overrides,
});

class FakeClock {
  private jobs: Array<{ at: number; callback: () => void }> = [];

  schedule(at: number, callback: () => void): void {
    this.jobs.push({ at, callback });
  }

  run(): void {
    this.jobs.sort((left, right) => left.at - right.at);
    for (const job of this.jobs) job.callback();
  }
}

const harness = () => {
  const coordinator = new PreviewCoordinator();
  const scopeAdapter = new PreviewRequestScopeAdapter({ getDisplayGeneration: () => 1 });
  const scheduled: Array<{
    causalGeneration?: number;
    delayMs: number;
    identity: PreviewOperationIdentity;
    request: EditedPreviewRequest;
  }> = [];
  const updates: PreviewRequestPendingUpdate[] = [];
  let currentSource = source('/fixtures/a.raw', 1);
  let currentQuality = quality();
  let now = 100;
  const adapter = new PreviewRequestIntentAdapter({
    captureScope: (targetResolution, roi) => scopeAdapter.capture(currentSource, targetResolution, roi, 2),
    decideQuality: () => currentQuality,
    dispatch: (event) => void coordinator.dispatch(event),
    installSession: (scope) => void coordinator.dispatch({ session: scope.session, type: 'image-session-installed' }),
    now: () => now,
    publish: (update) => updates.push(update),
    schedule: (request, delayMs, causalGeneration) => {
      const queued = coordinator.dispatch({
        ...(causalGeneration === undefined ? {} : { causalGeneration }),
        identity: request.session,
        kind: request.kind,
        reason: 'intent-test',
        type: 'render-inputs-changed',
      });
      const identity = queued.state[request.kind].identity;
      if (identity === undefined) throw new Error('Expected a scheduled preview identity.');
      coordinator.dispatch({ identity, type: 'operation-started' });
      scheduled.push({ ...(causalGeneration === undefined ? {} : { causalGeneration }), delayMs, identity, request });
      return identity;
    },
  });
  return {
    adapter,
    coordinator,
    scheduled,
    setNow: (value: number) => {
      now = value;
    },
    setQuality: (value: PreviewQualityDecision) => {
      currentQuality = value;
    },
    setSource: (value: PreviewRequestScopeInput) => {
      currentSource = value;
    },
    updates,
  };
};

describe('preview request intent adapter', () => {
  test('preparing an immutable intent has no scheduling or publication side effects', () => {
    const { adapter, coordinator, scheduled, updates } = harness();
    const before = coordinator.snapshot();
    const prepared = adapter.prepare({
      activeWaveformChannel: null,
      delayMs: 75,
      dragging: false,
      isWaveformVisible: false,
      proofRecipe: null,
      requestedTargetResolution: 1200,
      scopeRecovery: false,
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.delayMs).toBe(75);
    expect(prepared?.request.computeWaveform).toBe(false);
    expect(scheduled).toEqual([]);
    expect(updates).toEqual([]);
    expect(coordinator.snapshot()).toEqual(before);

    if (prepared === null) throw new Error('Expected a prepared preview intent.');
    const identity = adapter.schedulePrepared(prepared, 25);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(25);
    expect(updates[0]?.previewQualityStatus.requestId).toBe(identity.operationId);
  });

  test('executes coordinator-issued schedules with their exact causal generation', () => {
    const { adapter, coordinator, scheduled } = harness();
    const prepared = adapter.prepare({
      activeWaveformChannel: null,
      delayMs: 0,
      dragging: true,
      isWaveformVisible: false,
      proofRecipe: null,
      requestedTargetResolution: 1200,
      scopeRecovery: false,
    });
    if (prepared === null) throw new Error('Expected prepared interaction intent.');
    const scheduling = coordinator.dispatch({
      inputs: {
        compareActive: false,
        devicePixelRatio: 2,
        displayHeight: 800,
        displayWidth: 1200,
        edited: prepared,
        enableLivePreviews: true,
        original: null,
        ready: true,
      },
      type: 'scheduling-inputs-changed',
    });
    const runner = new PreviewInteractionSchedulingEffectRunner({
      schedule: (intent, delayMs, causalGeneration) => adapter.schedulePrepared(intent, delayMs, causalGeneration),
    });

    const identities = runner.consume(scheduling.effects);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ causalGeneration: 2, delayMs: 0 });
    expect(identities[0]?.generation).toBe(2);
    expect(coordinator.snapshot().interactionGeneration).toBe(2);
  });

  test('settled intent captures one exact scope, proof recipe, and pending receipt', () => {
    const { adapter, coordinator, scheduled, setNow, updates } = harness();
    setNow(321);
    const identity = adapter.request({
      activeWaveformChannel: 'rgb',
      delayMs: 50,
      dragging: false,
      isWaveformVisible: true,
      proofRecipe: {
        blackPointCompensation: true,
        colorProfile: ExportColorProfile.DisplayP3,
        id: 'proof-p3',
        renderingIntent: ExportRenderingIntent.Perceptual,
      },
      requestedTargetResolution: 1199.6,
      scopeRecovery: false,
    });

    expect(identity).not.toBeNull();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      delayMs: 50,
      request: {
        computeWaveform: true,
        createdAt: 321,
        kind: 'settled',
        proof: {
          blackPointCompensation: true,
          colorProfile: ExportColorProfile.DisplayP3,
          exportSoftProofRecipeId: 'proof-p3',
          renderingIntent: ExportRenderingIntent.Perceptual,
        },
        targetResolution: 1200,
      },
    });
    expect(updates[0]).toMatchObject({
      previewQualityStatus: { phase: 'refining_current_view', requestId: identity?.operationId },
      requestedPreviewResolution: 1200,
    });
    expect(coordinator.snapshot().quality?.effectiveTargetResolution).toBe(1200);
  });

  test('interactive intent suppresses proof, enables recovery scopes, and uses effective ROI', () => {
    const { adapter, scheduled, setQuality, updates } = harness();
    setQuality(
      quality({
        effectiveRoi: [0.1, 0.2, 0.5, 0.4],
        effectiveTargetResolution: 900,
        requestedTargetResolution: 1600,
        tier: 'interaction_balanced',
      }),
    );
    adapter.request({
      activeWaveformChannel: null,
      delayMs: -10,
      dragging: true,
      isWaveformVisible: false,
      proofRecipe: { id: 'ignored-during-drag' },
      requestedTargetResolution: 1600,
      scopeRecovery: true,
    });

    expect(scheduled[0]).toMatchObject({
      delayMs: 0,
      request: {
        computeWaveform: true,
        kind: 'interactive',
        proof: null,
        roi: [0.1, 0.2, 0.5, 0.4],
        scopeRecovery: true,
        targetResolution: 900,
      },
    });
    expect(updates[0]?.requestedPreviewResolution).toBeUndefined();
    expect(updates[0]?.previewQualityStatus.phase).toBe('rendering_interaction');
  });

  test('fake-time A to B to successor-A completions publish only the exact successor intent', () => {
    const { adapter, coordinator, scheduled, setSource } = harness();
    const request = () =>
      adapter.request({
        activeWaveformChannel: null,
        delayMs: 0,
        dragging: false,
        isWaveformVisible: false,
        proofRecipe: null,
        requestedTargetResolution: 1200,
        scopeRecovery: false,
      });
    request();
    setSource(source('/fixtures/b.raw', 2));
    request();
    setSource(source('/fixtures/a.raw', 3));
    request();
    const [firstA, b, successorA] = scheduled.map(({ identity }) => identity);
    if (firstA === undefined || b === undefined || successorA === undefined) throw new Error('Missing identities.');
    const published: string[] = [];
    const complete = (identity: PreviewOperationIdentity, url: string) => {
      const transition = coordinator.dispatch({ artifact: { identity, url }, identity, type: 'operation-completed' });
      published.push(
        ...transition.effects.filter((effect) => effect.type === 'publish').map((effect) => effect.artifact.url),
      );
    };
    const clock = new FakeClock();
    clock.schedule(10, () => complete(successorA, 'blob:successor-a'));
    clock.schedule(20, () => complete(b, 'blob:b'));
    clock.schedule(30, () => complete(firstA, 'blob:first-a'));
    clock.run();

    expect(published).toEqual(['blob:successor-a']);
    expect(coordinator.snapshot().staleCompletionCount).toBe(2);
  });
});
