import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { toast } from 'react-toastify';

import { parseImageOpenUpdate, parseLoadedMetadata } from '../../schemas/imageLoaderSchemas';
import { isEditorImageSessionCurrent, useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import { isSelectedImageLoadErrorCurrent } from '../../utils/editorImageLoadError';
import { formatUnknownError } from '../../utils/errorFormatting';
import { upsertReopenedDerivedOutputReceipt } from '../../utils/hdrDerivedSourceReopen';
import { hydrateImageOpenAdjustments } from '../../utils/imageOpenAdjustmentHydration';
import { beginImageOpenWithSchema } from '../../utils/imageOpenInvokes';
import { isImageOpenUpdateCurrent } from '../../utils/imageOpenPhaseCurrentness';
import { acceptImageOpenMetadataRevision } from '../../utils/imageOpenRevisionCache';
import { isNativeCommittedHydrationSession } from '../../utils/nativeCommittedHydrationAuthority';
import {
  consumePendingNegativeConversionDustHealLayers,
  consumePendingNegativeConversionSavedPositiveHandoff,
} from '../../utils/negative-lab/negativeLabEditorHandoff';
import { metadataWithNegativeLabReopenedSavedPositiveHandoff } from '../../utils/negative-lab/negativeLabSavedPositiveReopen';
import { canPublishProvisionalFrame } from '../../utils/progressiveImageFrame';
import { IMAGE_OPEN_UPDATE_EVENT } from '../../utils/tauriEventNames';

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

      let disposed = false;
      let unlisten: (() => void) | undefined;
      const publishMetadataPhase = (metadata: ReturnType<typeof parseImageOpenUpdate> & { phase: 'metadataReady' }) => {
        if (!isEditorImageSessionCurrent(sessionId) || metadata.path !== selectedImagePath) return;
        if (isNativeCommittedHydrationSession(sessionId)) return;
        acceptImageOpenMetadataRevision(metadata.path, metadata.metadataFingerprint);
        const hydratedAdjustments = hydrateImageOpenAdjustments(metadata.metadata, selectedImagePath);
        setEditor({ adjustments: hydratedAdjustments });
        resetHistory(hydratedAdjustments);
      };

      const loadImageSession = async () => {
        try {
          unlisten = await listen<unknown>(IMAGE_OPEN_UPDATE_EVENT, (event) => {
            const update = parseImageOpenUpdate(event.payload);
            if (
              update.phase === 'metadataReady' &&
              isImageOpenUpdateCurrent(update, { generation: imageSession.generation, path: selectedImagePath })
            ) {
              publishMetadataPhase(update);
            }
            if (
              (update.phase === 'frameReady' || update.phase === 'fallbackFrameReady') &&
              isImageOpenUpdateCurrent(update, { generation: imageSession.generation, path: selectedImagePath })
            ) {
              setEditor((state) => {
                const current = state.provisionalPreviewFrame?.receipt ?? null;
                if (
                  state.imageSession?.id !== sessionId ||
                  !canPublishProvisionalFrame({
                    current,
                    expectedGeneration: imageSession.generation,
                    incoming: update.receipt,
                  })
                ) {
                  return {};
                }
                return {
                  provisionalPreviewFrame: {
                    receipt: update.receipt,
                    url: update.phase === 'frameReady' ? update.dataUrl : (state.selectedImage?.thumbnailUrl ?? ''),
                  },
                };
              });
            }
          });
          if (disposed) {
            unlisten();
            return;
          }
          const editor = useEditorStore.getState();
          editor.patchResidency.reset(editor.imageSessionId);
          const library = useLibraryStore.getState();
          const projection = library.imageList.find((image) => image.path === selectedImagePath) as
            | ((typeof library.imageList)[number] & { entityRevision?: number; imageId?: string })
            | undefined;
          const openResult = await beginImageOpenWithSchema({
            expectedCatalogRevision: library.catalogRevision,
            expectedEntityRevision: projection?.entityRevision ?? null,
            imageId: projection?.imageId ?? selectedImagePath,
            path: selectedImagePath,
            sessionId: {
              imageSession: imageSession.generation,
              selectionGeneration: imageSession.generation,
            },
          });
          const loadImageResult = openResult.decoded;
          if (!isEditorImageSessionCurrent(sessionId)) return;
          const loadedMetadata = parseLoadedMetadata(
            metadataWithNegativeLabReopenedSavedPositiveHandoff({
              imagePath: selectedImagePath,
              metadata: loadImageResult.metadata,
            }),
          );
          const shouldHydrateDecodedMetadata = acceptImageOpenMetadataRevision(
            selectedImagePath,
            openResult.metadataFingerprint,
          );
          const decodedAdjustments =
            shouldHydrateDecodedMetadata && !isNativeCommittedHydrationSession(sessionId)
              ? hydrateImageOpenAdjustments(loadedMetadata, selectedImagePath)
              : null;

          const { width, height } = loadImageResult;
          upsertReopenedDerivedOutputReceipt({
            imagePath: selectedImagePath,
            metadata: loadedMetadata,
            upsert: useUIStore.getState().upsertDerivedOutputReceipt,
          });
          let previewSize = { width: 0, height: 0 };
          if (appSettings?.editorPreviewResolution) {
            const maxSize = appSettings.editorPreviewResolution;
            const aspectRatio = width / height;

            if (width > height) {
              const pWidth = Math.min(width, maxSize);
              const pHeight = Math.round(pWidth / aspectRatio);
              previewSize = { width: pWidth, height: pHeight };
            } else {
              const pHeight = Math.min(height, maxSize);
              const pWidth = Math.round(pHeight * aspectRatio);
              previewSize = { width: pWidth, height: pHeight };
            }
          }

          setEditor((state) => {
            if (state.imageSession?.id === sessionId && state.selectedImage?.path === selectedImagePath) {
              return {
                adjustments:
                  decodedAdjustments ??
                  (!state.adjustments.aspectRatio && !state.adjustments.crop
                    ? { ...state.adjustments, aspectRatio: loadImageResult.width / loadImageResult.height }
                    : state.adjustments),
                imageSession: { ...state.imageSession, status: 'ready' },
                originalSize: { width, height },
                previewSize,
                provisionalPreviewFrame: null,
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
          unlisten?.();
          if (isEditorImageSessionCurrent(sessionId)) {
            setLibrary({ isViewLoading: false });
          }
        }
      };

      void loadImageSession();

      return () => {
        disposed = true;
        unlisten?.();
      };
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
