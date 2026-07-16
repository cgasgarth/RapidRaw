import { useCallback } from 'react';
import { toast } from 'react-toastify';
import { z } from 'zod';

import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  type EditDocumentEditorSection,
} from '../../../packages/rawengine-schema/src/editDocumentV2';

import { createDefaultCopyPasteSettings } from '../../schemas/copyPasteSettingsSchemas';
import { loadedMetadataSchema } from '../../schemas/imageLoaderSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Invokes } from '../../tauri/commands';
import {
  type Adjustments,
  bindTypedCurveGraphVersion,
  INITIAL_ADJUSTMENTS,
  normalizeLoadedAdjustments,
  PasteMode,
} from '../../utils/adjustments';
import {
  buildContextAutoAdjustEditTransaction,
  captureContextAutoAdjustBase,
  contextAutoAdjustPatchSchema,
  isCurrentContextAutoAdjustRequest,
} from '../../utils/contextAutoAdjustEditTransaction';
import {
  buildCopyPasteEditTransaction,
  buildCopyPastePersistenceCompensation,
  type CopyPasteCompensationTarget,
  captureCopyPasteCompensationTarget,
  classifyCopyPasteNativeCompletion,
} from '../../utils/copyPasteEditTransaction';
import { selectEditDocumentGeometry } from '../../utils/editDocumentSelectors';
import {
  copyEditDocumentV2Nodes,
  legacyAdjustmentsToEditDocumentV2,
  lowerEditDocumentV2CopyPayloadToLegacyAdjustments,
  selectEditDocumentV2CopyPayload,
  setEditDocumentV2NodeEnabled,
} from '../../utils/editDocumentV2';
import {
  editorPersistenceReceiptArraySchema,
  editorPersistenceReceiptSchema,
} from '../../utils/editorPersistenceEffectRunner';
import {
  awaitMatchingEditorPersistence,
  beginEditorPersistenceBarrier,
  trackEditorPersistence,
} from '../../utils/editorPersistenceService';
import {
  type EditorZoomCommand,
  getEditorZoomDpr,
  getEditorZoomModeForCommand,
  getEditorZoomSourceSize,
  resolveEditorZoom,
} from '../../utils/editorZoom';
import {
  buildEditorSectionNodeEnablementOperations,
  buildEditTransactionPersistenceContext,
  type EditNodeOperation,
  type EditTransactionPersistenceContext,
} from '../../utils/editTransaction';
import { formatUnknownError } from '../../utils/errorFormatting';
import { globalImageCache } from '../../utils/ImageLRUCache';
import { buildLutLoadEditTransaction, captureLutCommitIdentity } from '../../utils/lutEditTransaction';
import {
  buildOrientationRotateEditTransaction,
  captureOrientationRotateCommitIdentity,
} from '../../utils/orientationRotateEditTransaction';
import { reconcileReferenceMatchReceiptsAfterEdit } from '../../utils/referenceMatchTransfer';
import { resolveResetTargetPaths } from '../../utils/resetAdjustments';
import {
  assertResetAdjustmentsResultCoverage,
  buildResetEditTransaction,
  captureResetEditCommitIdentity,
  isCurrentResetEditCommitIdentity,
  resetAdjustmentsResultsSchema,
} from '../../utils/resetEditTransaction';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import { debounce } from '../../utils/timing';

export const debouncedSetHistory = debounce((_newAdjustments: Adjustments) => {
  const state = useEditorStore.getState();
  state.pushHistory({
    adjustmentRevision: state.adjustmentRevision,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  });
}, 500);

export const debouncedSave = debounce(
  (path: string, documentToSave: EditDocumentV2, transaction?: EditTransactionPersistenceContext) => {
    void trackEditorPersistence(
      path,
      documentToSave,
      invokeWithSchema(
        Invokes.SaveMetadataAndUpdateThumbnail,
        { path, editDocumentV2: documentToSave, transaction },
        editorPersistenceReceiptSchema,
      ),
    ).catch((err: unknown) => {
      console.error('Auto-save failed:', err);
      toast.error(`Failed to save changes: ${formatUnknownError(err)}`);
    });
  },
  300,
);

export const beginEditorPersistenceAuthorityBarrier = (): void => {
  debouncedSave.cancel();
  beginEditorPersistenceBarrier();
};

