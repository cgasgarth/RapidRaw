import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import type { ChannelConfig } from '../../components/adjustments/Curves';
import type { AnalyticsResourceDescriptor, WaveformData } from '../../components/ui/AppProperties';
import { Status } from '../../components/ui/ExportImportProperties';
import {
  gamutWarningOverlayPayloadSchema,
  parseCountPayload,
  parseCullingProgressPayload,
  parseCullingSuggestionsPayload,
  parseDenoiseCompletePayload,
  parseExportReceiptPayload,
  parseHdrCompletePayload,
  parseImportProgressPayload,
  parseImportStartPayload,
  parsePanoramaCompletePayload,
  parseProgressPayload,
  parseRenderPathPayload,
  parseSmartPreviewGeneratedPayload,
  parseStringPayload,
  parseThumbnailGeneratedPayload,
  parseThumbnailInvalidatedPayload,
  persistedRenderStateRecoveryPayloadSchema,
} from '../../schemas/tauriEventSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useUIStore } from '../../store/useUIStore';
import type { ThumbnailCacheMutation, ThumbnailSmartPreviewState } from '../../thumbnails/ThumbnailCache';
import { thumbnailCache } from '../../thumbnails/thumbnailCacheInstance';
import { formatAiModelProgress, parseAiModelProgress, updateAiModelProgress } from '../../utils/aiModelProgress';
import {
  buildHdrApplyCommandState,
  buildPanoramaApplyCommandState,
} from '../../utils/computational-merge/computationalMergeModalState';
import {
  isMergeOperationActive,
  orderedMergeSourcesMatch,
} from '../../utils/computational-merge/mergeOperationIdentity';
import {
  hasCommittedExportOutputs,
  shouldRefreshLibraryForExportReceipt,
} from '../../utils/export/exportTerminalReceipt';
import {
  AI_MODEL_DOWNLOAD_FINISH_EVENT,
  AI_MODEL_DOWNLOAD_START_EVENT,
  ANALYTICS_RESULT_EVENT,
  BATCH_EXPORT_PROGRESS_EVENT,
  CULLING_COMPLETE_EVENT,
  CULLING_ERROR_EVENT,
  CULLING_PROGRESS_EVENT,
  CULLING_START_EVENT,
  DENOISE_COMPLETE_EVENT,
  DENOISE_ERROR_EVENT,
  DENOISE_PROGRESS_EVENT,
  EXPORT_CANCELLED_EVENT,
  EXPORT_COMPLETE_EVENT,
  EXPORT_ERROR_EVENT,
  GAMUT_WARNING_UPDATE_EVENT,
  HDR_COMPLETE_EVENT,
  HDR_ERROR_EVENT,
  HDR_PROGRESS_EVENT,
  HISTOGRAM_UPDATE_EVENT,
  IMPORT_CANCELLED_EVENT,
  IMPORT_COMPLETE_EVENT,
  IMPORT_ERROR_EVENT,
  IMPORT_PROGRESS_EVENT,
  IMPORT_START_EVENT,
  INDEXING_FINISHED_EVENT,
  INDEXING_PROGRESS_EVENT,
  INDEXING_STARTED_EVENT,
  OPEN_WITH_FILE_EVENT,
  PANORAMA_COMPLETE_EVENT,
  PANORAMA_ERROR_EVENT,
  PANORAMA_PROGRESS_EVENT,
  PERSISTED_RENDER_STATE_RECOVERED_EVENT,
  PREVIEW_UPDATE_UNCROPPED_EVENT,
  SMART_PREVIEW_GENERATED_EVENT,
  THUMBNAIL_GENERATED_EVENT,
  THUMBNAIL_GENERATION_COMPLETE_EVENT,
  THUMBNAIL_INVALIDATED_EVENT,
  THUMBNAIL_PROGRESS_EVENT,
  WAVEFORM_UPDATE_EVENT,
  WGPU_FRAME_READY_EVENT,
} from '../../utils/tauriEventNames';
import { thumbnailResourceCache } from '../../utils/thumbnailResources';

