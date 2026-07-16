import type { EditDocumentV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from '../adjustments';
import type { EditTransactionHistory, EditTransactionRequest } from '../editTransaction';

export interface FilmWorkspaceEditState {
  adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  imageSessionId: number;
  imageSession?: { id: string } | null;
}

export type FilmWorkspacePatch = Partial<Pick<Adjustments, 'filmEmulation'>>;

/**
 * Converts one Film workspace intent into the canonical revision-checked editor
 * transaction. Film state is represented only by the pinned current node.
 */
export const buildFilmWorkspaceEditTransactionRequest = (
  state: FilmWorkspaceEditState,
  patch: FilmWorkspacePatch,
  transactionId: string,
  history: EditTransactionHistory = 'single-entry',
): EditTransactionRequest => {
  const ownsFilmEmulation = Object.hasOwn(patch, 'filmEmulation');
  return {
    transactionId,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    baseAdjustmentRevision: state.adjustmentRevision,
    source: 'film-workspace',
    operations: [
      ...(ownsFilmEmulation
        ? [
            {
              nodeType: 'film_emulation' as const,
              patch: { filmEmulation: patch.filmEmulation ?? null },
              type: 'patch-edit-document-node' as const,
            },
          ]
        : []),
      ...(ownsFilmEmulation && state.editDocumentV2.provenance.referenceMatchApplicationReceipt !== null
        ? [{ receipt: null, type: 'set-reference-match-application-receipt' as const }]
        : []),
    ],
    history,
    persistence: 'commit',
  };
};
