import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import { toast } from 'react-toastify';

import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Invokes } from '../../tauri/commands';
import {
  type Adjustments,
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
  LensAdjustment,
  normalizeLoadedAdjustments,
  PasteMode,
  pickAdjustmentValues,
} from '../../utils/adjustments';
import { beginAppOperation, logAppOperationFailure, logAppOperationSuccess } from '../../utils/appEventLogger';
import {
  BASIC_TONE_ADJUSTMENT_KEYS,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  hasBasicToneAdjustmentChange,
} from '../../utils/basicToneCommandBridge';
import { calculateCenteredCrop } from '../../utils/cropUtils';
import {
  type EditorZoomCommand,
  getEditorZoomDpr,
  getEditorZoomModeForCommand,
  getEditorZoomSourceSize,
  resolveEditorZoom,
} from '../../utils/editorZoom';
import { formatUnknownError } from '../../utils/errorFormatting';
import { globalImageCache } from '../../utils/ImageLRUCache';
import {
  acceptReferenceMatchAdjustmentTransfer,
  reconcileReferenceMatchReceiptsAfterEdit,
} from '../../utils/referenceMatchTransfer';
import { resolveResetTargetPaths } from '../../utils/resetAdjustments';
import { debounce } from '../../utils/timing';

export const debouncedSetHistory = debounce((newAdj: Adjustments) => {
  useEditorStore.getState().pushHistory(newAdj);
}, 500);

export const debouncedSave = debounce((path: string, adjustmentsToSave: Adjustments) => {
  invoke(Invokes.SaveMetadataAndUpdateThumbnail, { path, adjustments: adjustmentsToSave }).catch((err: unknown) => {
    console.error('Auto-save failed:', err);
    toast.error(`Failed to save changes: ${formatUnknownError(err)}`);
  });
}, 300);

type LoadedMetadataAdjustments = Adjustments & { is_null?: boolean };

interface MetadataResponse {
  adjustments?: LoadedMetadataAdjustments | null;
}

const BASIC_TONE_SESSION_ID = 'rapidraw-editor-basic-tone';

const createOperationId = (): string => crypto.randomUUID();

const getChangedBasicToneKeys = (previous: Adjustments, next: Adjustments): Array<string> =>
  BASIC_TONE_ADJUSTMENT_KEYS.filter((key) => previous[key] !== next[key]);