interface TauriListenerProps {
  invalidateThumbnailRevision: (path: string, sourceRevision: string) => void;
  refreshAllFolderTrees: () => void;
  refreshImageList: () => void;
  markGenerated: (path: string, generation?: number) => boolean;
}

interface ImageAnalyticsPayload<TData> {
  data: TData;
  path: string;
}

interface AnalyticsResultPayload {
  frameId: { graphRevision: number; imageSession: number; previewGeneration: number };
  histogram: { blue: number[]; green: number[]; luma: number[]; red: number[] } | null;
  path: string;
  requestedProducts: number;
  scopes: {
    height: number;
    luma: AnalyticsResourceDescriptor | null;
    parade: AnalyticsResourceDescriptor | null;
    rgb: AnalyticsResourceDescriptor | null;
    vectorscope: AnalyticsResourceDescriptor | null;
    width: number;
  } | null;
}

const analyticsFrameByPath = new Map<string, { imageSession: number; previewGeneration: number }>();

const PREVIEW_SCOPE_DISPLAY_TRANSFORM_LABEL = 'Display preview transform';
const PREVIEW_SCOPE_SOURCE_LABEL = 'Edited preview';
const PREVIEW_SCOPE_WORKING_TRANSFORM_LABEL = 'Working RGB';
const PREVIEW_SCOPE_EXPORT_SOURCE_LABEL = 'Export preview';

const buildPreviewScopeStatus = ({
  histogramReady,
  path,
  waveformReady,
}: {
  histogramReady: boolean;
  path: string;
  waveformReady: boolean;
}) => {
  const editor = useEditorStore.getState();
  const transform = editor.exportSoftProofTransform;
  const isExportPreview = editor.isExportSoftProofEnabled && transform !== null;

  return {
    displayTransformLabel: transform?.colorManagedTransform ?? PREVIEW_SCOPE_DISPLAY_TRANSFORM_LABEL,
    exportProfileLabel: isExportPreview ? transform.effectiveColorProfile : null,
    exportRenderingIntentLabel: isExportPreview ? transform.effectiveRenderingIntent : null,
    histogramReady,
    path,
    renderBasis: isExportPreview ? ('export_preview' as const) : ('editor_preview' as const),
    softProofTransformApplied: transform?.transformApplied ?? false,
    sourceLabel: isExportPreview ? PREVIEW_SCOPE_EXPORT_SOURCE_LABEL : PREVIEW_SCOPE_SOURCE_LABEL,
    updatedAt: new Date().toISOString(),
    waveformReady,
    warningCodes: isExportPreview
      ? [
          transform.transformApplied ? 'export_profile_transform_applied' : 'export_profile_transform_missing',
          'render_target_matches_export_recipe',
        ]
      : [],
    workingTransformLabel: PREVIEW_SCOPE_WORKING_TRANSFORM_LABEL,
  };
};

