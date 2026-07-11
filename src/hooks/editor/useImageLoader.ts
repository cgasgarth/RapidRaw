import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { toast } from 'react-toastify';

import { isNullAdjustmentSnapshot, parseLoadedMetadata, parseLoadImageResult } from '../../schemas/imageLoaderSchemas';
import { isEditorImageSessionCurrent, useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../utils/adjustments';
import { isSelectedImageLoadErrorCurrent } from '../../utils/editorImageLoadError';
import { formatUnknownError } from '../../utils/errorFormatting';
import { upsertReopenedDerivedOutputReceipt } from '../../utils/hdrDerivedSourceReopen';
import { hydrateLayerStackMasksFromMetadata } from '../../utils/layers/layerStackSidecarAdjustments';
import {
  consumePendingNegativeConversionDustHealLayers,
  consumePendingNegativeConversionSavedPositiveHandoff,
} from '../../utils/negative-lab/negativeLabEditorHandoff';
import { metadataWithNegativeLabReopenedSavedPositiveHandoff } from '../../utils/negative-lab/negativeLabSavedPositiveReopen';

export function useImageLoader() {
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const imageSession = useEditorStore((s) => s.imageSession);
  const selectedImagePath = selectedImage?.path;
  const selectedImageIsReady = selectedImage?.isReady;

  const setEditor = useEditorStore((s) => s.setEditor);
  const resetHistory = useEditorStore((s) => s.resetHistory);
  const setLibrary = useLibraryStore((s) => s.setLibrary);
  const appSettings = useSettingsStore((s) => s.appSettings);

  useEffect(() => {
    if (selectedImagePath && !selectedImageIsReady && imageSession?.path === selectedImagePath) {
      const sessionId = imageSession.id;

      const loadMetadataEarly = async () => {
        try {
          const editor = useEditorStore.getState();
          editor.patchResidency.reset(editor.imageSessionId);
          await invoke(Invokes.ClearSessionCaches).catch((e: unknown) => {
            if (isEditorImageSessionCurrent(sessionId)) console.warn('Cache clear failed:', e);
          });

          const metadata = parseLoadedMetadata(
            await invoke<unknown>(Invokes.LoadMetadata, { path: selectedImagePath }),
          );
          if (!isEditorImageSessionCurrent(sessionId)) return;

          let initialAdjusts;
          if (metadata.adjustments && !isNullAdjustmentSnapshot(metadata.adjustments)) {
            initialAdjusts = normalizeLoadedAdjustments(metadata.adjustments);
          } else {
            initialAdjusts = { ...INITIAL_ADJUSTMENTS };
          }

          const hydratedAdjustments = hydrateLayerStackMasksFromMetadata(initialAdjusts, metadata, selectedImagePath);

          setEditor({ adjustments: hydratedAdjustments });
          resetHistory(hydratedAdjustments);
        } catch (err) {
          if (isEditorImageSessionCurrent(sessionId)) console.error('Failed to load metadata early:', err);
        }
      };

      const loadFullImageData = async () => {
        try {
          const loadImageResult = parseLoadImageResult(
            await invoke<unknown>(Invokes.LoadImage, { path: selectedImagePath }),
          );
          if (!isEditorImageSessionCurrent(sessionId)) return;
          const loadedMetadata = metadataWithNegativeLabReopenedSavedPositiveHandoff({
            imagePath: selectedImagePath,
            metadata: loadImageResult.metadata,
          });

          const { width, height } = loadImageResult;
          upsertReopenedDerivedOutputReceipt({
            imagePath: selectedImagePath,
            metadata: loadedMetadata,
            upsert: useUIStore.getState().upsertDerivedOutputReceipt,
          });
          setEditor({ originalSize: { width, height } });

          if (appSettings?.editorPreviewResolution) {
            const maxSize = appSettings.editorPreviewResolution;
            const aspectRatio = width / height;

            if (width > height) {
              const pWidth = Math.min(width, maxSize);
              const pHeight = Math.round(pWidth / aspectRatio);
              setEditor({ previewSize: { width: pWidth, height: pHeight } });
            } else {
              const pHeight = Math.min(height, maxSize);
              const pWidth = Math.round(pHeight * aspectRatio);
              setEditor({ previewSize: { width: pWidth, height: pHeight } });
            }
          } else {
            setEditor({ previewSize: { width: 0, height: 0 } });
          }

          setEditor((state) => {
            if (state.imageSession?.id === sessionId && state.selectedImage?.path === selectedImagePath) {
              return {
                imageSession: { ...state.imageSession, status: 'ready' },
                selectedImage: {
                  ...state.selectedImage,
                  exif: loadImageResult.exif ?? null,
                  height: loadImageResult.height,
                  isOfflineSmartPreview: loadImageResult.is_offline_smart_preview === true,
                  isRaw: loadImageResult.is_raw,
                  isReady: true,
                  metadata: loadedMetadata,
                  originalUrl: null,
                  rawDevelopmentReport: loadImageResult.raw_development_report ?? null,
                  width: loadImageResult.width,
                },
              };
            }
            return state;
          });

          setEditor((state) => {
            if (!state.adjustments.aspectRatio && !state.adjustments.crop) {
              return {
                adjustments: { ...state.adjustments, aspectRatio: loadImageResult.width / loadImageResult.height },
              };
            }
            return state;
          });
          if (!isEditorImageSessionCurrent(sessionId)) return;
          const savedPositiveHandoff = consumePendingNegativeConversionSavedPositiveHandoff(selectedImagePath);
          if (savedPositiveHandoff !== null) {
            setEditor((state) => ({
              selectedImage:
                state.selectedImage?.path === selectedImagePath
                  ? {
                      ...state.selectedImage,
                      metadata: {
                        ...(typeof state.selectedImage.metadata === 'object' &&
                        state.selectedImage.metadata !== null &&
                        !Array.isArray(state.selectedImage.metadata)
                          ? state.selectedImage.metadata
                          : {}),
                        rawEngineNegativeLabHandoff: savedPositiveHandoff,
                      },
                    }
                  : state.selectedImage,
            }));
          }
          consumePendingNegativeConversionDustHealLayers(selectedImagePath);
        } catch (err) {
          if (isEditorImageSessionCurrent(sessionId)) {
            console.error('Failed to load image:', err);
            setEditor((state) =>
              state.imageSession?.id === sessionId ? { imageSession: { ...state.imageSession, status: 'failed' } } : {},
            );
            const currentSelectedImage = useEditorStore.getState().selectedImage;
            if (isSelectedImageLoadErrorCurrent(currentSelectedImage, selectedImagePath)) {
              toast.error(`Failed to load image: ${formatUnknownError(err)}`);
            }
          }
        } finally {
          if (isEditorImageSessionCurrent(sessionId)) {
            setLibrary({ isViewLoading: false });
          }
        }
      };

      const loadAll = async () => {
        await loadMetadataEarly();
        if (isEditorImageSessionCurrent(sessionId)) {
          await loadFullImageData();
        }
      };

      void loadAll();

      return undefined;
    }
    return undefined;
  }, [
    selectedImagePath,
    selectedImageIsReady,
    imageSession?.id,
    appSettings?.editorPreviewResolution,
    resetHistory,
    setEditor,
    setLibrary,
  ]);
}
