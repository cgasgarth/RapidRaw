import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useShallow } from 'zustand/react/shallow';
import { burstSrApplyReceiptSchema } from '../../schemas/computational-merge/burstSrApplySchemas';
import {
  singleImageX2ApplyReceiptSchema,
  singleImageX2PreviewSchema,
} from '../../schemas/computational-merge/singleImageX2Schemas';
import {
  burstSrCandidateJobHandleSchema,
  burstSrCandidateJobResultSchema,
} from '../../schemas/computational-merge/superResolutionCandidateRuntimeSchemas';
import { focusStackApplyReceiptSchema } from '../../schemas/focus-stack/focusStackApplySchemas';
import {
  focusStackCandidateJobHandleSchema,
  focusStackCandidateJobResultSchema,
} from '../../schemas/focus-stack/focusStackCandidateRuntimeSchemas';
import { focusStackNativeInputPlanSchema } from '../../schemas/focus-stack/focusStackNativePlanSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useHdrWorkflowStore } from '../../store/useHdrWorkflowStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useOperationLaunchStore } from '../../store/useOperationLaunchStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  createDefaultCollageModalState,
  createDefaultCullingModalState,
  createDefaultFocusStackModalState,
  createDefaultHdrModalState,
  createDefaultPanoramaModalState,
  createDefaultSuperResolutionModalState,
  type LazyComputationalModalId,
  useUIStore,
} from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import { thumbnailCache } from '../../thumbnails/thumbnailCacheInstance';
import type { CopyPasteSettings } from '../../utils/adjustments';
import { getComputationalMergeAppServerRoutePairSummary } from '../../utils/computational-merge/computationalMergeAppServerRoutePairs';
import {
  resetHdrStateForSettingsChange,
  resetPanoramaStateForSettingsChange,
} from '../../utils/computational-merge/computationalMergeModalState';
import {
  buildFocusStackDerivedOutputReceipt,
  buildSuperResolutionDerivedOutputReceipt,
} from '../../utils/derivedOutputReceipt';
import { registerCurrentDerivedOutputReceipt } from '../../utils/derivedOutputReceiptRegistration';
import { buildNativeFocusStackOutputReview } from '../../utils/focusStackOutputReview';
import { handleNegativeConversionEditorHandoff } from '../../utils/negative-lab/negativeLabEditorHandoff';
import { superResolutionNativeRegistrationPlanSchema } from '../../utils/superResolutionNativeReadiness';
import { buildSuperResolutionOutputReviewWorkflow } from '../../utils/superResolutionOutputReview';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import type { AlbumItem, AppSettings } from '../ui/AppProperties';
import CollageModal from './editing/CollageModal';
import CullingModal from './editing/CullingModal';
import DenoiseModal from './editing/DenoiseModal';
import CreateFolderModal from './library/CreateFolderModal';
import RenameFileModal from './library/RenameFileModal';
import RenameFolderModal from './library/RenameFolderModal';
import CommandPaletteModal from './navigation/CommandPaletteModal';
import ConfirmModal from './navigation/ConfirmModal';
import CopyPasteSettingsModal from './navigation/CopyPasteSettingsModal';
import ImportSettingsModal from './navigation/ImportSettingsModal';

const FocusStackModal = lazy(() =>
  import('./computational-merge/FocusStackModal.js').then((module) => ({ default: module.FocusStackModal })),
);
const HdrModal = lazy(() =>
  import('./computational-merge/HdrModal.js').then((module) => ({ default: module.HdrModal })),
);
const NegativeConversionModal = lazy(() =>
  import('./negative-lab/NegativeConversionModal.js').then((module) => ({ default: module.NegativeConversionModal })),
);
const PanoramaModal = lazy(() =>
  import('./computational-merge/PanoramaModal.js').then((module) => ({ default: module.PanoramaModal })),
);
const SuperResolutionModal = lazy(() =>
  import('./computational-merge/SuperResolutionModal.js').then((module) => ({ default: module.SuperResolutionModal })),
);

const useLazyModalSlot = (id: LazyComputationalModalId) => useUIStore((state) => state.mountedLazyModalIds.has(id));

interface DeleteOptions {
  includeAssociated: boolean;
}

interface ImportSettings {
  dateFolderFormat: string;
  deleteAfterImport: boolean;
  filenameTemplate: string;
  organizeByDate: boolean;
}

