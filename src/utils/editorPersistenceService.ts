import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { EditorPersistenceAuthorityLedger, type EditorPersistenceAuthorityReceipt } from './editorPersistenceAuthority';

const ledger = new EditorPersistenceAuthorityLedger();
let cancelQueuedPersistence: (() => void) | null = null;

export const trackEditorPersistence = <T>(
  path: string,
  document: EditDocumentV2,
  persistence: Promise<T>,
): Promise<T> => ledger.track(path, document, persistence);

export const awaitMatchingEditorPersistence = (
  path: string,
  document: EditDocumentV2,
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
