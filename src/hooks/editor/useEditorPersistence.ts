import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'react-toastify';

import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES,
  getEditDocumentV2CopyableLegacyFieldsForSelection,
} from '../../utils/editDocumentV2';
import { EditorPersistenceEffectRunner } from '../../utils/editorPersistenceEffectRunner';
import { registerEditorPersistenceBarrierAdapter } from '../../utils/editorPersistenceService';
import { formatUnknownError } from '../../utils/errorFormatting';
import { globalImageCache } from '../../utils/ImageLRUCache';

export function useEditorPersistence(): void {
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);
  const editDocumentV2 = useEditorStore((state) => state.editDocumentV2);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const imageSession = useEditorStore((state) => state.imageSession);
  const imageSessionId = useEditorStore((state) => state.imageSessionId);
  const interactionActive = useEditorStore((state) => state.isSliderDragging || state.isWbPickerActive);
  const receipt = useEditorStore((state) => state.lastEditApplicationReceipt);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const includedAdjustments = useSettingsStore(
    (state) => state.appSettings?.copyPasteSettings?.includedAdjustments ?? EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES,
  );
  const runnerRef = useRef<EditorPersistenceEffectRunner | null>(null);
  const runner =
    runnerRef.current ??
    new EditorPersistenceEffectRunner({
      onAccepted: (execution) => {
        const affected = [execution.path, ...(execution.multiSelection?.paths ?? [])];
        for (const path of execution.multiSelection?.paths ?? []) globalImageCache.delete(path);
        useProcessStore.getState().invalidateThumbnails(affected);
      },
      onCurrentFailure: (error) => {
        console.error('Auto-save failed:', error);
        toast.error(`Failed to save changes: ${formatUnknownError(error)}`);
      },
    });
  runnerRef.current = runner;

  const multiSelection = useMemo(() => {
    if (!selectedImage?.path) return null;
    const paths = multiSelectedPaths.filter((path) => path !== selectedImage.path);
    return paths.length === 0
      ? null
      : { includedAdjustments: getEditDocumentV2CopyableLegacyFieldsForSelection(includedAdjustments), paths };
  }, [includedAdjustments, multiSelectedPaths, selectedImage?.path]);

  useEffect(() => {
    if (!selectedImage?.isReady || imageSession === null) return;
    runner.submit({
      adjustmentRevision,
      adjustments,
      editDocumentV2,
      imageSessionId: imageSession.id,
      interactionActive,
      multiSelection,
      path: selectedImage.path,
      receipt,
      sessionGeneration: imageSessionId,
    });
  }, [
    adjustmentRevision,
    adjustments,
    editDocumentV2,
    imageSession,
    imageSessionId,
    interactionActive,
    multiSelection,
    receipt,
    runner,
    selectedImage?.isReady,
    selectedImage?.path,
  ]);

  useEffect(() => {
    const unregisterBarrierAdapter = registerEditorPersistenceBarrierAdapter(() => runner.cancelQueuedForBarrier());
    return () => {
      unregisterBarrierAdapter();
      runner.cancel();
    };
  }, [runner]);
}