export interface AppModalsProps {
  handleImageSelect: (path: string) => Promise<void> | void;
  handleSavePanorama: () => Promise<string>;
  handleStartPanorama: (paths: string[], operationId: string) => void;
  handleSaveHdr: () => Promise<string>;
  handleStartHdr: (paths: string[], operationId: string) => void;
  requestThumbnails: (paths: string[]) => void;
  refreshImageList: () => Promise<void>;
  handleApplyDenoise: (intensity: number, method: 'ai' | 'bm3d') => Promise<void>;
  handleBatchDenoise: (intensity: number, method: 'ai' | 'bm3d', paths: string[]) => Promise<string[]>;
  handleSaveDenoisedImage: () => Promise<string>;
  handleCreateFolder: (folderName: string) => Promise<void>;
  handleRenameFolder: (newName: string) => Promise<void>;
  handleSaveRename: (nameTemplate: string) => Promise<void>;
  handleStartImport: (settings: ImportSettings) => Promise<void>;
  handleSetColorLabel: (color: string | null, paths?: string[]) => Promise<void>;
  handleRate: (rating: number, paths?: string[]) => void;
  executeDelete: (paths: string[], options: DeleteOptions) => Promise<void>;
  handleSaveCollage: (base64Data: string, firstPath: string) => Promise<string>;
  handleCreateAlbumItem: (name: string, type: 'album' | 'group') => Promise<void>;
  handleRenameAlbumItem: (newName: string) => Promise<void>;
  handleBackToLibrary: () => void;
}

