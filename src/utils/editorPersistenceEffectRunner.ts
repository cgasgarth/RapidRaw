import { z } from 'zod';
import {
  currentRenderEditDocumentV2Schema,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  type EditDocumentV2CopyPayload,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import { Invokes } from '../tauri/commands';
import type { Adjustments } from './adjustments';
import { areAdjustmentsEqual } from './adjustmentsSnapshot';
import { copyEditDocumentV2Nodes, prepareEditDocumentV2ForPersistence } from './editDocumentV2';
import { trackEditorPersistence } from './editorPersistenceService';
import type { EditApplicationReceipt, EditTransactionPersistenceContext } from './editTransaction';
import { invokeWithSchema } from './tauriSchemaInvoke';

export const editorPersistenceReceiptSchema = z
  .object({
    adjustmentRevision: z.number().int().nonnegative().nullish(),
    catalogRevision: z.number().int().nonnegative().nullish(),
    imageId: z.string().min(1),
    imageSessionId: z.string().min(1).nullish(),
    path: z.string().trim().min(1),
    renderFingerprint: z.string().regex(/^u64:[0-9a-f]{16}$/u),
    sidecarRevision: z.string().trim().startsWith('sha256:'),
    thumbnailRevision: z.string().regex(/^[0-9a-f]{64}$/u),
    transactionId: z.string().min(1).nullish(),
  })
  .strict();

export const editorPersistenceReceiptArraySchema = z.array(editorPersistenceReceiptSchema);

const editorPersistenceTransactionSchema = z
  .object({
    baseAdjustmentRevision: z.number().int().nonnegative(),
    imageSessionId: z.string().min(1),
    nextAdjustmentRevision: z.number().int().nonnegative(),
    transactionId: z.string().min(1),
  })
  .strict()
  .refine((transaction) => transaction.nextAdjustmentRevision > transaction.baseAdjustmentRevision, {
    message: 'nextAdjustmentRevision must advance baseAdjustmentRevision.',
  });

/** Exact frontend-to-native save boundary. No migration metadata or compatibility extensions may cross it. */
export const editorPersistenceRequestSchema = z
  .object({
    editDocumentV2: currentRenderEditDocumentV2Schema,
    path: z.string().trim().min(1),
    transaction: editorPersistenceTransactionSchema.nullable().optional(),
  })
  .strict();

export type EditorPersistenceRequest = z.infer<typeof editorPersistenceRequestSchema>;

export const buildEditorPersistenceRequest = (
  request: Omit<EditorPersistenceRequest, 'editDocumentV2'> & { editDocumentV2: EditDocumentV2 },
): EditorPersistenceRequest =>
  editorPersistenceRequestSchema.parse({
    ...request,
    editDocumentV2: prepareEditDocumentV2ForPersistence(request.editDocumentV2),
  });

export interface EditorPersistenceSnapshot {
  adjustments: Adjustments;
  editDocumentV2: EditDocumentV2;
  path: string;
}

export interface EditorPersistenceInput {
  adjustmentRevision: number;
  adjustments: Adjustments;
  editDocumentV2: EditDocumentV2;
  imageSessionId: string;
  interactionActive: boolean;
  multiSelection: {
    paths: readonly string[];
    selectedNodeIds: readonly EditDocumentNodeTypeV2[];
  } | null;
  path: string;
  receipt: EditApplicationReceipt;
  sessionGeneration: number;
}

export type EditorPersistenceSessionInput = Omit<
  EditorPersistenceInput,
  'interactionActive' | 'multiSelection' | 'receipt'
>;

export interface EditorPersistenceExecution {
  adjustments: Adjustments;
  editDocumentV2: EditDocumentV2;
  authorityKey: string;
  imageSessionId: string;
  multiSelection: {
    editDocumentV2: EditDocumentV2CopyPayload;
    paths: readonly string[];
  } | null;
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
  onSnapshot?: (snapshot: EditorPersistenceSnapshot) => void;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
}

const executeEditorPersistence: EditorPersistenceExecutor = async (input, signal) => {
  const request = buildEditorPersistenceRequest({
    editDocumentV2: input.editDocumentV2,
    path: input.path,
    ...(input.transaction === undefined ? {} : { transaction: input.transaction }),
  });
  const receipt = await trackEditorPersistence(
    input.path,
    input.adjustments,
    invokeWithSchema(Invokes.SaveMetadataAndUpdateThumbnail, request, editorPersistenceReceiptSchema),
  );
  if (receipt.path !== input.path) {
    throw new Error(`editor_persistence.receipt_path_mismatch:${receipt.path}:${input.path}`);
  }
  if (!signal.aborted && input.multiSelection !== null && input.multiSelection.paths.length > 0) {
    await invokeWithSchema(
      Invokes.ApplyAdjustmentsToPaths,
      { editDocumentV2: input.multiSelection.editDocumentV2, paths: input.multiSelection.paths },
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
  private readonly onSnapshot: NonNullable<EditorPersistenceEffectRunnerOptions['onSnapshot']>;
  private readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private queued: { delayMs: number; execution: EditorPersistenceExecution; token: number } | null = null;
  private sessionKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: EditorPersistenceEffectRunnerOptions) {
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
    this.execute = options.execute ?? executeEditorPersistence;
    this.onAccepted = options.onAccepted;
    this.onCurrentFailure = options.onCurrentFailure ?? (() => {});
    this.onSnapshot = options.onSnapshot ?? (() => {});
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  }

  installSession(input: EditorPersistenceSessionInput): void {
    if (this.disposed) throw new Error('Editor persistence runner is disposed.');
    const nextSessionKey = `${String(input.sessionGeneration)}:${input.imageSessionId}:${input.path}`;
    if (this.sessionKey === nextSessionKey) return;
    this.cancelPending();
    this.activeToken += 1;
    this.sessionKey = nextSessionKey;
    this.publishSnapshot(input.path, input.adjustments, input.editDocumentV2);
  }

  submitCommitted(input: EditorPersistenceInput, delayMs = 50): boolean {
    if (this.disposed) throw new Error('Editor persistence runner is disposed.');
    const nextSessionKey = `${String(input.sessionGeneration)}:${input.imageSessionId}:${input.path}`;
    if (
      this.sessionKey !== nextSessionKey ||
      this.baseline === null ||
      input.receipt.imageSessionId !== input.imageSessionId ||
      input.receipt.adjustmentRevision !== input.adjustmentRevision
    ) {
      return false;
    }
    if (
      areAdjustmentsEqual(this.baseline.adjustments, input.adjustments) &&
      this.baseline.editDocumentV2 === input.editDocumentV2
    )
      return true;

    this.cancelQueued();
    this.activeToken += 1;
    if (input.interactionActive) {
      this.activeController?.abort();
      return true;
    }
    const receipt = input.receipt;
    if (receipt.persistence === 'native-committed') {
      this.publishSnapshot(input.path, input.adjustments, input.editDocumentV2);
      return true;
    }
    const token = this.activeToken;
    const execution: EditorPersistenceExecution = {
      adjustments: input.adjustments,
      editDocumentV2: input.editDocumentV2,
      authorityKey: nextSessionKey,
      imageSessionId: input.imageSessionId,
      multiSelection: this.resolveMultiSelection(input),
      path: input.path,
      revision: input.adjustmentRevision,
      transaction: {
        baseAdjustmentRevision: receipt.baseAdjustmentRevision,
        imageSessionId: receipt.imageSessionId,
        nextAdjustmentRevision: receipt.adjustmentRevision,
        transactionId: receipt.transactionId,
      },
    };
    this.schedule(execution, token, delayMs);
    return true;
  }

  cancel(): void {
    this.cancelPending();
    this.activeToken += 1;
    this.sessionKey = null;
    this.baseline = null;
  }

  cancelQueuedForBarrier(): void {
    if (this.timer === null && this.queued === null) return;
    this.cancelQueued();
    this.activeToken += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private cancelPending(): void {
    this.cancelQueued();
    this.activeController?.abort();
  }

  private cancelQueued(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.queued = null;
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
      this.publishSnapshot(execution.path, execution.adjustments, execution.editDocumentV2);
      this.onAccepted(execution, receipt);
    } catch (error) {
      if (this.current(token, execution)) this.onCurrentFailure(error, execution);
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
        const queued = this.queued;
        this.queued = null;
        if (queued !== null && this.current(queued.token, queued.execution)) {
          this.schedule(queued.execution, queued.token, queued.delayMs);
        }
      }
    }
  }

  private schedule(execution: EditorPersistenceExecution, token: number, delayMs: number): void {
    if (this.activeController !== null) {
      this.queued = { delayMs, execution, token };
      return;
    }
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        void this.executeCurrent(execution, token);
      },
      Math.max(0, delayMs),
    );
  }

  private publishSnapshot(path: string, adjustments: Adjustments, editDocumentV2: EditDocumentV2): void {
    this.baseline = { adjustments, editDocumentV2, path };
    this.onSnapshot(this.baseline);
  }

  private resolveMultiSelection(input: EditorPersistenceInput): EditorPersistenceExecution['multiSelection'] {
    const request = input.multiSelection;
    if (request === null || this.baseline?.path !== input.path || request.paths.length === 0) return null;
    const changedNodeIds = request.selectedNodeIds.filter(
      (nodeType) =>
        JSON.stringify(input.editDocumentV2.nodes[nodeType]) !==
        JSON.stringify(this.baseline?.editDocumentV2.nodes[nodeType]),
    );
    if (changedNodeIds.length === 0) return null;
    return {
      editDocumentV2: copyEditDocumentV2Nodes(input.editDocumentV2, changedNodeIds),
      paths: request.paths,
    };
  }
}
