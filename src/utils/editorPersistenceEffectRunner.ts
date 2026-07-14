import { z } from 'zod';
import { Invokes } from '../tauri/commands';
import type { Adjustments } from './adjustments';
import { areAdjustmentsEqual } from './adjustmentsSnapshot';
import { trackEditorPersistence } from './editorPersistenceService';
import type { EditApplicationReceipt, EditTransactionPersistenceContext } from './editTransaction';
import { invokeWithSchema } from './tauriSchemaInvoke';

export const editorPersistenceReceiptSchema = z.object({
  path: z.string().trim().min(1),
  sidecarRevision: z.string().trim().startsWith('sha256:'),
});

export const editorPersistenceReceiptArraySchema = z.array(editorPersistenceReceiptSchema);

export interface EditorPersistenceSnapshot {
  adjustments: Adjustments;
  path: string;
}

export interface EditorPersistenceInput {
  adjustmentRevision: number;
  adjustments: Adjustments;
  baselineHint: EditorPersistenceSnapshot | null;
  imageSessionId: string;
  interactionActive: boolean;
  multiSelection: {
    adjustments: Partial<Adjustments>;
    paths: readonly string[];
  } | null;
  path: string;
  receipt: EditApplicationReceipt | null;
  sessionGeneration: number;
}

export interface EditorPersistenceExecution {
  adjustments: Adjustments;
  authorityKey: string;
  imageSessionId: string;
  multiSelection: EditorPersistenceInput['multiSelection'];
  path: string;
  revision: number;
  transaction?: EditTransactionPersistenceContext;
}

export interface EditorPersistenceReceipt {
  path: string;
  sidecarRevision: string;
}

export type EditorPersistenceExecutor = (
  input: EditorPersistenceExecution,
  signal: AbortSignal,
) => Promise<EditorPersistenceReceipt>;

export interface EditorPersistenceEffectRunnerOptions {
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  execute?: EditorPersistenceExecutor;
  onAccepted: (input: EditorPersistenceExecution, receipt: EditorPersistenceReceipt) => void;
  onCurrentFailure?: (error: unknown, input: EditorPersistenceExecution) => void;
  onSnapshot: (snapshot: EditorPersistenceSnapshot) => void;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
}

const executeEditorPersistence: EditorPersistenceExecutor = async (input, signal) => {
  const receipt = await trackEditorPersistence(
    input.path,
    input.adjustments,
    invokeWithSchema(
      Invokes.SaveMetadataAndUpdateThumbnail,
      {
        adjustments: input.adjustments,
        path: input.path,
        ...(input.transaction === undefined ? {} : { transaction: input.transaction }),
      },
      editorPersistenceReceiptSchema,
    ),
  );
  if (receipt.path !== input.path) {
    throw new Error(`editor_persistence.receipt_path_mismatch:${receipt.path}:${input.path}`);
  }
  if (!signal.aborted && input.multiSelection !== null && input.multiSelection.paths.length > 0) {
    await invokeWithSchema(
      Invokes.ApplyAdjustmentsToPaths,
      { adjustments: input.multiSelection.adjustments, paths: input.multiSelection.paths },
      editorPersistenceReceiptArraySchema,
    );
  }
  return receipt;
};

/** Owns one editor session's persistence timer, native work, and stale-result authority. */
export class EditorPersistenceEffectRunner {
  private activeController: AbortController | null = null;
  private activeToken = 0;
  private baseline: EditorPersistenceSnapshot | null = null;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private disposed = false;
  private readonly execute: EditorPersistenceExecutor;
  private readonly onAccepted: EditorPersistenceEffectRunnerOptions['onAccepted'];
  private readonly onCurrentFailure: NonNullable<EditorPersistenceEffectRunnerOptions['onCurrentFailure']>;
  private readonly onSnapshot: EditorPersistenceEffectRunnerOptions['onSnapshot'];
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private sessionKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: EditorPersistenceEffectRunnerOptions) {
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
    this.execute = options.execute ?? executeEditorPersistence;
    this.onAccepted = options.onAccepted;
    this.onCurrentFailure = options.onCurrentFailure ?? (() => {});
    this.onSnapshot = options.onSnapshot;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  }

  submit(input: EditorPersistenceInput, delayMs = 50): void {
    if (this.disposed) throw new Error('Editor persistence runner is disposed.');
    const nextSessionKey = `${String(input.sessionGeneration)}:${input.imageSessionId}:${input.path}`;
    if (this.sessionKey !== nextSessionKey) {
      this.cancelPending();
      this.activeToken += 1;
      this.sessionKey = nextSessionKey;
      this.baseline = input.baselineHint?.path === input.path ? input.baselineHint : null;
    } else if (input.baselineHint?.path === input.path && this.baseline === null) {
      this.baseline = input.baselineHint;
    }

    if (this.baseline === null) {
      this.publishSnapshot(input.path, input.adjustments);
      return;
    }
    if (areAdjustmentsEqual(this.baseline.adjustments, input.adjustments)) return;

    this.cancelPending();
    this.activeToken += 1;
    if (input.interactionActive) return;
    const receipt =
      input.receipt?.imageSessionId === input.imageSessionId &&
      input.receipt.adjustmentRevision === input.adjustmentRevision
        ? input.receipt
        : null;
    if (receipt?.persistence === 'native-committed') {
      this.publishSnapshot(input.path, input.adjustments);
      return;
    }
    const token = this.activeToken;
    const execution: EditorPersistenceExecution = {
      adjustments: input.adjustments,
      authorityKey: nextSessionKey,
      imageSessionId: input.imageSessionId,
      multiSelection: input.multiSelection,
      path: input.path,
      revision: input.adjustmentRevision,
      ...(receipt === null
        ? {}
        : {
            transaction: {
              baseAdjustmentRevision: receipt.baseAdjustmentRevision,
              imageSessionId: receipt.imageSessionId,
              nextAdjustmentRevision: receipt.adjustmentRevision,
              transactionId: receipt.transactionId,
            },
          }),
    };
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        void this.executeCurrent(execution, token);
      },
      Math.max(0, delayMs),
    );
  }

  cancel(): void {
    this.cancelPending();
    this.activeToken += 1;
    this.sessionKey = null;
    this.baseline = null;
  }

  cancelQueuedForBarrier(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
    this.activeToken += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private cancelPending(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.activeController?.abort();
    this.activeController = null;
  }

  private current(token: number, execution: EditorPersistenceExecution): boolean {
    return token === this.activeToken && this.sessionKey === execution.authorityKey;
  }

  private async executeCurrent(execution: EditorPersistenceExecution, token: number): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;
    try {
      const receipt = await this.execute(execution, controller.signal);
      if (!this.current(token, execution)) return;
      if (receipt.path !== execution.path) {
        throw new Error(`editor_persistence.receipt_path_mismatch:${receipt.path}:${execution.path}`);
      }
      this.publishSnapshot(execution.path, execution.adjustments);
      this.onAccepted(execution, receipt);
    } catch (error) {
      if (this.current(token, execution)) this.onCurrentFailure(error, execution);
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  private publishSnapshot(path: string, adjustments: Adjustments): void {
    this.baseline = { adjustments, path };
    this.onSnapshot(this.baseline);
  }
}