export const awaitMatchingEditorSave = async (
  path: string,
  document: EditDocumentV2,
): Promise<{ path: string; sidecarRevision: string } | null> => awaitMatchingEditorPersistence(path, document);

const lutLoadResponseSchema = z.object({ size: z.number().int().positive() }).strict();
const androidContentUriNameSchema = z.string().min(1);
let contextAutoAdjustRequestGeneration = 0;

const createOperationId = (): string => crypto.randomUUID();

export function useEditorActions() {
  const applyEditTransaction = useEditorStore((s) => s.applyEditTransaction);

  const commitEditNodeOperations = useCallback(
    (operations: readonly EditNodeOperation[]) => {
      const state = useEditorStore.getState();
      applyEditTransaction({
        transactionId: createOperationId(),
        imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
        baseAdjustmentRevision: state.adjustmentRevision,
        source: 'manual-control',
        operations,
        history: 'single-entry',
        persistence: 'commit',
      });
    },
    [applyEditTransaction],
  );

  const setAdjustments = useCallback(
    (value: Partial<Adjustments> | ((previous: Adjustments) => Adjustments)) => {
      const state = useEditorStore.getState();
      const current = state.adjustmentSnapshot.value;
      const next = typeof value === 'function' ? value(current) : { ...current, ...value };
      let document = legacyAdjustmentsToEditDocumentV2(reconcileReferenceMatchReceiptsAfterEdit(current, next));
      for (const { nodeType } of EDIT_DOCUMENT_NODE_DESCRIPTORS) {
        if (nodeType === 'display_creative') continue;
        const enabled = state.editDocumentV2.nodes[nodeType]?.enabled;
        if (enabled !== undefined) document = setEditDocumentV2NodeEnabled(document, nodeType, enabled);
      }
      commitEditNodeOperations([{ editDocumentV2: document, type: 'replace-edit-document' }]);
    },
    [commitEditNodeOperations],
  );

  const setEditorSectionEnabled = useCallback(
    (section: EditDocumentEditorSection, enabled: boolean) => {
      const state = useEditorStore.getState();
      const operations = buildEditorSectionNodeEnablementOperations(state.editDocumentV2, section, enabled);
      if (operations.length === 0) return;
      applyEditTransaction({
        baseAdjustmentRevision: state.adjustmentRevision,
        history: 'single-entry',
        imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
        operations,
        persistence: 'commit',
        source: 'manual-control',
        transactionId: createOperationId(),
      });
    },
    [applyEditTransaction],
  );

  const handleRotate = useCallback(
    (degrees: number) => {
      const state = useEditorStore.getState();
      const identity = captureOrientationRotateCommitIdentity(state);
      if (identity === null) return;
      applyEditTransaction(buildOrientationRotateEditTransaction(state, identity, degrees, createOperationId()));
    },
    [applyEditTransaction],
  );

  const handleAutoAdjustments = useCallback(async () => {
    const base = captureContextAutoAdjustBase(useEditorStore.getState());
    if (base === null) return;
    const requestGeneration = ++contextAutoAdjustRequestGeneration;
    try {
      const patch = await invokeWithSchema(Invokes.CalculateAutoAdjustments, {}, contextAutoAdjustPatchSchema);
      const state = useEditorStore.getState();
      if (!isCurrentContextAutoAdjustRequest(state, base, requestGeneration, contextAutoAdjustRequestGeneration))
        return;
      applyEditTransaction(buildContextAutoAdjustEditTransaction(state, base, patch, crypto.randomUUID()));
    } catch (err) {
      if (
        isCurrentContextAutoAdjustRequest(
          useEditorStore.getState(),
          base,
          requestGeneration,
          contextAutoAdjustRequestGeneration,
        )
      ) {
        toast.error(`Failed to apply auto adjustments: ${formatUnknownError(err)}`);
      }
    }
  }, [applyEditTransaction]);

  const handleLutSelect = useCallback(
    async (path: string) => {
      const isAndroid = useSettingsStore.getState().osPlatform === 'android';
      const identity = captureLutCommitIdentity(useEditorStore.getState());
      if (identity === null) return;
      try {
        const result = await invokeWithSchema(Invokes.LoadAndParseLut, { path }, lutLoadResponseSchema);
        const name = isAndroid
          ? await invokeWithSchema(Invokes.ResolveAndroidContentUriName, { uriStr: path }, androidContentUriNameSchema)
          : path.split(/[\\/]/).pop() || 'LUT';
        const state = useEditorStore.getState();
        applyEditTransaction(
          buildLutLoadEditTransaction(
            state,
            identity,
            { data: null, intensity: 100, name, path, size: result.size },
            crypto.randomUUID(),
          ),
        );
      } catch (err) {
        toast.error(`Failed to load LUT: ${formatUnknownError(err)}`);
      }
    },
    [applyEditTransaction],
  );

  const handleResetAdjustments = useCallback(
    async (paths?: string[]) => {
      const { multiSelectedPaths, libraryActivePath, setLibrary } = useLibraryStore.getState();
      const { selectedImage } = useEditorStore.getState();
      const pathsToReset = resolveResetTargetPaths(
        paths,
        selectedImage?.path,
        multiSelectedPaths,
        libraryActivePath ?? undefined,
      );
      if (pathsToReset.length === 0) {
        toast.error('Select an image before resetting adjustments.');
        return;
      }
      const resetIdentity = selectedImage
        ? captureResetEditCommitIdentity(useEditorStore.getState(), selectedImage.path)
        : null;

      pathsToReset.forEach((p) => {
        globalImageCache.delete(p);
      });
      debouncedSetHistory.cancel();
      beginEditorPersistenceAuthorityBarrier();

      try {
        const results = await invokeWithSchema(
          Invokes.ResetAdjustmentsForPaths,
          { paths: pathsToReset },
          resetAdjustmentsResultsSchema,
        );
        assertResetAdjustmentsResultCoverage(results, pathsToReset);
        useProcessStore.getState().invalidateThumbnails(pathsToReset);
        if (selectedImage && resetIdentity !== null && pathsToReset.includes(selectedImage.path)) {
          const current = useEditorStore.getState();
          if (!isCurrentResetEditCommitIdentity(current, resetIdentity)) return;
          const result = results.find(({ path }) => path === resetIdentity.sourceIdentity);
          if (result === undefined) throw new Error('reset_edit_transaction.missing_selected_receipt');
          applyEditTransaction(buildResetEditTransaction(current, resetIdentity, result, createOperationId()));
        }
      } catch (err) {
        toast.error(`Failed to reset adjustments: ${formatUnknownError(err)}`);
      }
    },
    [applyEditTransaction],
  );

  const handleCopyAdjustments = useCallback(async (pathOrEvent?: unknown) => {
    const pathOverride = typeof pathOrEvent === 'string' ? pathOrEvent : undefined;
    const { selectedImage, editDocumentV2 } = useEditorStore.getState();
    const { libraryActivePath, multiSelectedPaths } = useLibraryStore.getState();
    let sourceDocument = selectedImage ? editDocumentV2 : null;
    if (!selectedImage) {
      const pathToCopyFrom = pathOverride || libraryActivePath || multiSelectedPaths[0];
      if (pathToCopyFrom) {
        try {
          const meta = await invokeWithSchema(Invokes.LoadMetadata, { path: pathToCopyFrom }, loadedMetadataSchema);
          sourceDocument = meta.editDocumentV2 ?? null;
          if (sourceDocument === null) throw new Error('Current EditDocumentV2 is missing from image metadata.');
        } catch (err) {
          toast.error(`Failed to load metadata for copying: ${formatUnknownError(err)}`);
          return;
        }
      }
    }

    if (sourceDocument === null) return;

    const copiedEditDocumentV2 = copyEditDocumentV2Nodes(sourceDocument);
    useEditorStore.getState().setEditor({
      copiedEditDocumentV2,
    });
    useProcessStore.getState().setProcess({ isCopied: true });
  }, []);

  const handlePasteAdjustments = useCallback(
    (paths?: string[]) => {
      const { copiedEditDocumentV2, selectedImage } = useEditorStore.getState();
      const { multiSelectedPaths } = useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setProcess } = useProcessStore.getState();

      if (!copiedEditDocumentV2 || !appSettings) return;

      const { pasteMode, selectedNodeIds } = appSettings.copyPasteSettings ?? createDefaultCopyPasteSettings();
      const selectedPayload = selectEditDocumentV2CopyPayload(
        copiedEditDocumentV2,
        selectedNodeIds,
        pasteMode === PasteMode.Merge,
      );
      if (Object.keys(selectedPayload.nodes).length === 0) {
        setProcess({ isPasted: true });
        return;
      }

      const pathsToUpdate =
        paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
      if (pathsToUpdate.length === 0) return;

      const editorState = useEditorStore.getState();
      const transactionId = createOperationId();
      const baseAdjustmentRevision = editorState.adjustmentRevision;
      let transaction: EditTransactionPersistenceContext = {
        transactionId,
        imageSessionId: editorState.imageSession?.id ?? `editor-image-session:${String(editorState.imageSessionId)}`,
        baseAdjustmentRevision,
        nextAdjustmentRevision: baseAdjustmentRevision + 1,
      };
      let compensationTarget: CopyPasteCompensationTarget | null = null;
      let selectedPasteWasNoOp = false;

      if (selectedImage && pathsToUpdate.includes(selectedImage.path)) {
        compensationTarget = captureCopyPasteCompensationTarget(editorState, selectedImage.path);
        const request = buildCopyPasteEditTransaction(editorState, selectedImage.path, selectedPayload, transactionId);
        const result = applyEditTransaction(request);
        selectedPasteWasNoOp = result.noOp;
        transaction = buildEditTransactionPersistenceContext(request, result);
      }

      if (selectedPasteWasNoOp && pathsToUpdate.length === 1 && pathsToUpdate[0] === selectedImage?.path) {
        setProcess({ isPasted: true });
        return;
      }

      pathsToUpdate.forEach((p) => {
        globalImageCache.delete(p);
      });

      invokeWithSchema(
        Invokes.ApplyAdjustmentsToPaths,
        { editDocumentV2CopyPayload: selectedPayload, paths: pathsToUpdate, transaction },
        editorPersistenceReceiptArraySchema,
      )
        .then((receipts) => {
          const selectedReceipt = receipts.find((receipt) => receipt.path === selectedImage?.path);
          if (selectedReceipt?.editDocumentV2 && selectedImage && pathsToUpdate.includes(selectedImage.path)) {
            const completion = classifyCopyPasteNativeCompletion(
              useEditorStore.getState(),
              selectedImage.path,
              transaction,
            );
            if (completion !== 'current') return;
            // The native receipt confirms disk/catalog side effects; EditTransaction remains the canonical document.
          }
        })
        .catch((err: unknown) => {
          if (compensationTarget !== null) {
            const current = useEditorStore.getState();
            const compensation = buildCopyPastePersistenceCompensation(current, transaction, compensationTarget);
            if (compensation !== null) current.applyEditTransaction(compensation);
          }
          toast.error(`Failed to paste adjustments: ${formatUnknownError(err)}`);
        });

      setProcess({ isPasted: true });
    },
    [applyEditTransaction],
  );

  const handleZoomChange = useCallback((command: EditorZoomCommand) => {
    const editor = useEditorStore.getState();
    const sourceSize = getEditorZoomSourceSize({
      crop: selectEditDocumentGeometry(editor.editDocumentV2).crop,
      orientationSteps: selectEditDocumentGeometry(editor.editDocumentV2).orientationSteps,
      originalSize: editor.originalSize,
    });
    const resolved = resolveEditorZoom({
      devicePixelRatio: getEditorZoomDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio),
      mode: editor.zoomMode,
      renderSize: {
        height: editor.baseRenderSize.height,
        scale: editor.baseRenderSize.width / Math.max(sourceSize.width, 1),
        width: editor.baseRenderSize.width,
      },
      sourceSize,
      viewportSize: {
        height: editor.baseRenderSize.containerHeight,
        width: editor.baseRenderSize.containerWidth,
      },
    });
    const zoomMode = getEditorZoomModeForCommand(command, resolved);
    useEditorStore.getState().setEditor({ zoomMode });
  }, []);

  return {
    commitEditNodeOperations,
    setAdjustments,
    setEditorSectionEnabled,
    handleRotate,
    handleAutoAdjustments,
    handleLutSelect,
    handleResetAdjustments,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleZoomChange,
  };
}
