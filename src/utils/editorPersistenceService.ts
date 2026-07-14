import type { Adjustments } from './adjustments';
import { EditorPersistenceAuthorityLedger, type EditorPersistenceAuthorityReceipt } from './editorPersistenceAuthority';

const ledger = new EditorPersistenceAuthorityLedger();
let cancelQueuedPersistence: (() => void) | null = null;

export const trackEditorPersistence = <T>(path: string, document: Adjustments, persistence: Promise<T>): Promise<T> =>
  ledger.track(path, document, persistence);

export const awaitMatchingEditorPersistence = (
  path: string,
  document: Adjustments,
): Promise<EditorPersistenceAuthorityReceipt | null> => ledger.receiptFor(path, document);

export const registerEditorPersistenceBarrierAdapter = (cancelQueued: () => void): (() => void) => {
  cancelQueuedPersistence = cancelQueued;
  return () => {
    if (cancelQueuedPersistence === cancelQueued) cancelQueuedPersistence = null;
  };
};

export const beginEditorPersistenceBarrier = (): void => {
  cancelQueuedPersistence?.();
};
