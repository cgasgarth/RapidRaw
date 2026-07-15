import { describe, expect, test } from 'bun:test';

import { PreviewCoordinator, type PreviewSessionIdentity } from '../../../src/utils/previewCoordinator';
import {
  PreviewInvalidationAdapter,
  type PreviewInvalidationToken,
} from '../../../src/utils/previewInvalidationAdapter';

const session = (overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity => ({
  adjustmentRevision: 1,
  backend: 'cpu',
  displayGeneration: 1,
  geometryRevision: 0,
  graphRevision: 'graph-1',
  imageSessionId: 1,
  maskRevision: 0,
  patchRevision: 0,
  proofRevision: 0,
  roiFingerprint: '[0,0,1,1]',
  sourceImagePath: '/fixtures/a.raw',
  sourceRevision: 1,
  targetHeight: 1200,
  targetWidth: 1200,
  viewportRevision: 1,
  ...overrides,
});

class FakeClock {
  private jobs: Array<{ callback: () => void; dueAt: number }> = [];
  private now = 0;

  advanceBy(durationMs: number): void {
    const end = this.now + durationMs;
    while (true) {
      this.jobs.sort((left, right) => left.dueAt - right.dueAt);
      const job = this.jobs[0];
      if (job === undefined || job.dueAt > end) break;
      this.jobs.shift();
      this.now = job.dueAt;
      job.callback();
    }
    this.now = end;
  }

  schedule(callback: () => void, delayMs: number): void {
    this.jobs.push({ callback, dueAt: this.now + delayMs });
  }
}

const harness = () => {
  const coordinator = new PreviewCoordinator();
  const adapter = new PreviewInvalidationAdapter({
    dispatch: (event) => coordinator.dispatch(event),
    getState: () => coordinator.snapshot(),
  });
  return { adapter, coordinator };
};

const required = (token: PreviewInvalidationToken | null): PreviewInvalidationToken => {
  if (token === null) throw new Error('Expected a preview invalidation token.');
  return token;
};

describe('preview invalidation adapter', () => {
  test('scope recovery is exactly once and delayed A to B to successor-A only renders the successor', () => {
    const { adapter } = harness();
    const clock = new FakeClock();
    const rendered: string[] = [];
    const firstA = session();
    const b = session({
      graphRevision: 'graph-b',
      imageSessionId: 2,
      sourceImagePath: '/fixtures/b.raw',
      sourceRevision: 2,
    });
    const successorA = session({ graphRevision: 'graph-successor-a', imageSessionId: 3, sourceRevision: 3 });

    adapter.installSession(firstA, 0);
    const firstAToken = required(adapter.requestScopeRecovery(1));
    expect(adapter.requestScopeRecovery(1)).toBeNull();
    clock.schedule(() => void adapter.consume(firstAToken, () => rendered.push('first-a')), 30);

    adapter.installSession(b, 0);
    const bToken = required(adapter.requestScopeRecovery(1));
    clock.schedule(() => void adapter.consume(bToken, () => rendered.push('b')), 20);

    adapter.installSession(successorA, 0);
    const successorAToken = required(adapter.requestScopeRecovery(1));
    clock.schedule(() => void adapter.consume(successorAToken, () => rendered.push('successor-a')), 10);
    clock.advanceBy(30);

    expect(rendered).toEqual(['successor-a']);
  });

  test('reordered display generations rerender only the newest exact generation', () => {
    const { adapter, coordinator } = harness();
    const clock = new FakeClock();
    const rendered: number[] = [];
    adapter.installSession(session(), 0);

    const generation2 = required(adapter.displayTargetChanged(2));
    const generation3 = required(adapter.displayTargetChanged(3));
    expect(adapter.displayTargetChanged(3)).toBeNull();
    expect(adapter.displayTargetChanged(2)).toBeNull();
    clock.schedule(() => void adapter.consume(generation2, () => rendered.push(2)), 20);
    clock.schedule(() => void adapter.consume(generation3, () => rendered.push(3)), 10);
    clock.advanceBy(20);

    expect(rendered).toEqual([3]);
    expect(coordinator.snapshot().displayGeneration).toBe(3);
  });

  test('an exact graph revision change rejects a delayed recovery token without losing the next retry', () => {
    const { adapter } = harness();
    const rendered: string[] = [];
    adapter.installSession(session(), 0);
    const stale = required(adapter.requestScopeRecovery(1));

    adapter.installSession(session({ adjustmentRevision: 2, graphRevision: 'graph-2' }), 1);
    expect(adapter.consume(stale, () => rendered.push('stale'))).toBe(false);
    const current = required(adapter.requestScopeRecovery(2));
    expect(adapter.consume(current, (scopeRecovery) => rendered.push(scopeRecovery ? 'current' : 'wrong'))).toBe(true);
    expect(rendered).toEqual(['current']);
  });

  test('session cancellation clears recovery authority and prevents delayed consumption', () => {
    const { adapter, coordinator } = harness();
    adapter.installSession(session(), 0);
    const delayed = required(adapter.requestScopeRecovery(1));
    adapter.cancelSession('editor-unmounted');

    expect(adapter.consume(delayed, () => {})).toBe(false);
    expect(coordinator.snapshot().session).toBeNull();
  });
});
