import { describe, expect, test } from 'bun:test';

import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  EditorPersistenceEffectRunner,
  type EditorPersistenceExecution,
  type EditorPersistenceInput,
  type EditorPersistenceReceipt,
  editorPersistenceReceiptArraySchema,
  editorPersistenceReceiptSchema,
} from '../../../src/utils/editorPersistenceEffectRunner';
import type { EditApplicationReceipt } from '../../../src/utils/editTransaction';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

class FakeClock {
  private nextId = 1;
  private now = 0;
  private readonly tasks = new Map<number, { callback: () => void; due: number }>();

  clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
    this.tasks.delete(Number(timer));
  };

  setTimer = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.tasks.set(id, { callback, due: this.now + delayMs });
    return id;
  };

  advance(delayMs: number): void {
    this.now += delayMs;
    const ready = [...this.tasks.entries()]
      .filter(([, task]) => task.due <= this.now)
      .sort((left, right) => left[1].due - right[1].due || left[0] - right[0]);
    for (const [id, task] of ready) {
      this.tasks.delete(id);
      task.callback();
    }
  }

  pending(): number {
    return this.tasks.size;
  }
}

const adjustments = (exposure: number) => ({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure });

const receipt = (path: string, revision = 1): EditorPersistenceReceipt => ({
  path,
  sidecarRevision: `sha256:${String(revision).padStart(64, '0')}`,
});

const editReceipt = (
  imageSessionId: string,
  adjustmentRevision: number,
  persistence: EditApplicationReceipt['persistence'] = 'commit',
): EditApplicationReceipt => ({
  adjustmentRevision,
  baseAdjustmentRevision: adjustmentRevision - 1,
  changedKeys: ['exposure'],
  imageSessionId,
  persistence,
  source: 'manual-control',
  transactionId: `transaction-${imageSessionId}-${String(adjustmentRevision)}`,
});

const input = (overrides: Partial<EditorPersistenceInput> = {}): EditorPersistenceInput => ({
  adjustmentRevision: 1,
  adjustments: adjustments(1),
  baselineHint: { adjustments: adjustments(0), path: '/fixtures/a.raw' },
  imageSessionId: 'session-a',
  interactionActive: false,
  multiSelection: null,
  path: '/fixtures/a.raw',
  receipt: editReceipt('session-a', 1),
  sessionGeneration: 1,
  ...overrides,
});

function harness(
  execute: (value: EditorPersistenceExecution, signal: AbortSignal) => Promise<EditorPersistenceReceipt> = async (
    value,
  ) => receipt(value.path, value.revision),
) {
  const accepted: Array<{ execution: EditorPersistenceExecution; receipt: EditorPersistenceReceipt }> = [];
  const clock = new FakeClock();
  const failures: Array<{ error: unknown; execution: EditorPersistenceExecution }> = [];
  const snapshots: Array<{ adjustments: typeof INITIAL_ADJUSTMENTS; path: string }> = [];
  const runner = new EditorPersistenceEffectRunner({
    clearTimer: clock.clearTimer,
    execute,
    onAccepted: (execution, result) => accepted.push({ execution, receipt: result }),
    onCurrentFailure: (error, execution) => failures.push({ error, execution }),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    setTimer: clock.setTimer,
  });
  return { accepted, clock, failures, runner, snapshots };
}