export function useEditorActions() {
  const setEditor = useEditorStore((s) => s.setEditor);

  const setAdjustments = useCallback(
    (value: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)) => {
      const state = useEditorStore.getState();
      const prev = state.adjustments;
      const proposedAdjustments = typeof value === 'function' ? value(prev) : { ...prev, ...value };
      const newAdjustments = reconcileReferenceMatchReceiptsAfterEdit(prev, proposedAdjustments);
      const expectedGraphRevision = `history_${state.historyIndex + 1}`;
      const commandContext =
        state.selectedImage?.path && hasBasicToneAdjustmentChange(prev, newAdjustments)
          ? buildBasicToneImageCommandContext({
              expectedGraphRevision,
              imagePath: state.selectedImage.path,
              operationId: createOperationId(),
              sessionId: BASIC_TONE_SESSION_ID,
            })
          : null;
      let lastBasicToneCommand = state.lastBasicToneCommand;

      if (commandContext) {
        const operation = beginAppOperation({
          action: 'build_basic_tone_command',
          component: 'editor.edit-command',
          details: {
            changedKeys: getChangedBasicToneKeys(prev, newAdjustments),
            commandType: 'toneColor.setBasicTone',
            dryRun: true,
            expectedGraphRevision,
          },
          domain: 'edit-command',
          operationId: commandContext.commandId,
          traceId: commandContext.correlationId,
        });
        try {
          lastBasicToneCommand = buildBasicToneCommandEnvelope(newAdjustments, commandContext, { dryRun: true });
          logAppOperationSuccess(operation, {
            commandType: lastBasicToneCommand.commandType,
            dryRun: lastBasicToneCommand.dryRun,
            schemaVersion: lastBasicToneCommand.schemaVersion,
          });
        } catch (error) {
          logAppOperationFailure(operation, error);
          throw error;
        }
      }

      setEditor({ adjustments: newAdjustments, lastBasicToneCommand });
      useEditorStore.getState().pushHistory(newAdjustments);
    },
    [setEditor],
  );

  const handleRotate = useCallback(
    (degrees: number) => {
      const { selectedImage, adjustments } = useEditorStore.getState();
      const increment = degrees > 0 ? 1 : 3;
      const newAspectRatio =
        adjustments.aspectRatio && adjustments.aspectRatio !== 0 ? 1 / adjustments.aspectRatio : null;
      const newOrientationSteps = ((adjustments.orientationSteps || 0) + increment) % 4;
      const newCrop =
        selectedImage?.width && selectedImage.height
          ? calculateCenteredCrop(selectedImage.width, selectedImage.height, newOrientationSteps, newAspectRatio)
          : null;

      setAdjustments((prev) => ({
        ...prev,
        aspectRatio: newAspectRatio,
        orientationSteps: newOrientationSteps,
        rotation: 0,
        crop: newCrop,
      }));
    },
    [setAdjustments],
  );

  const handleAutoAdjustments = useCallback(async () => {
    const selectedImage = useEditorStore.getState().selectedImage;
    if (!selectedImage?.isReady) return;
    try {
      const autoAdjustments: Adjustments = await invoke(Invokes.CalculateAutoAdjustments);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...autoAdjustments,
        sectionVisibility: { ...prev.sectionVisibility, ...autoAdjustments.sectionVisibility },
      }));
    } catch (err) {
      toast.error(`Failed to apply auto adjustments: ${formatUnknownError(err)}`);
    }
  }, [setAdjustments]);

  const handleLutSelect = useCallback(
    async (path: string) => {
      const isAndroid = useSettingsStore.getState().osPlatform === 'android';
      try {
        const result: { size: number } = await invoke(Invokes.LoadAndParseLut, { path });
        const name = isAndroid
          ? await invoke<string>(Invokes.ResolveAndroidContentUriName, { uriStr: path })
          : path.split(/[\\/]/).pop() || 'LUT';
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          lutPath: path,
          lutName: name,
          lutSize: result.size,
          lutIntensity: 100,
          sectionVisibility: { ...prev.sectionVisibility, effects: true },
        }));
      } catch (err) {
        toast.error(`Failed to load LUT: ${formatUnknownError(err)}`);
      }
    },
    [setAdjustments],
  );

  const handleResetAdjustments = useCallback(
    async (paths?: string[]) => {
      const { multiSelectedPaths, libraryActivePath, setLibrary } = useLibraryStore.getState();
      const { selectedImage, resetHistory } = useEditorStore.getState();
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

      pathsToReset.forEach((p) => {
        globalImageCache.delete(p);
      });
      debouncedSetHistory.cancel();

      try {
        const results = await invoke<
          Array<{ path: string; adjustments: Adjustments; revision: string; renderGeneration: number }>
        >(Invokes.ResetAdjustmentsForPaths, { paths: pathsToReset });
        useProcessStore.getState().invalidateThumbnails(pathsToReset);
        if (libraryActivePath && pathsToReset.includes(libraryActivePath))
          setLibrary({ libraryActiveAdjustments: { ...INITIAL_ADJUSTMENTS } });
        if (selectedImage && pathsToReset.includes(selectedImage.path)) {
          const aspect =
            selectedImage.width && selectedImage.height ? selectedImage.width / selectedImage.height : null;
          const backend = results.find((result) => result.path === selectedImage.path)?.adjustments;
          const resetData = { ...INITIAL_ADJUSTMENTS, ...backend, aspectRatio: aspect, aiPatches: [] };
          resetHistory(resetData);
          setEditor({ adjustments: resetData });
        }
      } catch (err) {
        toast.error(`Failed to reset adjustments: ${formatUnknownError(err)}`);
      }
    },
    [setEditor],
  );

  const handleCopyAdjustments = useCallback(async (pathOrEvent?: unknown) => {
    const pathOverride = typeof pathOrEvent === 'string' ? pathOrEvent : undefined;
    const { selectedImage, adjustments } = useEditorStore.getState();
    const { libraryActivePath, multiSelectedPaths } = useLibraryStore.getState();
    let sourceAdjustments: Adjustments | null = null;

    if (selectedImage) {
      sourceAdjustments = adjustments;
    } else {
      const pathToCopyFrom = pathOverride || libraryActivePath || multiSelectedPaths[0];
      if (pathToCopyFrom) {
        try {
          const meta = await invoke<MetadataResponse>(Invokes.LoadMetadata, { path: pathToCopyFrom });
          if (meta.adjustments && !meta.adjustments.is_null) {
            sourceAdjustments = normalizeLoadedAdjustments(meta.adjustments);
          } else {
            sourceAdjustments = INITIAL_ADJUSTMENTS;
          }
        } catch (err) {
          toast.error(`Failed to load metadata for copying: ${formatUnknownError(err)}`);
          return;
        }
      }
    }

    if (!sourceAdjustments) return;

    const adjustmentsToCopy = pickAdjustmentValues(COPYABLE_ADJUSTMENT_KEYS, sourceAdjustments, {
      requireExistingKey: true,
    });
    useEditorStore.getState().setEditor({ copiedAdjustments: adjustmentsToCopy });
    useProcessStore.getState().setProcess({ isCopied: true });
  }, []);

  const handlePasteAdjustments = useCallback(
    (paths?: string[]) => {
      const { copiedAdjustments, selectedImage, adjustments } = useEditorStore.getState();
      const { multiSelectedPaths } = useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setProcess } = useProcessStore.getState();

      if (!copiedAdjustments || !appSettings) return;

      const { mode, includedAdjustments } = appSettings.copyPasteSettings ?? {
        mode: PasteMode.Merge,
        includedAdjustments: COPYABLE_ADJUSTMENT_KEYS,
      };
      const selectedAdjustmentsToApply = pickAdjustmentValues(includedAdjustments, copiedAdjustments, {
        requireExistingKey: true,
        skipDefaultValues: mode === PasteMode.Merge,
      });
      const adjustmentsToApply = acceptReferenceMatchAdjustmentTransfer({
        adjustments: selectedAdjustmentsToApply,
        transferMode: 'copy-paste',
      }).adjustments;

      if (includedAdjustments.includes(LensAdjustment.LensMaker)) {
        if (!adjustmentsToApply[LensAdjustment.LensMaker]) {
          adjustmentsToApply[LensAdjustment.LensDistortionParams] = null;
        }
      }

      if (Object.keys(adjustmentsToApply).length === 0) {
        setProcess({ isPasted: true });
        return;
      }

      const pathsToUpdate =
        paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
      if (pathsToUpdate.length === 0) return;

      pathsToUpdate.forEach((p) => {
        globalImageCache.delete(p);
      });

      if (selectedImage && pathsToUpdate.includes(selectedImage.path)) {
        setAdjustments({ ...adjustments, ...adjustmentsToApply });
      }

      invoke(Invokes.ApplyAdjustmentsToPaths, { paths: pathsToUpdate, adjustments: adjustmentsToApply })
        .then(() => {
          if (selectedImage && pathsToUpdate.includes(selectedImage.path)) {
            void invoke<MetadataResponse>(Invokes.LoadMetadata, { path: selectedImage.path })
              .then((meta) => {
                const loadedAdjustments = meta.adjustments;
                if (loadedAdjustments) {
                  setAdjustments((prev: Adjustments) => ({
                    ...prev,
                    lensMaker: loadedAdjustments.lensMaker,
                    lensModel: loadedAdjustments.lensModel,
                    lensDistortionParams: loadedAdjustments.lensDistortionParams,
                  }));
                }
              })
              .catch((err: unknown) => toast.error(`Failed to reload metadata: ${formatUnknownError(err)}`));
          }
        })
        .catch((err: unknown) => toast.error(`Failed to paste adjustments: ${formatUnknownError(err)}`));

      setProcess({ isPasted: true });
    },
    [setAdjustments],
  );

  const handleZoomChange = useCallback((command: EditorZoomCommand) => {
    const editor = useEditorStore.getState();
    const sourceSize = getEditorZoomSourceSize({
      crop: editor.adjustments.crop,
      orientationSteps: editor.adjustments.orientationSteps,
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
    setAdjustments,
    handleRotate,
    handleAutoAdjustments,
    handleLutSelect,
    handleResetAdjustments,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleZoomChange,
  };
}