export function useTauriListeners({
  invalidateThumbnailRevision,
  refreshAllFolderTrees,
  refreshImageList,
  markGenerated,
}: TauriListenerProps) {
  const refs = useRef({ invalidateThumbnailRevision, refreshAllFolderTrees, refreshImageList, markGenerated });

  useEffect(() => {
    refs.current = { invalidateThumbnailRevision, refreshAllFolderTrees, refreshImageList, markGenerated };
  });

  const thumbnailBuffer = useRef<Map<string, ThumbnailCacheMutation>>(new Map());
  const smartPreviewBuffer = useRef<Record<string, ThumbnailSmartPreviewState>>({});
  const ratingBuffer = useRef<Record<string, number>>({});
  const editStatusBuffer = useRef<Record<string, boolean>>({});
  const flushHandle = useRef<number | null>(null);

  useEffect(() => {
    let isEffectActive = true;

    const flushThumbnailBatch = () => {
      flushHandle.current = null;
      if (!isEffectActive) return;

      const pendingThumbs = thumbnailBuffer.current;
      const pendingSmartPreviews = smartPreviewBuffer.current;
      const pendingRatings = ratingBuffer.current;
      const pendingEdits = editStatusBuffer.current;

      thumbnailBuffer.current = new Map();
      smartPreviewBuffer.current = {};
      ratingBuffer.current = {};
      editStatusBuffer.current = {};

      if (pendingThumbs.size > 0) {
        for (const [path, smartPreview] of Object.entries(pendingSmartPreviews)) {
          const current = pendingThumbs.get(path);
          if (current) pendingThumbs.set(path, { ...current, smartPreview });
        }
        thumbnailCache.setMany(Array.from(pendingThumbs.values()));

        const selectedImage = useEditorStore.getState().selectedImage;
        const selectedUrl = selectedImage?.path ? pendingThumbs.get(selectedImage.path)?.url : undefined;
        if (selectedImage?.path && selectedUrl) {
          useEditorStore.getState().setEditor((state) =>
            state.selectedImage?.path === selectedImage.path
              ? {
                  selectedImage: {
                    ...state.selectedImage,
                    thumbnailUrl: selectedUrl,
                  },
                }
              : state,
          );
        }
      }

      if (Object.keys(pendingSmartPreviews).length > 0) {
        const smartPreviewOnly = Object.entries(pendingSmartPreviews)
          .filter(([path]) => !pendingThumbs.has(path))
          .map(([path, smartPreview]) => ({
            generation: thumbnailCache.get(path)?.generation ?? 0,
            path,
            smartPreview,
          }));
        thumbnailCache.setMany(smartPreviewOnly);
      }

      if (Object.keys(pendingRatings).length > 0 || Object.keys(pendingEdits).length > 0) {
        const paths = new Set([...Object.keys(pendingRatings), ...Object.keys(pendingEdits)]);
        useLibraryStore.getState().patchLibraryImages(
          [...paths].map((path) => ({
            path,
            changes: {
              ...(pendingRatings[path] === undefined ? {} : { rating: pendingRatings[path] }),
              ...(pendingEdits[path] === undefined ? {} : { is_edited: pendingEdits[path] }),
            },
          })),
        );
      }
    };

    const scheduleFlush = () => {
      if (flushHandle.current !== null) return;
      flushHandle.current = requestAnimationFrame(flushThumbnailBatch);
    };

    const listeners = [
      listen<unknown>(PERSISTED_RENDER_STATE_RECOVERED_EVENT, (event) => {
        const parsed = persistedRenderStateRecoveryPayloadSchema.safeParse(event.payload);
        if (!parsed.success) return;
        const backup = parsed.data.backupPath ? ` Backup: ${parsed.data.backupPath}` : '';
        toast.warn(`Recovered incompatible saved edits and reopened with safe render state.${backup}`, {
          toastId: `persisted-render-state-recovered:${parsed.data.path}`,
        });
      }),
      listen<AnalyticsResultPayload>(ANALYTICS_RESULT_EVENT, (event) => {
        const result = event.payload;
        const selectedPath = useEditorStore.getState().selectedImage?.path;
        if (!isEffectActive || result.path !== selectedPath) return;
        const previous = analyticsFrameByPath.get(result.path);
        if (
          previous &&
          (result.frameId.imageSession < previous.imageSession ||
            (result.frameId.imageSession === previous.imageSession &&
              result.frameId.previewGeneration < previous.previewGeneration))
        )
          return;
        analyticsFrameByPath.set(result.path, result.frameId);
        const histogram = result.histogram
          ? {
              blue: { color: '#3b82f6', data: result.histogram.blue },
              green: { color: '#22c55e', data: result.histogram.green },
              luma: { color: '#ffffff', data: result.histogram.luma },
              red: { color: '#ef4444', data: result.histogram.red },
            }
          : null;
        const scopes = result.scopes;
        const waveform = scopes
          ? {
              blue: '',
              green: '',
              height: scopes.height,
              luma: scopes.luma?.url ?? '',
              parade: scopes.parade?.url ?? '',
              red: '',
              rgb: scopes.rgb?.url ?? '',
              vectorscope: scopes.vectorscope?.url ?? '',
              width: scopes.width,
            }
          : null;
        useEditorStore.getState().setEditor({
          histogram,
          previewScopeRecoveryState: 'idle',
          previewScopeStatus: buildPreviewScopeStatus({
            histogramReady: histogram !== null,
            path: result.path,
            waveformReady: waveform !== null,
          }),
          waveform,
        });
      }),
      listen<unknown>(PREVIEW_UPDATE_UNCROPPED_EVENT, (event) => {
        if (isEffectActive)
          useEditorStore.getState().setEditor({ uncroppedAdjustedPreviewUrl: parseStringPayload(event.payload) });
      }),
      listen<ImageAnalyticsPayload<ChannelConfig>>(HISTOGRAM_UPDATE_EVENT, (event) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor((state) => ({
            histogram: event.payload.data,
            previewScopeStatus: buildPreviewScopeStatus({
              histogramReady: true,
              path: event.payload.path,
              waveformReady:
                state.previewScopeStatus?.path === event.payload.path ? state.previewScopeStatus.waveformReady : false,
            }),
            previewScopeRecoveryState:
              state.previewScopeStatus?.path === event.payload.path && state.previewScopeStatus.waveformReady
                ? 'idle'
                : state.previewScopeRecoveryState,
          }));
        }
      }),
      listen<ImageAnalyticsPayload<unknown>>(GAMUT_WARNING_UPDATE_EVENT, (event) => {
        const editor = useEditorStore.getState();
        if (isEffectActive && event.payload.path === editor.selectedImage?.path) {
          const parsed = gamutWarningOverlayPayloadSchema.safeParse(event.payload.data);
          useEditorStore.getState().setEditor({ gamutWarningOverlay: parsed.success ? parsed.data : null });
        }
      }),
      listen<unknown>(OPEN_WITH_FILE_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ initialFileToOpen: parseStringPayload(event.payload) });
      }),
      listen<ImageAnalyticsPayload<WaveformData>>(WAVEFORM_UPDATE_EVENT, (event) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor((state) => ({
            previewScopeStatus: buildPreviewScopeStatus({
              histogramReady:
                state.previewScopeStatus?.path === event.payload.path ? state.previewScopeStatus.histogramReady : false,
              path: event.payload.path,
              waveformReady: true,
            }),
            previewScopeRecoveryState:
              state.previewScopeStatus?.path === event.payload.path && state.previewScopeStatus.histogramReady
                ? 'idle'
                : state.previewScopeRecoveryState,
            waveform: event.payload.data,
          }));
        }
      }),
      listen<unknown>(THUMBNAIL_PROGRESS_EVENT, (event) => {
        const payload = parseProgressPayload(event.payload);
        if (isEffectActive)
          useProcessStore
            .getState()
            .setProcess({ thumbnailProgress: { current: payload.current, total: payload.total } });
      }),
      listen(THUMBNAIL_GENERATION_COMPLETE_EVENT, () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ thumbnailProgress: { current: 0, total: 0 } });
      }),
      listen<unknown>(THUMBNAIL_GENERATED_EVENT, (event) => {
        if (!isEffectActive) return;
        const { path, generation, resource, rating, is_edited, smartPreview } = parseThumbnailGeneratedPayload(
          event.payload,
        );

        if (!refs.current.markGenerated(path, generation)) return;

        thumbnailBuffer.current.set(path, {
          generation: generation ?? resource.generation,
          path,
          url: thumbnailResourceCache.setProtocol(path, resource),
        });
        if (smartPreview) {
          smartPreviewBuffer.current[path] = smartPreview;
        }
        if (rating !== undefined) {
          ratingBuffer.current[path] = rating;
        }
        if (is_edited !== undefined) {
          editStatusBuffer.current[path] = is_edited;
        }
        scheduleFlush();
      }),
      listen<unknown>(THUMBNAIL_INVALIDATED_EVENT, (event) => {
        if (!isEffectActive) return;
        const { path, thumbnailRevision } = parseThumbnailInvalidatedPayload(event.payload);
        thumbnailCache.deleteMany([path]);
        refs.current.invalidateThumbnailRevision(path, thumbnailRevision);
      }),
      listen<unknown>(SMART_PREVIEW_GENERATED_EVENT, (event) => {
        if (!isEffectActive) return;
        const { path, resource, smartPreview } = parseSmartPreviewGeneratedPayload(event.payload);
        smartPreviewBuffer.current[path] = smartPreview;
        thumbnailBuffer.current.set(path, {
          generation: resource.generation,
          path,
          smartPreview,
        });
        scheduleFlush();
      }),
      listen<unknown>(AI_MODEL_DOWNLOAD_START_EVENT, (event) => {
        if (!isEffectActive) return;
        const update = parseAiModelProgress(event.payload);
        if (!update) return;
        useProcessStore.getState().setProcess((state) => {
          const aiModelDownloads = updateAiModelProgress(state.aiModelDownloads, update);
          return { aiModelDownloads, aiModelDownloadStatus: formatAiModelProgress(aiModelDownloads) };
        });
      }),
      listen<unknown>(AI_MODEL_DOWNLOAD_FINISH_EVENT, (event) => {
        if (!isEffectActive) return;
        const update = parseAiModelProgress(event.payload);
        if (!update) return;
        useProcessStore.getState().setProcess((state) => {
          const aiModelDownloads = updateAiModelProgress(state.aiModelDownloads, update);
          return { aiModelDownloads, aiModelDownloadStatus: formatAiModelProgress(aiModelDownloads) };
        });
      }),
      listen(INDEXING_STARTED_EVENT, () => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ isIndexing: true, indexingProgress: { current: 0, total: 0 } });
      }),
      listen<unknown>(INDEXING_PROGRESS_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ indexingProgress: parseProgressPayload(event.payload) });
      }),
      listen(INDEXING_FINISHED_EVENT, () => {
        if (isEffectActive) {
          useProcessStore.getState().setProcess({ isIndexing: false, indexingProgress: { current: 0, total: 0 } });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.refreshImageList();
          }
        }
      }),
      listen<unknown>(BATCH_EXPORT_PROGRESS_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({ progress: parseProgressPayload(event.payload) });
      }),
      listen<unknown>(EXPORT_COMPLETE_EVENT, (event) => {
        if (isEffectActive) {
          const receipt = parseExportReceiptPayload(event.payload);
          useProcessStore.getState().setExportState({
            lastReceipt: receipt,
            status: Status.Success,
          });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (hasCommittedExportOutputs(receipt)) {
            refs.current.refreshAllFolderTrees();
            if (shouldRefreshLibraryForExportReceipt(receipt, currentPath)) {
              refs.current.refreshImageList();
            }
          }
        }
      }),
      listen<unknown>(EXPORT_ERROR_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({
            status: Status.Error,
            errorMessage: parseStringPayload(event.payload),
          });
      }),
      listen<unknown>(EXPORT_CANCELLED_EVENT, (event) => {
        if (isEffectActive) {
          const receipt = parseExportReceiptPayload(event.payload);
          useProcessStore.getState().setExportState({ lastReceipt: receipt, status: Status.Cancelled });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (hasCommittedExportOutputs(receipt)) {
            refs.current.refreshAllFolderTrees();
            if (shouldRefreshLibraryForExportReceipt(receipt, currentPath)) {
              refs.current.refreshImageList();
            }
          }
        }
      }),
      listen<unknown>(IMPORT_START_EVENT, (event) => {
        const payload = parseImportStartPayload(event.payload);
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            errorMessage: '',
            ...(payload.jobId ? { jobId: payload.jobId } : {}),
            path: '',
            progress: { current: 0, total: payload.total },
            status: Status.Importing,
          });
      }),
      listen<unknown>(IMPORT_PROGRESS_EVENT, (event) => {
        const payload = parseImportProgressPayload(event.payload);
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            path: payload.path,
            progress: { current: payload.current, total: payload.total },
            ...(payload.stage ? { stage: payload.stage } : {}),
            ...(payload.bytesCopied !== undefined ? { bytesCopied: payload.bytesCopied } : {}),
            ...(payload.totalBytes !== undefined ? { totalBytes: payload.totalBytes } : {}),
          });
        if (isEffectActive && payload.committedPath) {
          refs.current.refreshImageList();
        }
      }),
      listen(IMPORT_CANCELLED_EVENT, () => {
        if (isEffectActive) useProcessStore.getState().setImportState({ status: Status.Cancelled });
      }),
      listen(IMPORT_COMPLETE_EVENT, () => {
        if (isEffectActive) {
          useProcessStore.getState().setImportState({ status: Status.Success });
          refs.current.refreshAllFolderTrees();
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.refreshImageList();
          }
        }
      }),
      listen<unknown>(IMPORT_ERROR_EVENT, (event) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            status: Status.Error,
            errorMessage: parseStringPayload(event.payload),
          });
      }),
      listen<unknown>(DENOISE_PROGRESS_EVENT, (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive)
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: { ...state.denoiseModalState, progressMessage: payload },
          }));
      }),
      listen<unknown>(DENOISE_COMPLETE_EVENT, (event) => {
        if (isEffectActive) {
          const payload = parseDenoiseCompletePayload(event.payload);
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              previewBase64: typeof payload === 'string' ? payload : payload.denoised,
              originalBase64: typeof payload === 'string' ? null : (payload.original ?? null),
              progressMessage: null,
            },
          }));
        }
      }),
      listen<unknown>(DENOISE_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              error: parseStringPayload(event.payload),
              progressMessage: null,
            },
          }));
        }
      }),
      listen<unknown>(WGPU_FRAME_READY_EVENT, (event) => {
        const payload = parseRenderPathPayload(event.payload);
        if (isEffectActive && payload.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor((state) => ({
            hasRenderedFirstFrame: true,
            wgpuFrameSerial: state.wgpuFrameSerial + 1,
          }));
        }
      }),
      listen<unknown>(PANORAMA_PROGRESS_EVENT, (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => {
            if (
              !isMergeOperationActive(state.panoramaModalState) ||
              state.panoramaModalState.finalImageBase64 ||
              state.panoramaModalState.error
            )
              return state;
            return { panoramaModalState: { ...state.panoramaModalState, progressMessage: payload } };
          });
        }
      }),
      listen<unknown>(PANORAMA_COMPLETE_EVENT, (event) => {
        const payload = parsePanoramaCompletePayload(event.payload);
        if (isEffectActive) {
          // Panorama events currently expose neither operation ids nor source paths. Requiring the current
          // frontend session to be open and processing rejects closed-session events; full supersession
          // correlation remains limited until the native event contract carries the operation token.
          useUIStore.getState().setUI((state) =>
            !isMergeOperationActive(state.panoramaModalState)
              ? {}
              : {
                  panoramaModalState: {
                    ...state.panoramaModalState,
                    activeOperationId: null,
                    error: null,
                    finalImageBase64: payload.base64,
                    isProcessing: false,
                    lastApplyCommand: buildPanoramaApplyCommandState({
                      base64Length: payload.base64.length,
                      sourceCount: state.panoramaModalState.stitchingSourcePaths.length,
                    }),
                    progressMessage: null,
                    renderedReview: payload.review,
                  },
                },
          );
        }
      }),
      listen<unknown>(PANORAMA_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) =>
            !isMergeOperationActive(state.panoramaModalState)
              ? {}
              : {
                  panoramaModalState: {
                    ...state.panoramaModalState,
                    activeOperationId: null,
                    error: parseStringPayload(event.payload),
                    finalImageBase64: null,
                    isProcessing: false,
                    progressMessage: null,
                  },
                },
          );
        }
      }),
      listen<unknown>(HDR_PROGRESS_EVENT, (event) => {
        const payload = parseStringPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) =>
            !isMergeOperationActive(state.hdrModalState)
              ? {}
              : {
                  hdrModalState: {
                    ...state.hdrModalState,
                    error: null,
                    finalImageBase64: null,
                    progressMessage: payload,
                  },
                },
          );
        }
      }),
      listen<unknown>(HDR_COMPLETE_EVENT, (event) => {
        const payload = parseHdrCompletePayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => {
            const selectedIndexes = state.hdrModalState.lastDryRunCommand?.selectedSourceIndexes ?? [];
            const activeSources = selectedIndexes
              .map((index) => state.hdrModalState.stitchingSourcePaths[index])
              .filter((path): path is string => path !== undefined);
            // Native HDR completion receipts do not carry the frontend operation id, so ordered source identity
            // is the strongest available correlation guard until the backend event contract adds that token.
            if (
              !isMergeOperationActive(state.hdrModalState) ||
              !orderedMergeSourcesMatch(activeSources, payload.receipt.sourcePaths)
            ) {
              return {};
            }
            return {
              hdrModalState: {
                ...state.hdrModalState,
                activeOperationId: null,
                error: null,
                finalImageBase64: payload.base64,
                isProcessing: false,
                lastApplyCommand: buildHdrApplyCommandState({
                  acceptedDryRunPlanHash: payload.receipt.acceptedDryRunPlanHash,
                  acceptedDryRunPlanId: payload.receipt.acceptedDryRunPlanId,
                  base64Length: payload.base64.length,
                  outputHandle: payload.receipt.outputHandle,
                  previewDimensions: payload.receipt.previewDimensions,
                  sourceCount: payload.receipt.sourcePaths.length,
                  sourcePaths: payload.receipt.sourcePaths,
                }),
                progressMessage: 'Hdr Ready',
              },
            };
          });
        }
      }),
      listen<unknown>(HDR_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) =>
            !isMergeOperationActive(state.hdrModalState)
              ? {}
              : {
                  hdrModalState: {
                    ...state.hdrModalState,
                    activeOperationId: null,
                    error: parseStringPayload(event.payload),
                    finalImageBase64: null,
                    isProcessing: false,
                    progressMessage: 'An error occurred.',
                  },
                },
          );
        }
      }),
      listen<unknown>(CULLING_START_EVENT, (event) => {
        const total = parseCountPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: {
              ...state.cullingModalState,
              isOpen: true,
              progress: { current: 0, total, stage: 'Initializing...' },
              suggestions: null,
              error: null,
            },
          }));
        }
      }),
      listen<unknown>(CULLING_PROGRESS_EVENT, (event) => {
        const payload = parseCullingProgressPayload(event.payload);
        if (isEffectActive) {
          useUIStore
            .getState()
            .setUI((state) => ({ cullingModalState: { ...state.cullingModalState, progress: payload } }));
        }
      }),
      listen<unknown>(CULLING_COMPLETE_EVENT, (event) => {
        const payload = parseCullingSuggestionsPayload(event.payload);
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, suggestions: payload },
          }));
        }
      }),
      listen<unknown>(CULLING_ERROR_EVENT, (event) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, error: parseStringPayload(event.payload) },
          }));
        }
      }),
    ];

    return () => {
      isEffectActive = false;
      if (flushHandle.current !== null) {
        cancelAnimationFrame(flushHandle.current);
        flushHandle.current = null;
      }
      thumbnailBuffer.current = new Map();
      thumbnailCache.clearGeneration();
      smartPreviewBuffer.current = {};
      ratingBuffer.current = {};
      listeners.forEach((p) => {
        void p.then((unlisten) => {
          unlisten();
        });
      });
    };
  }, []);
}
