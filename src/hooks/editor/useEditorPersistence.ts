import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'react-toastify';
import { createDefaultCopyPasteSettings } from '../../schemas/copyPasteSettingsSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { EditorPersistenceEffectRunner } from '../../utils/editorPersistenceEffectRunner';
import { registerEditorPersistenceBarrierAdapter } from '../../utils/editorPersistenceService';
import { formatUnknownError } from '../../utils/errorFormatting';
import { globalImageCache } from '../../utils/ImageLRUCache';

const DEFAULT_COPY_PASTE_SELECTED_NODE_IDS = createDefaultCopyPasteSettings().selectedNodeIds;

export function useEditorPersistence(): void {
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const editDocumentV2 = useEditorStore((state) => state.editDocumentV2);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const imageSession = useEditorStore((state) => state.imageSession);
  const imageSessionId = useEditorStore((state) => state.imageSessionId);
  const interactionActive = useEditorStore((state) => state.isSliderDragging || state.isWbPickerActive);
  const receipt = useEditorStore((state) => state.lastEditApplicationReceipt);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const selectedNodeIds = useSettingsStore(
    (state) => state.appSettings?.copyPasteSettings?.selectedNodeIds ?? DEFAULT_COPY_PASTE_SELECTED_NODE_IDS,
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
    return paths.length === 0 ? null : { paths, selectedNodeIds };
  }, [multiSelectedPaths, selectedImage?.path, selectedNodeIds]);

  useEffect(() => {
    if (!selectedImage?.path || imageSession === null) return;
    runner.installSession({
      adjustmentRevision,
      editDocumentV2,
      imageSessionId: imageSession.id,
      path: selectedImage.path,
      sessionGeneration: imageSessionId,
    });
    if (receipt?.imageSessionId !== imageSession.id || receipt.adjustmentRevision !== adjustmentRevision) {
      return;
    }
    runner.submitCommitted({
      adjustmentRevision,
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
    editDocumentV2,
    imageSession,
    imageSessionId,
    interactionActive,
    multiSelection,
    receipt,
    runner,
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
