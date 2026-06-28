import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import CollageModal from './CollageModal';
import CommandPaletteModal from './CommandPaletteModal';
import ConfirmModal from './ConfirmModal';
import CopyPasteSettingsModal from './CopyPasteSettingsModal';
import CreateFolderModal from './CreateFolderModal';
import CullingModal from './CullingModal';
import DenoiseModal from './DenoiseModal';
import FocusStackModal from './FocusStackModal';
import HdrModal from './HdrModal';
import ImportSettingsModal from './ImportSettingsModal';
import PanoramaModal from './PanoramaModal';
import RenameFileModal from './RenameFileModal';
import RenameFolderModal from './RenameFolderModal';
import SuperResolutionModal from './SuperResolutionModal';
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
import { getComputationalMergeAppServerRoutePairSummary } from '../../utils/computationalMergeAppServerRoutePairs';
import { handleNegativeConversionEditorHandoff } from '../../utils/negativeLabEditorHandoff';
import { buildSuperResolutionOutputReviewWorkflow } from '../../utils/superResolutionOutputReview';

import type { CopyPasteSettings } from '../../utils/adjustments';
import type { AppSettings, AlbumItem } from '../ui/AppProperties';

const NegativeConversionModal = lazy(() =>
  import('./NegativeConversionModal.js').then((module) => ({ default: module.NegativeConversionModal })),
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
      <PanoramaModal
        error={panoramaModalState.error}
        finalImageBase64={panoramaModalState.finalImageBase64}
        imageCount={panoramaModalState.stitchingSourcePaths.length}
        isOpen={panoramaModalState.isOpen}
        isProcessing={panoramaModalState.isProcessing}
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
          setUI((state) => ({ panoramaModalState: { ...state.panoramaModalState, runtimePlan: null, settings } }));
        }}
        progressMessage={panoramaModalState.progressMessage}
        renderedReview={panoramaModalState.renderedReview}
        runtimePlan={panoramaModalState.runtimePlan}
        settings={panoramaModalState.settings}
      />
      <HdrModal
        error={hdrModalState.error}
        finalImageBase64={hdrModalState.finalImageBase64}
        imageCount={hdrModalState.stitchingSourcePaths.length}
        isOpen={hdrModalState.isOpen}
        isProcessing={hdrModalState.isProcessing}
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
          setUI((state) => ({ hdrModalState: { ...state.hdrModalState, settings } }));
        }}
        progressMessage={hdrModalState.progressMessage}
        settings={hdrModalState.settings}
        sourceMetadata={hdrModalState.sourceMetadata}
        sourcePaths={hdrModalState.stitchingSourcePaths}
      />
      <SuperResolutionModal
        isOpen={superResolutionModalState.isOpen}
        loadingImageUrl={
          superResolutionModalState.sourcePaths.length > 0
            ? thumbnails[
                superResolutionModalState.sourcePaths[Math.floor(superResolutionModalState.sourcePaths.length / 2)] ??
                  ''
              ] || null
            : selectedImage
              ? finalPreviewUrl
              : null
        }
        onClose={() => {
          setUI((state) => ({
            superResolutionModalState: createDefaultSuperResolutionModalState(state.superResolutionModalState.settings),
          }));
        }}
        onPreviewPlan={() => {
          const lastDryRunCommand = {
            commandType: 'computationalMerge.createSuperResolution' as const,
            dryRun: true as const,
            sources: superResolutionModalState.sourcePaths.length,
            toolName: getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName,
          };
          setUI({
            superResolutionModalState: {
              ...superResolutionModalState,
              lastDryRunCommand,
              outputReview: buildSuperResolutionOutputReviewWorkflow({
                artifactPath: `/tmp/rawengine-super-resolution-preview-plan-${superResolutionModalState.sourcePaths.length}.tif`,
                settings: superResolutionModalState.settings,
                sourceCount: superResolutionModalState.sourcePaths.length,
              }),
            },
          });
        }}
        onSettingsChange={(settings) => {
          setUI((state) => ({
            superResolutionModalState: {
              ...state.superResolutionModalState,
              outputReview: null,
              settings,
            },
          }));
        }}
        outputReview={superResolutionModalState.outputReview}
        settings={superResolutionModalState.settings}
        sourceCount={superResolutionModalState.sourcePaths.length}
        sourcePreflightMetadata={superResolutionModalState.sourcePreflightMetadata}
      />
      <FocusStackModal
        isOpen={focusStackModalState.isOpen}
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
        onPreviewPlan={() => {
          setUI({
            focusStackModalState: {
              ...focusStackModalState,
              lastDryRunCommand: {
                commandType: 'computationalMerge.createFocusStack',
                dryRun: true,
                haloSuppressionStrengthPercent: focusStackModalState.settings.haloSuppressionStrengthPercent,
                sources: focusStackModalState.sourcePaths.length,
                toolName: getComputationalMergeAppServerRoutePairSummary('focus_stack').dryRunToolName,
              },
            },
          });
        }}
        onSettingsChange={(settings) => {
          setUI((state) => ({
            focusStackModalState: {
              ...state.focusStackModalState,
              settings,
            },
          }));
        }}
        settings={focusStackModalState.settings}
        sourceCount={focusStackModalState.sourcePaths.length}
      />
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
