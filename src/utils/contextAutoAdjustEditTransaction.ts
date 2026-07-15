import { z } from 'zod';
import type { Adjustments } from './adjustments';
import { type AutoEditProposalBase, buildAutoEditTransactionRequest } from './autoEditTransaction';
import { mergeAutoEditAdjustments } from './autoEditWorkflow';
import { technicalWhiteBalanceSchema } from './color/whiteBalance';
import type { EditTransactionRequest } from './editTransaction';

const percentAdjustmentSchema = z.number().finite().min(-100).max(100);
const stopAdjustmentSchema = z.number().finite().min(-5).max(5);

export const contextAutoAdjustPatchSchema = z
  .object({
    blacks: percentAdjustmentSchema,
    brightness: stopAdjustmentSchema,
    clarity: percentAdjustmentSchema,
    contrast: percentAdjustmentSchema,
    dehaze: percentAdjustmentSchema,
    exposure: stopAdjustmentSchema,
    highlights: percentAdjustmentSchema,
    shadows: percentAdjustmentSchema,
    vibrance: percentAdjustmentSchema,
    vignetteAmount: percentAdjustmentSchema,
    whiteBalanceMigration: z.literal('native_v1'),
    whiteBalanceTechnical: technicalWhiteBalanceSchema,
    whites: percentAdjustmentSchema,
    centré: percentAdjustmentSchema,
  })
  .strict();

export type ContextAutoAdjustPatch = z.infer<typeof contextAutoAdjustPatchSchema>;

export interface ContextAutoAdjustBase extends AutoEditProposalBase {
  inputSemantics: 'raw_scene_linear' | 'rendered_scene_linear_approximation';
}

export interface ContextAutoAdjustEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
  historyIndex: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { isReady: boolean; path: string; rawDevelopmentReport?: unknown } | null;
}

const currentImageSessionId = (state: ContextAutoAdjustEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureContextAutoAdjustBase = (
  state: ContextAutoAdjustEditTransactionState,
): ContextAutoAdjustBase | null =>
  state.selectedImage?.isReady === true
    ? {
        adjustmentRevision: state.adjustmentRevision,
        adjustments: structuredClone(state.adjustments),
        graphRevision: `history_${String(state.historyIndex)}`,
        imageSessionId: currentImageSessionId(state),
        inputSemantics:
          state.selectedImage.rawDevelopmentReport == null ? 'rendered_scene_linear_approximation' : 'raw_scene_linear',
        path: state.selectedImage.path,
      }
    : null;

export const isCurrentContextAutoAdjustRequest = (
  state: ContextAutoAdjustEditTransactionState,
  base: ContextAutoAdjustBase,
  requestGeneration: number,
  currentRequestGeneration: number,
): boolean =>
  requestGeneration === currentRequestGeneration &&
  state.adjustmentRevision === base.adjustmentRevision &&
  currentImageSessionId(state) === base.imageSessionId &&
  state.selectedImage?.path === base.path;

export const buildContextAutoAdjustEditTransaction = (
  state: ContextAutoAdjustEditTransactionState,
  base: ContextAutoAdjustBase,
  patch: ContextAutoAdjustPatch,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== base.path) {
    throw new Error(`context_auto_adjust_transaction.stale_source:${base.path}:${state.selectedImage?.path ?? 'none'}`);
  }
  if (currentImageSessionId(state) !== base.imageSessionId) {
    throw new Error(
      `context_auto_adjust_transaction.stale_session:${base.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== base.adjustmentRevision) {
    throw new Error(
      `context_auto_adjust_transaction.stale_revision:${String(base.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  const adjustments = mergeAutoEditAdjustments(base.adjustments, {
    ...patch,
    whiteBalanceTechnical: {
      ...patch.whiteBalanceTechnical,
      inputSemantics: base.inputSemantics,
    },
  });
  return buildAutoEditTransactionRequest(base, adjustments, transactionId);
};
