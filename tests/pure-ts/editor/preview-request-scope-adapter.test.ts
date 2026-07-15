import { describe, expect, test } from 'bun:test';

import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  PreviewCoordinator,
  type PreviewCoordinatorEffect,
  type PreviewOperationIdentity,
} from '../../../src/utils/previewCoordinator';
import {
  PreviewRequestScopeAdapter,
  type PreviewRequestScopeInput,
  type PreviewRequestScopeSnapshot,
} from '../../../src/utils/previewRequestScopeAdapter';

const input = (path: string, imageSessionId: number): PreviewRequestScopeInput => ({
  adjustmentRevision: 0,
  adjustmentSnapshot: publishAdjustmentSnapshot(null, structuredClone(INITIAL_ADJUSTMENTS)),
  autoEditPreviewSession: null,
  baseRenderSize: { containerHeight: 800, containerWidth: 1200, height: 800, offsetX: 0, offsetY: 0, width: 1200 },
  basicToneSliderInteraction: null,
  finalPreviewUrl: `blob:${path}`,
  hasRenderedFirstFrame: false,
  imageSession: { id: `editor-image-session:${String(imageSessionId)}:${path}` },
  imageSessionId,
  previewViewportTransform: { positionX: 0, positionY: 0, scale: 1 },
  proofRevision: 1,
  referenceMatchPreview: null,
  selectedImage: { isReady: true, path, thumbnailUrl: `blob:thumb:${path}` },
  settings: { editorPreviewResolution: 1200, enableZoomHifi: true, useWgpuRenderer: false },
  zoomMode: { kind: 'fit' },
});

const requiredCapture = (
  adapter: PreviewRequestScopeAdapter,
  value: PreviewRequestScopeInput,
): PreviewRequestScopeSnapshot => {
  const capture = adapter.capture(value, 1200, null, 2);
  if (capture === null) throw new Error('Expected a request scope capture.');
  return capture;
};

class FakeClock {
  private tasks: Array<{ at: number; run: () => void }> = [];

  schedule(at: number, run: () => void): void {
    this.tasks.push({ at, run });
  }

  advanceTo(now: number): void {
    const ready = this.tasks.filter(({ at }) => at <= now).sort((left, right) => left.at - right.at);
    this.tasks = this.tasks.filter(({ at }) => at > now);
    for (const task of ready) task.run();
  }
}

describe('preview request scope adapter', () => {
  test('captures one immutable schema-owned scope and exact display/viewport identity', () => {
    let displayGeneration = 4;
    const adapter = new PreviewRequestScopeAdapter({ getDisplayGeneration: () => displayGeneration });
    const source = input('/fixtures/a.raw', 7);
    const first = requiredCapture(adapter, source);
    displayGeneration = 5;
    const second = requiredCapture(adapter, {
      ...source,
      previewViewportTransform: { positionX: 0.2, positionY: 0, scale: 2 },
    });

    expect(first.session).toMatchObject({
      displayGeneration: 4,
      imageSessionId: 7,
      sourceImagePath: '/fixtures/a.raw',
      sourceRevision: 7,
      targetHeight: 1200,
      targetWidth: 1200,
    });
    expect(first.scope.graphIdentity).toBe(first.session.graphRevision);
    expect(first.viewport.coordinator.revision).toBe(first.session.viewportRevision);
    expect(second.session.displayGeneration).toBe(5);
    expect(second.session.viewportRevision).toBeGreaterThan(first.session.viewportRevision);
    expect(first.session.displayGeneration).toBe(4);
  });

  test('fake-time A to B to successor-A completions publish only the exact successor operation', () => {
    const adapter = new PreviewRequestScopeAdapter({ getDisplayGeneration: () => 1 });
    const coordinator = new PreviewCoordinator();
    const effects: PreviewCoordinatorEffect[] = [];
    const request = (capture: PreviewRequestScopeSnapshot): PreviewOperationIdentity => {
      effects.push(...coordinator.dispatch({ session: capture.session, type: 'image-session-installed' }).effects);
      const transition = coordinator.dispatch({
        identity: capture.session,
        kind: 'settled',
        reason: 'adapter-test',
        type: 'render-inputs-changed',
      });
      effects.push(...transition.effects);
      const identity = transition.state.settled.identity;
      if (identity === undefined) throw new Error('Expected a settled operation identity.');
      return identity;
    };
    const firstA = request(requiredCapture(adapter, input('/fixtures/a.raw', 1)));
    const b = request(requiredCapture(adapter, input('/fixtures/b.raw', 2)));
    const successorA = request(requiredCapture(adapter, input('/fixtures/a.raw', 3)));
    const published: string[] = [];
    const complete = (identity: PreviewOperationIdentity, url: string) => {
      const transition = coordinator.dispatch({ artifact: { identity, url }, identity, type: 'operation-completed' });
      published.push(
        ...transition.effects.filter((effect) => effect.type === 'publish').map(({ artifact }) => artifact.url),
      );
    };
    const clock = new FakeClock();
    clock.schedule(10, () => complete(successorA, 'blob:successor-a'));
    clock.schedule(20, () => complete(b, 'blob:b'));
    clock.schedule(30, () => complete(firstA, 'blob:first-a'));
    clock.advanceTo(30);

    expect(published).toEqual(['blob:successor-a']);
    expect(coordinator.snapshot()).toMatchObject({
      staleCompletionCount: 2,
      visibleArtifact: { identity: successorA, url: 'blob:successor-a' },
    });
    expect(effects.filter((effect) => effect.type === 'start')).toHaveLength(3);
  });
});
