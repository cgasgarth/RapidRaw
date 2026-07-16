import { describe, expect, test } from 'bun:test';

import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
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
  private readonly tasks = new Map<
    ReturnType<typeof setTimeout>,
    { callback: () => void; due: number; order: number }
  >();

  clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
    clearTimeout(timer);
    this.tasks.delete(timer);
  };

  setTimer = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const order = this.nextId++;
    const timer = setTimeout(() => {}, 2_147_483_647);
    this.tasks.set(timer, { callback, due: this.now + delayMs, order });
    return timer;
  };

  advance(delayMs: number): void {
    this.now += delayMs;
    const ready = [...this.tasks.entries()]
      .filter(([, task]) => task.due <= this.now)
      .sort((left, right) => left[1].due - right[1].due || left[1].order - right[1].order);
    for (const [timer, task] of ready) {
      clearTimeout(timer);
      this.tasks.delete(timer);
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

const input = (overrides: Partial<EditorPersistenceInput> = {}): EditorPersistenceInput => {
  const { editDocumentV2, ...rest } = overrides;
  return {
    adjustmentRevision: 1,
    adjustments: adjustments(1),
    editDocumentV2: legacyAdjustmentsToEditDocumentV2(adjustments(1)),
    imageSessionId: 'session-a',
    interactionActive: false,
    multiSelection: null,
    path: '/fixtures/a.raw',
    receipt: editReceipt('session-a', 1),
    sessionGeneration: 1,
    ...rest,
    ...(editDocumentV2 === undefined ? {} : { editDocumentV2 }),
  };
};

const prime = (runner: EditorPersistenceEffectRunner, overrides: Partial<EditorPersistenceInput> = {}): void => {
  runner.installSession(
    input({
      adjustmentRevision: 0,
      adjustments: adjustments(0),
      ...overrides,
    }),
  );
};

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
    const nativeReceipt = editorPersistenceReceiptSchema.parse({
      adjustments: adjustments(1),
      adjustmentRevision: 1,
      catalogRevision: null,
      imageId: 'path:a',
      imageSessionId: 'session-a',
      path: '/fixtures/a.raw',
      renderFingerprint: 'u64:000000000000002a',
      sidecarRevision: `sha256:${'a'.repeat(64)}`,
      thumbnailRevision: 'b'.repeat(64),
      transactionId: 'transaction-a-1',
    });

    expect(editorPersistenceReceiptSchema.parse(nativeReceipt)).toEqual(nativeReceipt);
    expect(editorPersistenceReceiptArraySchema.parse([nativeReceipt])).toEqual([nativeReceipt]);
    expect(editorPersistenceReceiptSchema.safeParse({ ...nativeReceipt, unexpected: true }).success).toBe(false);
  });

  test('primes a session without writing and skips an unchanged snapshot', () => {
    let executions = 0;
    const { clock, runner, snapshots } = harness(async (value) => {
      executions += 1;
      return receipt(value.path);
    });
    const primed = input({ adjustmentRevision: 0, adjustments: adjustments(0) });

    runner.installSession(primed);
    runner.installSession(primed);
    clock.advance(100);

    expect(executions).toBe(0);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ adjustments: primed.adjustments, path: primed.path });
  });

  test('uses fake time and waits until interaction settles', async () => {
    const executions: EditorPersistenceExecution[] = [];
    const { accepted, clock, runner } = harness(async (value) => {
      executions.push(value);
      return receipt(value.path);
    });

    prime(runner);
    runner.submitCommitted(input({ interactionActive: true }));
    expect(clock.pending()).toBe(0);
    runner.submitCommitted(input({ interactionActive: false }));
    clock.advance(49);
    expect(executions).toHaveLength(0);
    clock.advance(1);
    await flush();

    expect(executions).toHaveLength(1);
    expect(accepted).toHaveLength(1);
  });

  test('owns the multi-selection baseline and projects every changed field for selected nodes', async () => {
    const executions: EditorPersistenceExecution[] = [];
    const { clock, runner } = harness(async (value) => {
      executions.push(value);
      return receipt(value.path);
    });
    prime(runner);
    runner.submitCommitted(
      input({
        adjustments: { ...adjustments(1), contrast: 25 },
        multiSelection: { paths: ['/fixtures/b.raw'], selectedNodeIds: ['scene_global_color_tone'] },
      }),
      0,
    );
    clock.advance(0);
    await flush();

    expect(executions[0]?.multiSelection).toEqual({
      adjustments: { contrast: 25, exposure: 1, referenceMatchApplicationReceipt: null },
      paths: ['/fixtures/b.raw'],
    });
  });

  test('rejects inferred snapshot work, requires exact transaction authority, and skips native-committed work', async () => {
    const executions: EditorPersistenceExecution[] = [];
    const { clock, runner, snapshots } = harness(async (value) => {
      executions.push(value);
      return receipt(value.path);
    });

    prime(runner);
    expect(runner.submitCommitted(input({ receipt: editReceipt('stale-session', 1) }), 0)).toBe(false);
    clock.advance(0);
    await flush();
    expect(executions).toHaveLength(0);

    expect(
      runner.submitCommitted(
        input({
          adjustmentRevision: 2,
          adjustments: adjustments(2),
          receipt: editReceipt('session-a', 2),
        }),
        0,
      ),
    ).toBe(true);
    clock.advance(0);
    await flush();
    expect(executions[0]?.transaction).toEqual({
      baseAdjustmentRevision: 1,
      imageSessionId: 'session-a',
      nextAdjustmentRevision: 2,
      transactionId: 'transaction-session-a-2',
    });

    runner.submitCommitted(
      input({
        adjustmentRevision: 3,
        adjustments: adjustments(3),
        receipt: editReceipt('session-a', 3, 'native-committed'),
      }),
    );
    clock.advance(100);
    expect(executions).toHaveLength(1);
    expect(snapshots.at(-1)).toMatchObject({ adjustments: adjustments(3), path: '/fixtures/a.raw' });
  });

  test('serializes revisions so a delayed predecessor cannot overwrite the newest sidecar', async () => {
    const first = deferred<EditorPersistenceReceipt>();
    const second = deferred<EditorPersistenceReceipt>();
    const pending = [first.promise, second.promise];
    const signals: AbortSignal[] = [];
    const { accepted, clock, failures, runner, snapshots } = harness(async (_value, signal) => {
      signals.push(signal);
      return pending.shift() ?? Promise.reject(new Error('unexpected execution'));
    });

    prime(runner);
    runner.submitCommitted(input(), 0);
    clock.advance(0);
    runner.submitCommitted(
      input({ adjustmentRevision: 2, adjustments: adjustments(2), receipt: editReceipt('session-a', 2) }),
      0,
    );
    clock.advance(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    first.resolve(receipt('/fixtures/a.raw', 1));
    await flush();
    clock.advance(0);
    expect(signals).toHaveLength(2);
    second.resolve(receipt('/fixtures/a.raw', 2));
    await flush();

    expect(accepted.map(({ execution }) => execution.revision)).toEqual([2]);
    expect(failures).toHaveLength(0);
    expect(snapshots.at(-1)).toMatchObject({ adjustments: adjustments(2), path: '/fixtures/a.raw' });
  });

  test('A to B to successor-A rejects stale success and failure', async () => {
    const firstA = deferred<EditorPersistenceReceipt>();
    const b = deferred<EditorPersistenceReceipt>();
    const successorA = deferred<EditorPersistenceReceipt>();
    const { accepted, clock, failures, runner } = harness(async (value) => {
      if (value.imageSessionId === 'session-a') return firstA.promise;
      if (value.imageSessionId === 'session-b') return b.promise;
      if (value.imageSessionId === 'session-a-successor') return successorA.promise;
      throw new Error('unexpected execution');
    });

    prime(runner);
    runner.submitCommitted(input(), 0);
    clock.advance(0);
    prime(runner, { imageSessionId: 'session-b', path: '/fixtures/b.raw', sessionGeneration: 2 });
    runner.submitCommitted(
      input({
        imageSessionId: 'session-b',
        path: '/fixtures/b.raw',
        receipt: editReceipt('session-b', 1),
        sessionGeneration: 2,
      }),
      0,
    );
    clock.advance(0);
    prime(runner, { imageSessionId: 'session-a-successor', sessionGeneration: 3 });
    runner.submitCommitted(
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
    await flush();
    clock.advance(0);
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

    prime(runner);
    runner.submitCommitted(input(), 0);
    clock.advance(0);
    await flush();
    runner.submitCommitted(input(), 0);
    clock.advance(0);
    await flush();
    runner.submitCommitted(input(), 0);
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
    const execution: { signal?: AbortSignal } = {};
    const { accepted, clock, failures, runner } = harness(async (_value, nextSignal) => {
      executions += 1;
      execution.signal = nextSignal;
      return running.promise;
    });

    prime(runner);
    runner.submitCommitted(input(), 25);
    runner.cancel();
    clock.advance(25);
    expect(executions).toBe(0);

    prime(runner);
    runner.submitCommitted(input(), 0);
    clock.advance(0);
    runner.cancel();
    expect(execution.signal?.aborted).toBe(true);
    running.reject(new Error('cancelled'));
    await flush();
    expect(accepted).toHaveLength(0);
    expect(failures).toHaveLength(0);
  });

  test('a persistence barrier cancels queued work without aborting an already-running matching save', () => {
    const queued = harness();
    prime(queued.runner);
    queued.runner.submitCommitted(input(), 50);
    queued.runner.cancelQueuedForBarrier();
    queued.clock.advance(50);
    expect(queued.accepted).toHaveLength(0);

    const running = harness(async (value, signal) => {
      expect(signal.aborted).toBe(false);
      return receipt(value.path);
    });
    prime(running.runner);
    running.runner.submitCommitted(input(), 0);
    running.clock.advance(0);
    running.runner.cancelQueuedForBarrier();
    expect(running.clock.pending()).toBe(0);
  });
});
