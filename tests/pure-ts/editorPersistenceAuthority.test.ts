import { describe, expect, test } from 'bun:test';

import { EditorPersistenceAuthorityLedger } from '../../src/utils/editorPersistenceAuthority';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
};

describe('editor persistence authority ledger', () => {
  test('retains exact per-path receipts across reverse completion order', async () => {
    const ledger = new EditorPersistenceAuthorityLedger();
    const selected = deferred<unknown>();
    const unrelated = deferred<unknown>();
    const selectedDocument = { contrast: 7, exposure: 0.55 };

    const selectedTracked = ledger.track('/fixtures/selected.raw', selectedDocument, selected.promise);
    const unrelatedTracked = ledger.track('/fixtures/other.raw', { exposure: -0.2 }, unrelated.promise);
    selected.resolve({ path: '/fixtures/selected.raw', sidecarRevision: `sha256:${'1'.repeat(64)}` });
    await selectedTracked;
    unrelated.resolve({ path: '/fixtures/other.raw', sidecarRevision: `sha256:${'2'.repeat(64)}` });
    await unrelatedTracked;

    await expect(ledger.receiptFor('/fixtures/selected.raw', { exposure: 0.55, contrast: 7 })).resolves.toEqual({
      path: '/fixtures/selected.raw',
      sidecarRevision: `sha256:${'1'.repeat(64)}`,
    });
  });

  test('does not reuse a receipt for a different canonical document', async () => {
    const ledger = new EditorPersistenceAuthorityLedger();
    await ledger.track(
      '/fixtures/selected.raw',
      { exposure: 0.55 },
      Promise.resolve({ path: '/fixtures/selected.raw', sidecarRevision: `sha256:${'3'.repeat(64)}` }),
    );

    await expect(ledger.receiptFor('/fixtures/selected.raw', { exposure: 0.8 })).resolves.toBeNull();
  });

  test('treats a failed pending save as a missing receipt so an immediate barrier save can retry', async () => {
    const ledger = new EditorPersistenceAuthorityLedger();
    const pending = deferred<unknown>();
    const tracked = ledger.track('/fixtures/selected.raw', { exposure: 0.55 }, pending.promise);

    pending.reject(new Error('disk unavailable'));
    await expect(tracked).rejects.toThrow('disk unavailable');
    await expect(ledger.receiptFor('/fixtures/selected.raw', { exposure: 0.55 })).resolves.toBeNull();
  });
});