export default function AppModals(props: AppModalsProps) {
  const { t } = useTranslation();
  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const {
    isCreateFolderModalOpen,
    isRenameFolderModalOpen,
    isRenameFileModalOpen,
    isImportModalOpen,
    isCopyPasteSettingsModalOpen,
    isCommandPaletteOpen,
    folderActionTarget,
    renameTargetPaths,
    importSourcePaths,
    isCreateAlbumModalOpen,
    isCreateAlbumGroupModalOpen,
    isRenameAlbumModalOpen,
    albumActionTarget,
    confirmModalState,
    panoramaModalState,
    hdrModalState,
    superResolutionModalState,
    focusStackModalState,
    negativeModalState,
    denoiseModalState,
    cullingModalState,
    collageModalState,
    setUI,
  } = useUIStore(
    useShallow((state) => ({
      isCreateFolderModalOpen: state.isCreateFolderModalOpen,
      isRenameFolderModalOpen: state.isRenameFolderModalOpen,
      isRenameFileModalOpen: state.isRenameFileModalOpen,
      isImportModalOpen: state.isImportModalOpen,
      isCopyPasteSettingsModalOpen: state.isCopyPasteSettingsModalOpen,
      isCommandPaletteOpen: state.isCommandPaletteOpen,
      folderActionTarget: state.folderActionTarget,
      renameTargetPaths: state.renameTargetPaths,
      importSourcePaths: state.importSourcePaths,
      isCreateAlbumModalOpen: state.isCreateAlbumModalOpen,
      isCreateAlbumGroupModalOpen: state.isCreateAlbumGroupModalOpen,
      isRenameAlbumModalOpen: state.isRenameAlbumModalOpen,
      albumActionTarget: state.albumActionTarget,
      confirmModalState: state.confirmModalState,
      panoramaModalState: state.panoramaModalState,
      hdrModalState: state.hdrModalState,
      superResolutionModalState: state.superResolutionModalState,
      focusStackModalState: state.focusStackModalState,
      negativeModalState: state.negativeModalState,
      denoiseModalState: state.denoiseModalState,
      cullingModalState: state.cullingModalState,
      collageModalState: state.collageModalState,
      setUI: state.setUI,
    })),
  );

  const { aiModelDownloadStatus } = useProcessStore(
    useShallow((state) => ({
      aiModelDownloadStatus: state.aiModelDownloadStatus,
    })),
  );

  const { selectedImage, finalPreviewUrl, historyIndex } = useEditorStore(
    useShallow((state) => ({
      selectedImage: state.selectedImage,
      finalPreviewUrl: state.finalPreviewUrl,
      historyIndex: state.historyIndex,
    })),
  );

  const [singleImagePreviewRunning, setSingleImagePreviewRunning] = useState(false);
  const [singleImageApplyRunning, setSingleImageApplyRunning] = useState(false);
  const hasLoadedPanoramaModal = useLazyModalSlot('panorama');
  const hasLoadedHdrModal = useLazyModalSlot('hdr');
  const hasLoadedSuperResolutionModal = useLazyModalSlot('superResolution');
  const hasLoadedFocusStackModal = useLazyModalSlot('focusStack');
  const hasLoadedNegativeLabModal = useLazyModalSlot('negativeLab');
  const focusStackPlanRequestId = useRef(0);
  const superResolutionPlanRequestId = useRef(0);

  const closeConfirmModal = () => {
    setUI((state) => ({ confirmModalState: { ...state.confirmModalState, isOpen: false } }));
  };

  const currentAlbumData = (() => {
    if (!albumActionTarget) return null;
    const { albumTree } = useLibraryStore.getState();
    const findNode = (nodes: AlbumItem[]): AlbumItem | null => {
      for (const n of nodes) {
        if (n.id === albumActionTarget) return n;
        if (n.type === 'group') {
          const res = findNode(n.children);
          if (res) return res;
        }
      }
      return null;
    };
    return findNode(albumTree);
  })();

  const currentAlbumName = currentAlbumData?.name || '';
  const isAlbumGroup = currentAlbumData?.type === 'group';

  return (
    <>
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onBackToLibrary={props.handleBackToLibrary}
        onClose={() => {
          setUI({ isCommandPaletteOpen: false });
        }}
      />
      <CopyPasteSettingsModal
        isOpen={isCopyPasteSettingsModalOpen}
        onClose={() => {
          setUI({ isCopyPasteSettingsModalOpen: false });
        }}
        settings={appSettings?.copyPasteSettings as CopyPasteSettings}
        onSave={(newSettings) => {
          void handleSettingsChange({ ...appSettings, copyPasteSettings: newSettings } as AppSettings);
        }}
      />
      {hasLoadedPanoramaModal && (
        <Suspense fallback={null}>
          <PanoramaModal
            error={panoramaModalState.error}
            finalImageBase64={panoramaModalState.finalImageBase64}
            imageCount={panoramaModalState.stitchingSourcePaths.length}
            isOpen={panoramaModalState.isOpen}
            isProcessing={panoramaModalState.isProcessing}
            lastApplyCommand={panoramaModalState.lastApplyCommand}
            lastDryRunCommand={panoramaModalState.lastDryRunCommand}
            loadingImageUrl={
              panoramaModalState.stitchingSourcePaths.length > 0
                ? thumbnailCache.get(
                    panoramaModalState.stitchingSourcePaths[
                      Math.floor(panoramaModalState.stitchingSourcePaths.length / 2)
                    ] ?? '',
                  )?.url || null
                : null
            }
            onClose={() => {
              if (panoramaModalState.alignmentCancellationId !== null) {
                void invoke(Invokes.CancelPanoramaAlignment, {
                  cancellationId: panoramaModalState.alignmentCancellationId,
                });
              }
              const launchId = useOperationLaunchStore.getState().launches.panorama?.launchId;
              if (launchId !== undefined) useOperationLaunchStore.getState().close('panorama', launchId);
              setUI({
                panoramaModalState: createDefaultPanoramaModalState(panoramaModalState.settings),
              });
            }}
            onOpenFile={(path: string) => {
              void props.handleImageSelect(path);
            }}
            onSave={props.handleSavePanorama}
            onStitch={(operationId) => {
              props.handleStartPanorama(panoramaModalState.stitchingSourcePaths, operationId);
            }}
            onSettingsChange={(settings) => {
              setUI((state) => ({
                panoramaModalState: resetPanoramaStateForSettingsChange(state.panoramaModalState, settings),
              }));
            }}
            progressMessage={panoramaModalState.progressMessage}
            renderedReview={panoramaModalState.renderedReview}
            runtimePlan={panoramaModalState.runtimePlan}
            settings={panoramaModalState.settings}
            sourcePaths={panoramaModalState.stitchingSourcePaths}
          />
        </Suspense>
      )}
      {hasLoadedHdrModal && (
        <Suspense fallback={null}>
          <HdrModal
            error={hdrModalState.error}
            finalImageBase64={hdrModalState.finalImageBase64}
            imageCount={hdrModalState.stitchingSourcePaths.length}
            isOpen={hdrModalState.isOpen}
            isProcessing={hdrModalState.isProcessing}
            lastApplyCommand={hdrModalState.lastApplyCommand}
            lastDryRunCommand={hdrModalState.lastDryRunCommand}
            loadingImageUrl={
              hdrModalState.stitchingSourcePaths.length > 0
                ? thumbnailCache.get(
                    hdrModalState.stitchingSourcePaths[Math.floor(hdrModalState.stitchingSourcePaths.length / 2)] ?? '',
                  )?.url || null
                : null
            }
            onClose={() => {
              const launchId = useOperationLaunchStore.getState().launches.hdr?.launchId;
              if (launchId !== undefined) {
                useHdrWorkflowStore.getState().close(launchId);
                useOperationLaunchStore.getState().close('hdr', launchId);
              }
              setUI({
                hdrModalState: createDefaultHdrModalState(hdrModalState.settings),
              });
            }}
            onOpenFile={(path: string) => {
              void props.handleImageSelect(path);
            }}
            onSave={props.handleSaveHdr}
            onMerge={(operationId) => {
              props.handleStartHdr(hdrModalState.stitchingSourcePaths, operationId);
            }}
            onSettingsChange={(settings) => {
              const launchId = useOperationLaunchStore.getState().launches.hdr?.launchId;
              if (launchId !== undefined)
                useHdrWorkflowStore.getState().dispatch({ type: 'settings', launchId, settings });
              setUI((state) => ({
                hdrModalState: resetHdrStateForSettingsChange(state.hdrModalState, settings),
              }));
            }}
            progressMessage={hdrModalState.progressMessage}
            runtimePlan={hdrModalState.runtimePlan}
            settings={hdrModalState.settings}
            sourceMetadata={hdrModalState.sourceMetadata}
            sourcePaths={hdrModalState.stitchingSourcePaths}
          />
        </Suspense>
      )}
      {hasLoadedSuperResolutionModal && (
        <Suspense fallback={null}>
          <SuperResolutionModal
            applyReceipt={superResolutionModalState.applyReceipt ?? null}
            isOpen={superResolutionModalState.isOpen}
            lastApplyCommand={superResolutionModalState.lastApplyCommand}
            lastDryRunCommand={superResolutionModalState.lastDryRunCommand}
            loadingImageUrl={
              superResolutionModalState.sourcePaths.length > 0
                ? thumbnailCache.get(
                    superResolutionModalState.sourcePaths[
                      Math.floor(superResolutionModalState.sourcePaths.length / 2)
                    ] ?? '',
                  )?.url || null
                : selectedImage
                  ? finalPreviewUrl
                  : null
            }
            onClose={() => {
              superResolutionPlanRequestId.current += 1;
              if (
                superResolutionModalState.candidateJobId !== null &&
                superResolutionModalState.candidateJobId !== undefined
              )
                void invoke(Invokes.CancelComputationalMergeJob, {
                  jobId: superResolutionModalState.candidateJobId,
                });
              setUI((state) => ({
                superResolutionModalState: createDefaultSuperResolutionModalState(
                  state.superResolutionModalState.settings,
                ),
              }));
            }}
            onOpenOutput={(path) => {
              void props.handleImageSelect(path);
            }}
            onApplySingleImage={() => {
              void (async () => {
                const preview = superResolutionModalState.singleImagePreview;
                if (preview === null) throw new Error('Enhance x2 review is required before apply.');
                const slash = preview.sourcePath.lastIndexOf('/');
                const destinationDirectory = slash >= 0 ? preview.sourcePath.slice(0, slash) : '.';
                const sourceName = slash >= 0 ? preview.sourcePath.slice(slash + 1) : preview.sourcePath;
                const sourceStem = sourceName.replace(/\.[^.]+$/, '');
                setSingleImageApplyRunning(true);
                try {
                  const receipt = await invokeWithSchema(
                    Invokes.ApplySingleImageX2,
                    {
                      request: {
                        sourcePath: preview.sourcePath,
                        graphRevision: preview.graphRevision,
                        acceptedReviewHash: preview.review.outputHash,
                        destinationDirectory,
                        requestedName: `${sourceStem}-Enhanced-x2`,
                      },
                    },
                    singleImageX2ApplyReceiptSchema,
                  );
                  setUI((state) => ({
                    superResolutionModalState: {
                      ...state.superResolutionModalState,
                      singleImageApplyReceipt: receipt,
                    },
                  }));
                  await props.refreshImageList();
                  await props.handleImageSelect(receipt.payloadPath);
                } finally {
                  setSingleImageApplyRunning(false);
                }
              })().catch((error: unknown) => {
                console.error('Single-image Enhance x2 apply failed', error);
              });
            }}
            onApplyPlan={() => {
              void (async () => {
                const candidate = superResolutionModalState.candidateJob?.candidate;
                const readiness = superResolutionModalState.nativeReadiness;
                const referencePath =
                  superResolutionModalState.sourcePaths[readiness?.registration?.referenceSourceIndex ?? 0];
                if (candidate === null || candidate === undefined || readiness === null || referencePath === undefined)
                  return;
                const slash = Math.max(referencePath.lastIndexOf('/'), referencePath.lastIndexOf('\\'));
                const destinationDirectory = slash >= 0 ? referencePath.slice(0, slash) : '.';
                const sourceName = slash >= 0 ? referencePath.slice(slash + 1) : referencePath;
                const sourceStem = sourceName.replace(/\.[^.]+$/, '');
                const receipt = await invokeWithSchema(
                  Invokes.ApplyBurstSrCandidate,
                  {
                    request: {
                      candidateId: candidate.packageId,
                      acceptedReviewHash: candidate.candidateHash,
                      destinationDirectory,
                      requestedName: `${sourceStem}-Burst-SR-x2`,
                    },
                  },
                  burstSrApplyReceiptSchema,
                );
                setUI((state) => ({
                  superResolutionModalState: { ...state.superResolutionModalState, applyReceipt: receipt },
                }));
                await props.refreshImageList();
                await props.handleImageSelect(receipt.payloadPath);
              })().catch((error: unknown) => console.error('Burst x2 apply failed', error));
            }}
            onPrepareCandidate={() => {
              const acceptedReviewId = superResolutionModalState.nativeReadiness?.acceptedDryRunPlanId;
              if (acceptedReviewId === undefined) return;
              void invokeWithSchema(
                Invokes.PrepareBurstSrCandidate,
                { acceptedReviewId, memoryBudgetBytes: 512 * 1024 * 1024 },
                burstSrCandidateJobHandleSchema,
              ).then((handle) => {
                setUI((state) => ({
                  superResolutionModalState: {
                    ...state.superResolutionModalState,
                    candidateJobId: handle.jobId,
                    candidateJob: null,
                  },
                }));
                const poll = window.setInterval(() => {
                  void invokeWithSchema(
                    Invokes.ReadBurstSrCandidateJob,
                    { jobId: handle.jobId },
                    burstSrCandidateJobResultSchema,
                  ).then((candidateJob) => {
                    setUI((state) => ({
                      superResolutionModalState: { ...state.superResolutionModalState, candidateJob },
                    }));
                    if (['succeeded', 'failed', 'cancelled'].includes(candidateJob.status)) window.clearInterval(poll);
                  });
                }, 250);
              });
            }}
            onCancelCandidate={() => {
              const jobId = superResolutionModalState.candidateJobId;
              if (jobId !== null && jobId !== undefined) void invoke(Invokes.CancelComputationalMergeJob, { jobId });
            }}
            candidateJob={superResolutionModalState.candidateJob ?? null}
            onPreviewPlan={() => {
              const requestId = superResolutionPlanRequestId.current + 1;
              superResolutionPlanRequestId.current = requestId;
              void (async () => {
                if (superResolutionModalState.settings.sourceMode === 'single_image_ai_x2') {
                  if (!selectedImage) throw new Error('Single-image AI x2 requires the current image.');
                  setSingleImagePreviewRunning(true);
                  try {
                    const preview = await invokeWithSchema(
                      Invokes.PreviewSingleImageX2,
                      {
                        request: {
                          sourcePath: selectedImage,
                          graphRevision: `history_${historyIndex}`,
                        },
                      },
                      singleImageX2PreviewSchema,
                    );
                    if (superResolutionPlanRequestId.current !== requestId) return;
                    setUI((state) => ({
                      superResolutionModalState: {
                        ...state.superResolutionModalState,
                        nativeReadiness: null,
                        outputReview: null,
                        singleImagePreview: preview,
                        singleImageApplyReceipt: null,
                      },
                    }));
                  } finally {
                    setSingleImagePreviewRunning(false);
                  }
                  return;
                }
                const readiness = await invokeWithSchema(
                  Invokes.PlanSuperResolution,
                  {
                    paths: superResolutionModalState.sourcePaths,
                    settings: superResolutionModalState.settings,
                  },
                  superResolutionNativeRegistrationPlanSchema,
                );
                if (superResolutionPlanRequestId.current !== requestId) return;
                const lastDryRunCommand = {
                  commandType: 'computationalMerge.createSuperResolution' as const,
                  dryRun: true as const,
                  sources: superResolutionModalState.sourcePaths.length,
                  toolName: getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName,
                };
                const { lastApplyCommand: _lastApplyCommand, ...nextSuperResolutionModalState } =
                  superResolutionModalState;
                const outputReview = buildSuperResolutionOutputReviewWorkflow({
                  artifactPath: superResolutionModalState.sourcePaths[0] ?? '',
                  settings: superResolutionModalState.settings,
                  sourceCount: Math.max(2, superResolutionModalState.sourcePaths.length),
                  sourcePaths: superResolutionModalState.sourcePaths,
                  nativeReadiness: readiness,
                });
                registerCurrentDerivedOutputReceipt({
                  build: () =>
                    buildSuperResolutionDerivedOutputReceipt({
                      review: outputReview,
                      settings: superResolutionModalState.settings,
                    }),
                  isCurrent: () => superResolutionPlanRequestId.current === requestId,
                  onRegistrationError: (error) =>
                    console.error('Super-resolution provenance registration failed', error),
                  upsert: useUIStore.getState().upsertDerivedOutputReceipt,
                });
                if (superResolutionPlanRequestId.current !== requestId) return;
                setUI({
                  superResolutionModalState: {
                    ...nextSuperResolutionModalState,
                    lastDryRunCommand,
                    nativeReadiness: readiness,
                    outputReview,
                    singleImagePreview: null,
                    singleImageApplyReceipt: null,
                  },
                });
              })().catch((error: unknown) => {
                console.error('Super-resolution native readiness failed', error);
              });
            }}
            onSettingsChange={(settings) => {
              superResolutionPlanRequestId.current += 1;
              setUI((state) => {
                const {
                  lastApplyCommand: _lastApplyCommand,
                  lastDryRunCommand: _lastDryRunCommand,
                  ...superResolutionModalState
                } = state.superResolutionModalState;
                return {
                  superResolutionModalState: {
                    ...superResolutionModalState,
                    nativeReadiness: null,
                    outputReview: null,
                    singleImagePreview: null,
                    settings,
                  },
                };
              });
            }}
            outputReview={superResolutionModalState.outputReview}
            singleImagePreview={superResolutionModalState.singleImagePreview}
            singleImageApplyReceipt={superResolutionModalState.singleImageApplyReceipt ?? null}
            singleImagePreviewRunning={singleImagePreviewRunning}
            singleImageApplyRunning={singleImageApplyRunning}
            onCancelSingleImagePreview={() => {
              void invokeWithSchema(Invokes.CancelSingleImageX2Preview, {}, z.boolean());
            }}
            nativeReadiness={superResolutionModalState.nativeReadiness ?? null}
            settings={superResolutionModalState.settings}
            sourceCount={superResolutionModalState.sourcePaths.length}
            sourcePaths={superResolutionModalState.sourcePaths}
            sourcePreflightMetadata={superResolutionModalState.sourcePreflightMetadata}
          />
        </Suspense>
      )}
      {hasLoadedFocusStackModal && (
        <Suspense fallback={null}>
          <FocusStackModal
            applyReceipt={focusStackModalState.applyReceipt ?? null}
            isOpen={focusStackModalState.isOpen}
            lastApplyCommand={focusStackModalState.lastApplyCommand}
            lastDryRunCommand={focusStackModalState.lastDryRunCommand}
            loadingImageUrl={
              focusStackModalState.sourcePaths.length > 0
                ? thumbnailCache.get(
                    focusStackModalState.sourcePaths[Math.floor(focusStackModalState.sourcePaths.length / 2)] ?? '',
                  )?.url || null
                : selectedImage
                  ? finalPreviewUrl
                  : null
            }
            onClose={() => {
              focusStackPlanRequestId.current += 1;
              if (focusStackModalState.candidateJobId !== undefined && focusStackModalState.candidateJobId !== null)
                void invoke(Invokes.CancelComputationalMergeJob, {
                  jobId: focusStackModalState.candidateJobId,
                });
              void invoke(Invokes.CancelFocusStackPlan);
              setUI((state) => ({
                focusStackModalState: createDefaultFocusStackModalState(state.focusStackModalState.settings),
              }));
            }}
            onApplyPlan={() => {
              void (async () => {
                const candidate = focusStackModalState.candidateJob?.candidate;
                const plan = focusStackModalState.nativeInputPlan;
                if (candidate === null || candidate === undefined || plan === null) return;
                const referencePath = focusStackModalState.sourcePaths[plan.referenceSourceIndex];
                if (referencePath === undefined) return;
                const slash = Math.max(referencePath.lastIndexOf('/'), referencePath.lastIndexOf('\\'));
                const destinationDirectory = slash >= 0 ? referencePath.slice(0, slash) : '.';
                const sourceName = slash >= 0 ? referencePath.slice(slash + 1) : referencePath;
                const sourceStem = sourceName.replace(/\.[^.]+$/, '');
                try {
                  const receipt = await invokeWithSchema(
                    Invokes.ApplyFocusStackCandidate,
                    {
                      request: {
                        candidateId: candidate.packageId,
                        acceptedPreviewHash: plan.nativeBlend?.previewHash ?? '',
                        acceptedReviewHash: candidate.candidateHash,
                        destinationDirectory,
                        requestedName: `${sourceStem}-Focus-Stack`,
                      },
                    },
                    focusStackApplyReceiptSchema,
                  );
                  setUI((state) => ({
                    focusStackModalState: {
                      ...state.focusStackModalState,
                      applyReceipt: receipt,
                      error: null,
                    },
                  }));
                  await props.refreshImageList();
                  await props.handleImageSelect(receipt.payloadPath);
                } catch (error) {
                  setUI((state) => ({
                    focusStackModalState: {
                      ...state.focusStackModalState,
                      error: error instanceof Error ? error.message : String(error),
                    },
                  }));
                }
              })();
            }}
            onOpenOutput={(path) => void props.handleImageSelect(path)}
            onPrepareCandidate={() => {
              const acceptedPreviewId = focusStackModalState.nativeInputPlan?.acceptedDryRunPlanId;
              if (acceptedPreviewId === undefined) return;
              void invokeWithSchema(
                Invokes.PrepareFocusStackCandidate,
                { acceptedPreviewId, memoryBudgetBytes: 512 * 1024 * 1024 },
                focusStackCandidateJobHandleSchema,
              ).then((handle) => {
                setUI((state) => ({
                  focusStackModalState: { ...state.focusStackModalState, candidateJobId: handle.jobId },
                }));
                const poll = window.setInterval(() => {
                  void invokeWithSchema(
                    Invokes.ReadFocusStackJob,
                    { jobId: handle.jobId },
                    focusStackCandidateJobResultSchema,
                  ).then((candidateJob) => {
                    setUI((state) => ({ focusStackModalState: { ...state.focusStackModalState, candidateJob } }));
                    if (
                      candidateJob.status === 'succeeded' ||
                      candidateJob.status === 'failed' ||
                      candidateJob.status === 'cancelled'
                    )
                      window.clearInterval(poll);
                  });
                }, 250);
              });
            }}
            onCancelCandidate={() => {
              const jobId = focusStackModalState.candidateJobId;
              if (jobId !== undefined)
                void invokeWithSchema(Invokes.CancelComputationalMergeJob, { jobId }, z.boolean());
            }}
            candidateJob={focusStackModalState.candidateJob}
            onPreviewPlan={() => {
              const requestId = focusStackPlanRequestId.current + 1;
              focusStackPlanRequestId.current = requestId;
              const lastDryRunCommand = {
                commandType: 'computationalMerge.createFocusStack' as const,
                dryRun: true as const,
                haloSuppressionStrengthPercent: focusStackModalState.settings.haloSuppressionStrengthPercent,
                sources: focusStackModalState.sourcePaths.length,
                toolName: getComputationalMergeAppServerRoutePairSummary('focus_stack').dryRunToolName,
              };
              setUI({
                focusStackModalState: {
                  ...focusStackModalState,
                  error: null,
                  isPlanning: true,
                  lastDryRunCommand,
                  nativeInputPlan: null,
                  outputReview: null,
                },
              });
              void invokeWithSchema(
                Invokes.PlanFocusStack,
                {
                  graphRevisions: focusStackModalState.sourcePreflightMetadata.map(
                    (source) => source.graphRevision ?? 'library:unknown:neutral',
                  ),
                  orderedSourceIds: focusStackModalState.sourcePaths.map((_, index) => `selected-source-${index}`),
                  paths: focusStackModalState.sourcePaths,
                  settings: {
                    commonCropIdentity: 'common:uncropped',
                    lensCorrectionIdentity: 'native_lens_policy_v1',
                    neutralRawState: true,
                    orientationIdentity: 'common:decoded_orientation',
                    haloSuppressionStrengthPercent: focusStackModalState.settings.haloSuppressionStrengthPercent,
                  },
                },
                focusStackNativeInputPlanSchema,
              )
                .then((nativeInputPlan) => {
                  if (focusStackPlanRequestId.current !== requestId) return;
                  const state = useUIStore.getState().focusStackModalState;
                  const outputReview =
                    nativeInputPlan.accepted && nativeInputPlan.focusEvidence !== null
                      ? buildNativeFocusStackOutputReview(nativeInputPlan, state.settings, state.sourcePaths)
                      : null;
                  if (outputReview !== null) {
                    registerCurrentDerivedOutputReceipt({
                      build: () =>
                        buildFocusStackDerivedOutputReceipt({
                          acceptedDryRunPlanHash: state.lastApplyCommand?.acceptedDryRunPlanHash,
                          acceptedDryRunPlanId: state.lastApplyCommand?.acceptedDryRunPlanId,
                          review: outputReview,
                          settings: state.settings,
                        }),
                      isCurrent: () => focusStackPlanRequestId.current === requestId,
                      onRegistrationError: (error) =>
                        console.error('Focus-stack provenance registration failed', error),
                      upsert: useUIStore.getState().upsertDerivedOutputReceipt,
                    });
                  }
                  if (focusStackPlanRequestId.current !== requestId) return;
                  setUI((state) => ({
                    focusStackModalState: {
                      ...state.focusStackModalState,
                      isPlanning: false,
                      nativeInputPlan,
                      outputReview,
                    },
                  }));
                })
                .catch((error: unknown) => {
                  if (focusStackPlanRequestId.current !== requestId) return;
                  setUI((state) => ({
                    focusStackModalState: {
                      ...state.focusStackModalState,
                      error: error instanceof Error ? error.message : String(error),
                      isPlanning: false,
                      nativeInputPlan: null,
                    },
                  }));
                });
            }}
            onSettingsChange={(settings) => {
              const invalidatesAlignment =
                settings.alignmentMode !== focusStackModalState.settings.alignmentMode ||
                settings.maxPreviewDimensionPx !== focusStackModalState.settings.maxPreviewDimensionPx;
              if (invalidatesAlignment) {
                focusStackPlanRequestId.current += 1;
                void invoke(Invokes.CancelFocusStackPlan);
              }
              setUI((state) => {
                const {
                  lastApplyCommand: _lastApplyCommand,
                  lastDryRunCommand: _lastDryRunCommand,
                  ...focusStackModalState
                } = state.focusStackModalState;
                return {
                  focusStackModalState: {
                    ...focusStackModalState,
                    error: null,
                    nativeInputPlan: invalidatesAlignment ? null : focusStackModalState.nativeInputPlan,
                    outputReview: null,
                    settings,
                  },
                };
              });
            }}
            outputReview={focusStackModalState.outputReview}
            nativeInputPlan={focusStackModalState.nativeInputPlan}
            nativePlanError={focusStackModalState.error}
            isNativePlanning={focusStackModalState.isPlanning}
            settings={focusStackModalState.settings}
            sourceCount={focusStackModalState.sourcePaths.length}
            sourcePaths={focusStackModalState.sourcePaths}
            sourcePreflightMetadata={focusStackModalState.sourcePreflightMetadata}
          />
        </Suspense>
      )}
      {hasLoadedNegativeLabModal && (
        <Suspense fallback={null}>
          <NegativeConversionModal
            isOpen={negativeModalState.isOpen}
            onClose={() => {
              setUI((state) => ({ negativeModalState: { ...state.negativeModalState, isOpen: false } }));
            }}
            targetPaths={negativeModalState.targetPaths}
            onSave={(savedPaths, handoff) => {
              void handleNegativeConversionEditorHandoff({
                handleImageSelect: props.handleImageSelect,
                handoff,
                onRefreshError: (err) => {
                  console.error('Failed to refresh image list after negative conversion:', err);
                },
                requestThumbnails: props.requestThumbnails,
                refreshImageList: props.refreshImageList,
                savedPaths,
              });
            }}
          />
        </Suspense>
      )}
      <DenoiseModal
        isOpen={denoiseModalState.isOpen}
        onClose={() => {
          setUI((state) => ({ denoiseModalState: { ...state.denoiseModalState, isOpen: false } }));
        }}
        onDenoise={(intensity, method) => {
          void props.handleApplyDenoise(intensity, method);
        }}
        onBatchDenoise={props.handleBatchDenoise}
        onSave={props.handleSaveDenoisedImage}
        onOpenFile={(path) => {
          void props.handleImageSelect(path);
        }}
        previewBase64={denoiseModalState.previewBase64}
        originalBase64={denoiseModalState.originalBase64 || null}
        isProcessing={denoiseModalState.isProcessing}
        error={denoiseModalState.error}
        progressMessage={denoiseModalState.progressMessage}
        aiModelDownloadStatus={aiModelDownloadStatus}
        isRaw={denoiseModalState.isRaw}
        targetPaths={denoiseModalState.targetPaths}
        loadingImageUrl={
          denoiseModalState.targetPaths.length > 0
            ? thumbnailCache.get(denoiseModalState.targetPaths[0] ?? '')?.url ||
              (selectedImage?.path === denoiseModalState.targetPaths[0] ? finalPreviewUrl : null)
            : null
        }
      />
      <CreateFolderModal
        isOpen={isCreateFolderModalOpen}
        operationScope={`library-folder:${folderActionTarget ?? ''}`}
        onClose={() => {
          setUI({ isCreateFolderModalOpen: false });
        }}
        onSave={(folderName) => {
          void props.handleCreateFolder(folderName);
        }}
      />
      <RenameFolderModal
        currentName={folderActionTarget ? folderActionTarget.split(/[\\/]/).pop() || '' : ''}
        isOpen={isRenameFolderModalOpen}
        operationScope={`library-folder:${folderActionTarget ?? ''}`}
        onClose={() => {
          setUI({ isRenameFolderModalOpen: false });
        }}
        onSave={(newName) => {
          void props.handleRenameFolder(newName);
        }}
      />
      <CreateFolderModal
        isOpen={isCreateAlbumModalOpen}
        operationScope={`album:${albumActionTarget ?? 'root'}`}
        onClose={() => {
          setUI({ isCreateAlbumModalOpen: false });
        }}
        onSave={(name) => {
          void props.handleCreateAlbumItem(name, 'album');
        }}
        title={t('contextMenus.albums.newAlbum')}
        placeholder={t('modals.createAlbum.placeholder')}
        buttonText={t('modals.createFolder.create')}
      />
      <CreateFolderModal
        isOpen={isCreateAlbumGroupModalOpen}
        operationScope={`album-group:${albumActionTarget ?? 'root'}`}
        onClose={() => {
          setUI({ isCreateAlbumGroupModalOpen: false });
        }}
        onSave={(name) => {
          void props.handleCreateAlbumItem(name, 'group');
        }}
        title={t('contextMenus.albums.newGroup')}
        placeholder={t('modals.createGroup.placeholder')}
        buttonText={t('modals.createFolder.create')}
      />
      <RenameFolderModal
        currentName={currentAlbumName}
        isOpen={isRenameAlbumModalOpen}
        operationScope={`album-item:${albumActionTarget ?? ''}`}
        onClose={() => {
          setUI({ isRenameAlbumModalOpen: false });
        }}
        onSave={(newName) => {
          void props.handleRenameAlbumItem(newName);
        }}
        title={isAlbumGroup ? t('contextMenus.albums.renameGroup') : t('contextMenus.albums.renameAlbum')}
        placeholder={isAlbumGroup ? t('modals.renameGroup.placeholder') : t('modals.renameAlbum.placeholder')}
      />
      <RenameFileModal
        filesToRename={renameTargetPaths}
        isOpen={isRenameFileModalOpen}
        onClose={() => {
          setUI({ isRenameFileModalOpen: false });
        }}
        onSave={(nameTemplate) => {
          void props.handleSaveRename(nameTemplate);
        }}
      />
      <ConfirmModal {...confirmModalState} onClose={closeConfirmModal} />
      <ImportSettingsModal
        fileCount={importSourcePaths.length}
        isOpen={isImportModalOpen}
        onClose={() => {
          setUI({ isImportModalOpen: false });
        }}
        onSave={(settings) => {
          void props.handleStartImport(settings);
        }}
      />
      <CullingModal
        isOpen={cullingModalState.isOpen}
        onClose={() => {
          setUI({ cullingModalState: createDefaultCullingModalState() });
        }}
        progress={cullingModalState.progress}
        suggestions={cullingModalState.suggestions}
        error={cullingModalState.error}
        imagePaths={cullingModalState.pathsToCull}
        getThumbnailUrl={(path) => thumbnailCache.get(path)?.url ?? null}
        onApply={(action, paths) => {
          if (action === 'reject') {
            void props.handleSetColorLabel('red', paths);
          } else if (action === 'rate_zero') {
            props.handleRate(1, paths);
          } else {
            void props.executeDelete(paths, { includeAssociated: false });
          }
          setUI({ cullingModalState: createDefaultCullingModalState() });
        }}
        onError={(err) => {
          setUI((state) => ({ cullingModalState: { ...state.cullingModalState, error: err, progress: null } }));
        }}
      />
      <CollageModal
        isOpen={collageModalState.isOpen}
        onClose={() => {
          setUI({ collageModalState: createDefaultCollageModalState() });
        }}
        onSave={props.handleSaveCollage}
        sourceImages={collageModalState.sourceImages}
      />
    </>
  );
}
