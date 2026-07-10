import { invoke } from '@tauri-apps/api/core';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  createDefaultCollageModalState,
  createDefaultCullingModalState,
  createDefaultFocusStackModalState,
  createDefaultHdrModalState,
  createDefaultPanoramaModalState,
  createDefaultSuperResolutionModalState,
  useUIStore,
} from '../../store/useUIStore';
import { Invokes } from '../../tauri/commands';
import type { CopyPasteSettings } from '../../utils/adjustments';
import { getComputationalMergeAppServerRoutePairSummary } from '../../utils/computational-merge/computationalMergeAppServerRoutePairs';
import {
  resetHdrStateForSettingsChange,
  resetPanoramaStateForSettingsChange,
} from '../../utils/computational-merge/computationalMergeModalState';
import {
  buildFocusStackOutputReviewWorkflow,
  markFocusStackOutputReviewApplyReady,
} from '../../utils/focusStackOutputReview';
import { handleNegativeConversionEditorHandoff } from '../../utils/negative-lab/negativeLabEditorHandoff';
import type { SuperResolutionNativeReadiness } from '../../utils/superResolutionNativeReadiness';
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
  handleStartPanorama: (paths: string[]) => void;
  handleSaveHdr: () => Promise<string>;
  handleStartHdr: (paths: string[]) => void;
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

  const { thumbnails, aiModelDownloadStatus } = useProcessStore(
    useShallow((state) => ({
      thumbnails: state.thumbnails,
      aiModelDownloadStatus: state.aiModelDownloadStatus,
    })),
  );

  const { selectedImage, finalPreviewUrl } = useEditorStore(
    useShallow((state) => ({
      selectedImage: state.selectedImage,
      finalPreviewUrl: state.finalPreviewUrl,
    })),
  );

  const [hasLoadedPanoramaModal, setHasLoadedPanoramaModal] = useState(panoramaModalState.isOpen);
  const [hasLoadedHdrModal, setHasLoadedHdrModal] = useState(hdrModalState.isOpen);
  const [hasLoadedSuperResolutionModal, setHasLoadedSuperResolutionModal] = useState(superResolutionModalState.isOpen);
  const [hasLoadedFocusStackModal, setHasLoadedFocusStackModal] = useState(focusStackModalState.isOpen);

  useEffect(() => {
    if (panoramaModalState.isOpen) setHasLoadedPanoramaModal(true);
  }, [panoramaModalState.isOpen]);

  useEffect(() => {
    if (hdrModalState.isOpen) setHasLoadedHdrModal(true);
  }, [hdrModalState.isOpen]);

  useEffect(() => {
    if (superResolutionModalState.isOpen) setHasLoadedSuperResolutionModal(true);
  }, [superResolutionModalState.isOpen]);

  useEffect(() => {
    if (focusStackModalState.isOpen) setHasLoadedFocusStackModal(true);
  }, [focusStackModalState.isOpen]);

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
                ? thumbnails[
                    panoramaModalState.stitchingSourcePaths[
                      Math.floor(panoramaModalState.stitchingSourcePaths.length / 2)
                    ] ?? ''
                  ] || null
                : null
            }
            onClose={() => {
              setUI({
                panoramaModalState: createDefaultPanoramaModalState(panoramaModalState.settings),
              });
            }}
            onOpenFile={(path: string) => {
              void props.handleImageSelect(path);
            }}
            onSave={props.handleSavePanorama}
            onStitch={() => {
              props.handleStartPanorama(panoramaModalState.stitchingSourcePaths);
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
                ? thumbnails[
                    hdrModalState.stitchingSourcePaths[Math.floor(hdrModalState.stitchingSourcePaths.length / 2)] ?? ''
                  ] || null
                : null
            }
            onClose={() => {
              setUI({
                hdrModalState: createDefaultHdrModalState(hdrModalState.settings),
              });
            }}
            onOpenFile={(path: string) => {
              void props.handleImageSelect(path);
            }}
            onSave={props.handleSaveHdr}
            onMerge={() => {
              props.handleStartHdr(hdrModalState.stitchingSourcePaths);
            }}
            onSettingsChange={(settings) => {
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
            isOpen={superResolutionModalState.isOpen}
            lastApplyCommand={superResolutionModalState.lastApplyCommand}
            lastDryRunCommand={superResolutionModalState.lastDryRunCommand}
            loadingImageUrl={
              superResolutionModalState.sourcePaths.length > 0
                ? thumbnails[
                    superResolutionModalState.sourcePaths[
                      Math.floor(superResolutionModalState.sourcePaths.length / 2)
                    ] ?? ''
                  ] || null
                : selectedImage
                  ? finalPreviewUrl
                  : null
            }
            onClose={() => {
              setUI((state) => ({
                superResolutionModalState: createDefaultSuperResolutionModalState(
                  state.superResolutionModalState.settings,
                ),
              }));
            }}
            onOpenOutput={(path) => {
              void props.handleImageSelect(path);
            }}
            onApplyPlan={() => {
              if (superResolutionModalState.outputReview === null) return;
              const routePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');
              const acceptedDryRunPlanId = `super_resolution_plan_${superResolutionModalState.sourcePaths.length}`;
              const acceptedDryRunPlanHash = superResolutionModalState.outputReview.outputArtifactHash;
              setUI({
                superResolutionModalState: {
                  ...superResolutionModalState,
                  lastApplyCommand: {
                    acceptedDryRunPlanHash,
                    acceptedDryRunPlanId,
                    commandType: 'computationalMerge.createSuperResolution' as const,
                    dryRun: false as const,
                    sources: superResolutionModalState.sourcePaths.length,
                    toolName: routePair.applyToolName,
                  },
                  outputReview: {
                    ...superResolutionModalState.outputReview,
                    editableGate: 'ready',
                    humanReviewStatus: 'passed',
                    supportMap: {
                      ...superResolutionModalState.outputReview.supportMap,
                      reviewStatus: 'apply_ready',
                    },
                  },
                },
              });
            }}
            onPreviewPlan={() => {
              void (async () => {
                const readiness = await invoke<SuperResolutionNativeReadiness>(Invokes.PlanSuperResolution, {
                  paths: superResolutionModalState.sourcePaths,
                  settings: superResolutionModalState.settings,
                });
                const lastDryRunCommand = {
                  commandType: 'computationalMerge.createSuperResolution' as const,
                  dryRun: true as const,
                  sources: superResolutionModalState.sourcePaths.length,
                  toolName: getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName,
                };
                const { lastApplyCommand: _lastApplyCommand, ...nextSuperResolutionModalState } =
                  superResolutionModalState;
                setUI({
                  superResolutionModalState: {
                    ...nextSuperResolutionModalState,
                    lastDryRunCommand,
                    nativeReadiness: readiness,
                    outputReview: null,
                  },
                });
              })().catch((error: unknown) => {
                console.error('Super-resolution native readiness failed', error);
              });
            }}
            onSettingsChange={(settings) => {
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
                    settings,
                  },
                };
              });
            }}
            outputReview={superResolutionModalState.outputReview}
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
            isOpen={focusStackModalState.isOpen}
            lastApplyCommand={focusStackModalState.lastApplyCommand}
            lastDryRunCommand={focusStackModalState.lastDryRunCommand}
            loadingImageUrl={
              focusStackModalState.sourcePaths.length > 0
                ? thumbnails[
                    focusStackModalState.sourcePaths[Math.floor(focusStackModalState.sourcePaths.length / 2)] ?? ''
                  ] || null
                : selectedImage
                  ? finalPreviewUrl
                  : null
            }
            onClose={() => {
              setUI((state) => ({
                focusStackModalState: createDefaultFocusStackModalState(state.focusStackModalState.settings),
              }));
            }}
            onApplyPlan={() => {
              if (focusStackModalState.outputReview === null) return;
              const routePair = getComputationalMergeAppServerRoutePairSummary('focus_stack');
              const acceptedDryRunPlanId = `focus_stack_plan_${focusStackModalState.sourcePaths.length}`;
              const acceptedDryRunPlanHash = focusStackModalState.outputReview.editableHandoff.artifactHash;
              setUI({
                focusStackModalState: {
                  ...focusStackModalState,
                  lastApplyCommand: {
                    acceptedDryRunPlanHash,
                    acceptedDryRunPlanId,
                    commandType: 'computationalMerge.createFocusStack' as const,
                    dryRun: false as const,
                    sources: focusStackModalState.sourcePaths.length,
                    toolName: routePair.applyToolName,
                  },
                  outputReview: markFocusStackOutputReviewApplyReady(focusStackModalState.outputReview),
                },
              });
            }}
            onPreviewPlan={() => {
              const lastDryRunCommand = {
                commandType: 'computationalMerge.createFocusStack' as const,
                dryRun: true as const,
                haloSuppressionStrengthPercent: focusStackModalState.settings.haloSuppressionStrengthPercent,
                sources: focusStackModalState.sourcePaths.length,
                toolName: getComputationalMergeAppServerRoutePairSummary('focus_stack').dryRunToolName,
              };
              const { lastApplyCommand: _lastApplyCommand, ...nextFocusStackModalState } = focusStackModalState;
              setUI({
                focusStackModalState: {
                  ...nextFocusStackModalState,
                  lastDryRunCommand,
                  outputReview: buildFocusStackOutputReviewWorkflow({
                    artifactPath: `/tmp/rawengine-focus-stack-preview-plan-${focusStackModalState.sourcePaths.length}.tif`,
                    settings: focusStackModalState.settings,
                    sourceCount: focusStackModalState.sourcePaths.length,
                    sourcePaths: focusStackModalState.sourcePaths,
                  }),
                },
              });
            }}
            onSettingsChange={(settings) => {
              setUI((state) => {
                const {
                  lastApplyCommand: _lastApplyCommand,
                  lastDryRunCommand: _lastDryRunCommand,
                  ...focusStackModalState
                } = state.focusStackModalState;
                return {
                  focusStackModalState: {
                    ...focusStackModalState,
                    outputReview: null,
                    settings,
                  },
                };
              });
            }}
            outputReview={focusStackModalState.outputReview}
            settings={focusStackModalState.settings}
            sourceCount={focusStackModalState.sourcePaths.length}
            sourcePaths={focusStackModalState.sourcePaths}
            sourcePreflightMetadata={focusStackModalState.sourcePreflightMetadata}
          />
        </Suspense>
      )}
      {negativeModalState.isOpen && (
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
            ? thumbnails[denoiseModalState.targetPaths[0] ?? ''] ||
              (selectedImage?.path === denoiseModalState.targetPaths[0] ? finalPreviewUrl : null)
            : null
        }
      />
      <CreateFolderModal
        isOpen={isCreateFolderModalOpen}
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
        onClose={() => {
          setUI({ isRenameFolderModalOpen: false });
        }}
        onSave={(newName) => {
          void props.handleRenameFolder(newName);
        }}
      />
      <CreateFolderModal
        isOpen={isCreateAlbumModalOpen}
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
        thumbnails={thumbnails}
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
        thumbnails={thumbnails}
      />
    </>
  );
}