describe('editor persistence effect runner', () => {
  test('accepts native receipt envelopes for primary and multi-selection saves', () => {
    const nativeReceipt = {
      adjustments: adjustments(1),
      adjustmentRevision: 1,
      catalogRevision: null,
      imageId: 'path:a',
      imageSessionId: 'session-a',
      path: '/fixtures/a.raw',
      renderFingerprint: 42,
      sidecarRevision: `sha256:${'a'.repeat(64)}`,
      thumbnailRevision: `sha256:${'b'.repeat(64)}`,
      transactionId: 'transaction-a-1',
    };

    expect(editorPersistenceReceiptSchema.parse(nativeReceipt)).toEqual({
      path: nativeReceipt.path,
      sidecarRevision: nativeReceipt.sidecarRevision,
    });
    expect(editorPersistenceReceiptArraySchema.parse([nativeReceipt])).toEqual([
      { path: nativeReceipt.path, sidecarRevision: nativeReceipt.sidecarRevision },
    ]);
  });

  test('primes a session without writing and skips an unchanged snapshot', () => {
    let executions = 0;
    const { clock, runner, snapshots } = harness(async (value) => {
      executions += 1;
      return receipt(value.path);
    });
    const primed = input({ baselineHint: null });

    runner.submit(primed);
    runner.submit({ ...primed, baselineHint: { adjustments: primed.adjustments, path: primed.path } });
    clock.advance(100);

    expect(executions).toBe(0);
    expect(snapshots).toEqual([{ adjustments: primed.adjustments, path: primed.path }]);
  });

  test('uses fake time and waits until interaction settles', async () => {
    const executions: EditorPersistenceExecution[] = [];
    const { accepted, clock, runner } = harness(async (value) => {
      executions.push(value);
      return receipt(value.path);
    });

    runner.submit(input({ interactionActive: true }));
    expect(clock.pending()).toBe(0);
    runner.submit(input({ interactionActive: false }));
    clock.advance(49);
    expect(executions).toHaveLength(0);
    clock.advance(1);
    await flush();

    expect(executions).toHaveLength(1);
    expect(accepted).toHaveLength(1);
  });

  test('passes transaction authority only for an exact receipt and skips native-committed work', async () => {
    const executions: EditorPersistenceExecution[] = [];
    const { clock, runner, snapshots } = harness(async (value) => {
      executions.push(value);
      return receipt(value.path);
    });

    runner.submit(input({ receipt: editReceipt('stale-session', 1) }), 0);
    clock.advance(0);
    await flush();
    expect(executions[0]?.transaction).toBeUndefined();

    runner.submit(
      input({
        adjustmentRevision: 2,
        adjustments: adjustments(2),
        receipt: editReceipt('session-a', 2),
      }),
      0,
    );
    clock.advance(0);
    await flush();
    expect(executions[1]?.transaction).toEqual({
      baseAdjustmentRevision: 1,
      imageSessionId: 'session-a',
      nextAdjustmentRevision: 2,
      transactionId: 'transaction-session-a-2',
    });

    runner.submit(
      input({
        adjustmentRevision: 3,
        adjustments: adjustments(3),
        receipt: editReceipt('session-a', 3, 'native-committed'),
      }),
    );
    clock.advance(100);
    expect(executions).toHaveLength(2);
    expect(snapshots.at(-1)).toEqual({ adjustments: adjustments(3), path: '/fixtures/a.raw' });
  });

  test('reversed revision completions publish only the newest save', async () => {
    const first = deferred<EditorPersistenceReceipt>();
    const second = deferred<EditorPersistenceReceipt>();
    const pending = [first.promise, second.promise];
    const signals: AbortSignal[] = [];
    const { accepted, clock, failures, runner, snapshots } = harness(async (_value, signal) => {
      signals.push(signal);
      return pending.shift() ?? Promise.reject(new Error('unexpected execution'));
    });

    runner.submit(input(), 0);
    clock.advance(0);
    runner.submit(
      input({ adjustmentRevision: 2, adjustments: adjustments(2), receipt: editReceipt('session-a', 2) }),
      0,
    );
    clock.advance(0);
    expect(signals[0]?.aborted).toBe(true);

    second.resolve(receipt('/fixtures/a.raw', 2));
    await flush();
    first.resolve(receipt('/fixtures/a.raw', 1));
    await flush();

    expect(accepted.map(({ execution }) => execution.revision)).toEqual([2]);
    expect(failures).toHaveLength(0);
    expect(snapshots.at(-1)).toEqual({ adjustments: adjustments(2), path: '/fixtures/a.raw' });
  });

  test('A to B to successor-A rejects stale success and failure', async () => {
    const firstA = deferred<EditorPersistenceReceipt>();
    const b = deferred<EditorPersistenceReceipt>();
    const successorA = deferred<EditorPersistenceReceipt>();
    const pending = [firstA.promise, b.promise, successorA.promise];
    const { accepted, clock, failures, runner } = harness(
      async () => pending.shift() ?? Promise.reject(new Error('unexpected execution')),
    );

    runner.submit(input(), 0);
    clock.advance(0);
    runner.submit(
      input({
        baselineHint: { adjustments: adjustments(0), path: '/fixtures/b.raw' },
        imageSessionId: 'session-b',
        path: '/fixtures/b.raw',
        receipt: editReceipt('session-b', 1),
        sessionGeneration: 2,
      }),
      0,
    );
    clock.advance(0);
    runner.submit(
      input({
        imageSessionId: 'session-a-successor',
        receipt: editReceipt('session-a-successor', 1),
        sessionGeneration: 3,
      }),
      0,
    );
    clock.advance(0);

    firstA.reject(new Error('stale A failed'));
    b.resolve(receipt('/fixtures/b.raw'));
    successorA.resolve(receipt('/fixtures/a.raw', 3));
    await flush();

    expect(accepted.map(({ execution }) => execution.imageSessionId)).toEqual(['session-a-successor']);
    expect(failures).toHaveLength(0);
  });

  test('reports current failure, validates receipt identity, and permits an exact retry', async () => {
    let attempts = 0;
    const { accepted, clock, failures, runner } = harness(async (value) => {
      attempts += 1;
      if (attempts === 1) throw new Error('disk full');
      if (attempts === 2) return receipt('/fixtures/wrong.raw');
      return receipt(value.path, attempts);
    });

    runner.submit(input(), 0);
    clock.advance(0);
    await flush();
    runner.submit(input(), 0);
    clock.advance(0);
    await flush();
    runner.submit(input(), 0);
    clock.advance(0);
    await flush();

    expect(failures.map(({ error }) => String(error))).toEqual([
      'Error: disk full',
      'Error: editor_persistence.receipt_path_mismatch:/fixtures/wrong.raw:/fixtures/a.raw',
    ]);
    expect(accepted).toHaveLength(1);
  });

  test('cancellation aborts running work and prevents queued execution', async () => {
    const running = deferred<EditorPersistenceReceipt>();
    let executions = 0;
    let signal: AbortSignal | null = null;
    const { accepted, clock, failures, runner } = harness(async (_value, nextSignal) => {
      executions += 1;
      signal = nextSignal;
      return running.promise;
    });

    runner.submit(input(), 25);
    runner.cancel();
    clock.advance(25);
    expect(executions).toBe(0);

    runner.submit(input(), 0);
    clock.advance(0);
    runner.cancel();
    expect(signal?.aborted).toBe(true);
    running.reject(new Error('cancelled'));
    await flush();
    expect(accepted).toHaveLength(0);
    expect(failures).toHaveLength(0);
  });

  test('a persistence barrier cancels queued work without aborting an already-running matching save', () => {
    const queued = harness();
    queued.runner.submit(input(), 50);
    queued.runner.cancelQueuedForBarrier();
    queued.clock.advance(50);
    expect(queued.accepted).toHaveLength(0);

    const running = harness(async (value, signal) => {
      expect(signal.aborted).toBe(false);
      return receipt(value.path);
    });
    running.runner.submit(input(), 0);
    running.clock.advance(0);
    running.runner.cancelQueuedForBarrier();
    expect(running.clock.pending()).toBe(0);
  });
});
