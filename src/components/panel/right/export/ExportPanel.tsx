import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileInput,
  Loader,
  RefreshCw,
  Settings,
  X,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useShallow } from 'zustand/react/shallow';
import {
  exportColorCapabilityCatalogV1Schema,
  MOXCMS_EXPORT_COLOR_CAPABILITIES_V1,
} from '../../../../../packages/rawengine-schema/src/exportColorCapabilities';
import { useExportSettings } from '../../../../hooks/export/useExportSettings';
import { useOsPlatform } from '../../../../hooks/ui/useOsPlatform';
import { prepareAdjustmentPayloadForBackend } from '../../../../schemas/adjustmentPayloadSchemas';
import { EXPORT_LAST_USED_PRESET_ID } from '../../../../schemas/export/exportRecipeIds';
import { outputSharpeningSettingsSchema } from '../../../../schemas/outputSharpeningSchemas';
import { emptyTauriResponseSchema } from '../../../../schemas/tauriResponseSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { Invokes } from '../../../../tauri/commands';
import { thumbnailCache } from '../../../../thumbnails/thumbnailCacheInstance';
import { useThumbnailCacheRevision } from '../../../../thumbnails/useThumbnail';
import { TextColors, TextVariants, TextWeights } from '../../../../types/typography';
import type { Adjustments } from '../../../../utils/adjustments';
import {
  type AppOperationContext,
  beginAppOperation,
  logAppOperationFailure,
  logAppOperationSuccess,
} from '../../../../utils/appEventLogger';
import {
  formatGamutWarningCoverage,
  isCurrentExportSoftProofGamutWarningOverlay,
} from '../../../../utils/color/runtime/gamutWarningDisplay';
import { buildColorStackPreviewExportParityReceipt } from '../../../../utils/colorStackPreviewExportParityReceipt';
import { formatUnknownError } from '../../../../utils/errorFormatting';
import {
  type ExportCancellationAck,
  exportCancellationAckSchema,
  resolveExportCancellationPending,
} from '../../../../utils/export/exportCancellationState';
import {
  getBlackPointCompensationStatus,
  getExportColorCapability,
  isBlackPointCompensationAvailable as getIsBlackPointCompensationAvailable,
  getSupportedRenderingIntents,
  hasExportColorCapabilityForFormat,
  hasColorManagedTransform as hasExportColorManagedTransform,
  isSupportedColorProfileForFormat,
} from '../../../../utils/export/exportColorCapabilityContracts';
import {
  hasStaleOrOfflineSmartPreview,
  isResolvingStaleSmartPreviewExport,
} from '../../../../utils/export/exportSmartPreviewReadiness';
import {
  buildSoftProofProfileCompareInvokeRequest,
  buildSoftProofProfileCompareProof,
  buildSoftProofProfileCompareRequests,
  buildSoftProofProfileCompareUnavailableState,
  createInitialSoftProofProfileCompareState,
  EXPORT_SOFT_PROOF_PROFILE_COMPARE_TARGET_RESOLUTION,
  EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID,
  type ExportSoftProofProfileCompareSideId,
  type ExportSoftProofProfileCompareSideState,
  exportSoftProofTransformResponseSchema,
  getExportSoftProofResolverStatus,
  getSoftProofProfileCompareStatus,
  upsertExportSoftProofResolverPreset,
} from '../../../../utils/export/exportSoftProofProfileCompare';
import { resolveExportTargetPaths } from '../../../../utils/export/exportTargetPaths';
import { buildRawWarningChips } from '../../../../utils/rawWarningReceipts';
import { EXPORT_CANCELLATION_ACKNOWLEDGED_EVENT } from '../../../../utils/tauriEventNames';
import { invokeWithSchema } from '../../../../utils/tauriSchemaInvoke';
import { debounce } from '../../../../utils/timing';
import type { AppSettings, SelectedImage } from '../../../ui/AppProperties';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  type ExportSettings,
  type ExportState,
  FILE_FORMATS,
  FILENAME_VARIABLES,
  type FileFormat,
  FileFormats,
  type OutputSharpeningSettings,
  Status,
  WatermarkAnchor,
} from '../../../ui/ExportImportProperties';
import { editorChromeStatusChipClassName } from '../../../ui/editorChromeTokens';
import Button from '../../../ui/primitives/Button';
import Dropdown from '../../../ui/primitives/Dropdown';
import Slider from '../../../ui/primitives/Slider';
import Switch from '../../../ui/primitives/Switch';
import UiText from '../../../ui/primitives/Text';
import ExportPresetsList from './ExportPresetsList';
import { chooseExportDestination } from './exportDestination';
import { deriveExportFooterWorkflow } from './exportFooterWorkflow';
import ImagePicker from './ImagePicker';

const QUALITY_FILE_FORMATS: ReadonlySet<FileFormats> = new Set([FileFormats.Jpeg, FileFormats.Webp, FileFormats.Jxl]);
const SOFT_PROOF_PROFILE_COMPARE_SIDE_IDS = ['srgb', 'displayP3'] as const;
interface ExportPanelProps {
  exportState: ExportState;
  multiSelectedPaths: Array<string>;
  selectedImage: SelectedImage | null;
  setExportState: (updater: Partial<ExportState> | ((state: ExportState) => Partial<ExportState>)) => void;
  appSettings: AppSettings | null;
  onSettingsChange: (settings: AppSettings) => void;
  rootPaths: string[];
  isVisible?: boolean;
  onClose?: () => void;
  onLinkedVariantImported?: (path: string) => Promise<void> | void;
}

interface SectionProps {
  children: ReactNode;
  title: string;
}

interface ImageDimensions {
  height: number;
  width: number;
}

const imageDimensionsSchema = z.object({ height: z.number(), width: z.number() }).strict();
const originalFileAvailableSchema = z.boolean();
const exportSizeEstimateSchema = z.number().nonnegative();
const previewBufferResponseSchema = z.instanceof(ArrayBuffer);
const externalEditorVariantReceiptSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    bitDepth: z.number().int().positive().optional().nullable(),
    colorProfile: z.string().trim().min(1).optional().nullable(),
    contentHash: z.string().trim().min(1),
    embeddedIccProfile: z.boolean(),
    outputPath: z.string().trim().min(1),
    renderingIntent: z.string().trim().min(1).optional().nullable(),
    sidecarPath: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    sourceRevision: z.string().trim().min(1),
    verifiedBitDepth: z.number().int().positive().optional().nullable(),
  })
  .strict();
const externalEditorFileWatchSnapshotSchema = z
  .object({
    byteSize: z.number().int().nonnegative(),
    modifiedMs: z.number().int().nonnegative(),
    path: z.string().trim().min(1),
  })
  .strict();

function Section({ title, children }: SectionProps) {
  return (
    <div>
      <UiText variant={TextVariants.heading} className="mb-2">
        {title}
      </UiText>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function WatermarkPreview({
  anchor,
  scale,
  spacing,
  opacity,
  watermarkPath,
  imageAspectRatio,
  watermarkImageAspectRatio,
}: {
  anchor: WatermarkAnchor;
  scale: number;
  spacing: number;
  opacity: number;
  watermarkPath: string | null;
  imageAspectRatio: number;
  watermarkImageAspectRatio: number;
}) {
  const { t } = useTranslation();

  const getPositionStyles = () => {
    const minDimPercent = imageAspectRatio > 1 ? 100 / imageAspectRatio : 100;
    const watermarkSizePercent = minDimPercent * (scale / 100);
    const spacingPercent = minDimPercent * (spacing / 100);

    const styles: React.CSSProperties = {
      width: `${watermarkSizePercent}%`,
      opacity: opacity / 100,
      position: 'absolute',
    };

    const spacingString = `${spacingPercent}%`;

    switch (anchor) {
      case WatermarkAnchor.TopLeft:
        styles.top = spacingString;
        styles.left = spacingString;
        break;
      case WatermarkAnchor.TopCenter:
        styles.top = spacingString;
        styles.left = '50%';
        styles.transform = 'translateX(-50%)';
        break;
      case WatermarkAnchor.TopRight:
        styles.top = spacingString;
        styles.right = spacingString;
        break;
      case WatermarkAnchor.CenterLeft:
        styles.top = '50%';
        styles.left = spacingString;
        styles.transform = 'translateY(-50%)';
        break;
      case WatermarkAnchor.Center:
        styles.top = '50%';
        styles.left = '50%';
        styles.transform = 'translate(-50%, -50%)';
        break;
      case WatermarkAnchor.CenterRight:
        styles.top = '50%';
        styles.right = spacingString;
        styles.transform = 'translateY(-50%)';
        break;
      case WatermarkAnchor.BottomLeft:
        styles.bottom = spacingString;
        styles.left = spacingString;
        break;
      case WatermarkAnchor.BottomCenter:
        styles.bottom = spacingString;
        styles.left = '50%';
        styles.transform = 'translateX(-50%)';
        break;
      case WatermarkAnchor.BottomRight:
        styles.bottom = spacingString;
        styles.right = spacingString;
        break;
    }
    return styles;
  };

  return (
    <div
      className="w-full bg-surface rounded-md relative overflow-hidden border border-surface"
      style={{ aspectRatio: imageAspectRatio }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <UiText variant={TextVariants.label}>{t('export.watermark.previewText')}</UiText>
      </div>
      {watermarkPath && (
        <div style={getPositionStyles()}>
          <div
            className="w-full bg-accent/50 border-2 border-dashed border-accent rounded-xs flex items-center justify-center"
            style={{ aspectRatio: watermarkImageAspectRatio }}
          >
            <span className="text-white text-[8px] font-bold">{t('export.watermark.logoText')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const formatBytes = (bytes: number, t: TFunction, decimals = 2) => {
  if (!bytes) return `0 ${t('export.bytes.bytes')}`;
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = [
    t('export.bytes.bytes'),
    t('export.bytes.kb'),
    t('export.bytes.mb'),
    t('export.bytes.gb'),
    t('export.bytes.tb'),
  ];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const sizeLabel = sizes[i] ?? sizes[sizes.length - 1] ?? '';
  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizeLabel}`;
};

export default function ExportPanel({
  exportState,
  multiSelectedPaths,
  selectedImage,
  setExportState,
  appSettings,
  onSettingsChange,
  rootPaths,
  isVisible = true,
  onClose,
  onLinkedVariantImported,
}: ExportPanelProps) {
  const { t } = useTranslation();

  const resizeModeOptions = useMemo(
    () => [
      { label: t('export.resize.modes.longEdge'), value: 'longEdge' },
      { label: t('export.resize.modes.shortEdge'), value: 'shortEdge' },
      { label: t('export.resize.modes.width'), value: 'width' },
      { label: t('export.resize.modes.height'), value: 'height' },
    ],
    [t],
  );
  const outputSharpeningTargetOptions = useMemo<Array<{ label: string; value: OutputSharpeningSettings['target'] }>>(
    () => [
      { label: t('export.outputSharpening.targets.screen'), value: 'screen' },
      { label: t('export.outputSharpening.targets.print'), value: 'print' },
      { label: t('export.outputSharpening.targets.custom'), value: 'custom' },
    ],
    [t],
  );

  const {
    acceptExportColorCapabilityCatalog,
    fileFormat,
    setFileFormat,
    jpegQuality,
    setJpegQuality,
    enableResize,
    setEnableResize,
    resizeMode,
    setResizeMode,
    resizeValue,
    setResizeValue,
    dontEnlarge,
    setDontEnlarge,
    keepMetadata,
    setKeepMetadata,
    preserveTimestamps,
    setPreserveTimestamps,
    stripGps,
    setStripGps,
    exportMasks,
    setExportMasks,
    filenameTemplate,
    setFilenameTemplate,
    enableWatermark,
    setEnableWatermark,
    watermarkPath,
    setWatermarkPath,
    watermarkAnchor,
    setWatermarkAnchor,
    watermarkScale,
    setWatermarkScale,
    watermarkSpacing,
    setWatermarkSpacing,
    watermarkOpacity,
    setWatermarkOpacity,
    outputSharpening,
    setOutputSharpening,
    enableDefaultOutputSharpening,
    updateOutputSharpening,
    preserveFolders,
    setPreserveFolders,
    blackPointCompensation,
    setBlackPointCompensation,
    colorProfile,
    setColorProfile,
    renderingIntent,
    setRenderingIntent,
    handleApplyPreset,
    currentSettingsObject,
    exportColorCapabilityCatalog,
    updateColorSelection,
  } = useExportSettings();

  const {
    adjustments,
    exportSoftProofTransform,
    exportSoftProofRecipeId,
    gamutWarningOverlay,
    isExportSoftProofEnabled,
    isGamutWarningOverlayVisible,
    selectedImagePath,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      exportSoftProofTransform: state.exportSoftProofTransform,
      exportSoftProofRecipeId: state.exportSoftProofRecipeId,
      gamutWarningOverlay: state.gamutWarningOverlay,
      isExportSoftProofEnabled: state.isExportSoftProofEnabled,
      isGamutWarningOverlayVisible: state.isGamutWarningOverlayVisible,
      selectedImagePath: state.selectedImage?.path ?? null,
      setEditor: state.setEditor,
    })),
  );
  const thumbnailCacheRevision = useThumbnailCacheRevision();

  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
  const initDone = useRef(false);

  useEffect(() => {
    if (initDone.current || appSettings === null || !isVisible) return;
    initDone.current = true;
    const lastUsed = appSettings.exportPresets?.find((p) => p.id === EXPORT_LAST_USED_PRESET_ID);
    if (lastUsed) {
      handleApplyPreset(lastUsed);
    }
  }, [appSettings, handleApplyPreset, isVisible]);

  const saveLastUsedPreset = useCallback(
    (exportPath: string) => {
      if (!appSettings) return;
      const lastUsedPreset: ExportPreset = {
        ...currentSettingsObject,
        id: EXPORT_LAST_USED_PRESET_ID,
        name: EXPORT_LAST_USED_PRESET_ID,
        lastExportPath: exportPath,
      };
      const updatedPresets = [
        ...(appSettings.exportPresets ?? []).filter((p) => p.id !== EXPORT_LAST_USED_PRESET_ID),
        lastUsedPreset,
      ];
      onSettingsChange({ ...appSettings, exportPresets: updatedPresets });
    },
    [appSettings, currentSettingsObject, onSettingsChange],
  );

  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [isCancellingExport, setIsCancellingExport] = useState(false);
  const [cancellationAck, setCancellationAck] = useState<ExportCancellationAck | null>(null);
  const [externalVariantStatus, setExternalVariantStatus] = useState<{
    embeddedIccProfile: boolean | null;
    error: string | null;
    importedPath: string | null;
    importing: boolean;
    receiptOutputPath: string | null;
    verifiedBitDepth: number | null;
  }>({
    embeddedIccProfile: null,
    error: null,
    importedPath: null,
    importing: false,
    receiptOutputPath: null,
    verifiedBitDepth: null,
  });
  const [externalEditorError, setExternalEditorError] = useState<string | null>(null);
  const [externalEditorWatch, setExternalEditorWatch] = useState<{
    baselineByteSize: number;
    baselineModifiedMs: number;
    detected: boolean;
    outputPath: string;
    polling: boolean;
  } | null>(null);
  const [watermarkImageAspectRatio, setWatermarkImageAspectRatio] = useState(1);
  const [imageAspectRatio, setImageAspectRatio] = useState(16 / 9);
  const [softProofProfileCompareState, setSoftProofProfileCompareState] = useState<
    Record<ExportSoftProofProfileCompareSideId, ExportSoftProofProfileCompareSideState>
  >(() => createInitialSoftProofProfileCompareState());
  const softProofProfileCompareUrlsRef = useRef<string[]>([]);
  const filenameInputRef = useRef<HTMLInputElement>(null);
  const osPlatform = useOsPlatform();
  const isAndroid = osPlatform === 'android';

  const { status, progress, errorMessage, lastReceipt } = exportState;
  const parsedOutputSharpening = useMemo(
    () => (outputSharpening === null ? null : outputSharpeningSettingsSchema.parse(outputSharpening)),
    [outputSharpening],
  );
  const firstReceiptOutput = lastReceipt?.outputs[0];
  const firstReceiptFileName = firstReceiptOutput?.outputPath.split(/[\\/]/).pop() ?? '';
  const exportRawWarningChips = useMemo(
    () =>
      buildRawWarningChips(
        {
          policyStatus: firstReceiptOutput?.policyStatus,
          rawDevelopmentReport: firstReceiptOutput?.rawDevelopmentReport,
          resolvedDisabledReason: firstReceiptOutput?.resolvedDisabledReason,
          transformApplied: firstReceiptOutput?.transformApplied,
        },
        t,
      ),
    [firstReceiptOutput, t],
  );
  const canOpenReceiptInEditor = firstReceiptOutput?.format.toLowerCase() === 'tiff';
  const configuredExternalEditorPath = useMemo(
    () => appSettings?.externalEditorPath?.trim() ?? '',
    [appSettings?.externalEditorPath],
  );
  const externalEditorName = useMemo(
    () =>
      configuredExternalEditorPath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.app$/i, '') ?? '',
    [configuredExternalEditorPath],
  );
  const firstReceiptMetadataText =
    firstReceiptOutput?.colorProfile && firstReceiptOutput.bitDepth
      ? [firstReceiptOutput.colorProfile, `${firstReceiptOutput.bitDepth}-bit`, firstReceiptOutput.renderingIntent]
          .filter(Boolean)
          .join(' · ')
      : null;
  const firstReceiptPolicyText = firstReceiptOutput
    ? [
        firstReceiptOutput.transformApplied === true
          ? t('export.status.transformApplied')
          : firstReceiptOutput.transformApplied === false
            ? t('export.status.identityTransform')
            : null,
        firstReceiptOutput.iccEmbedded === true ? t('export.status.iccEmbedded') : null,
        firstReceiptOutput.cmm ? t('export.status.cmm', { cmm: firstReceiptOutput.cmm }) : null,
        firstReceiptOutput.policyVersion,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const colorStackParityReceipt = useMemo(
    () =>
      firstReceiptOutput
        ? buildColorStackPreviewExportParityReceipt({
            adjustments,
            exportOutput: firstReceiptOutput,
            exportSoftProofTransform,
            isExportSoftProofEnabled,
          })
        : null,
    [adjustments, exportSoftProofTransform, firstReceiptOutput, isExportSoftProofEnabled],
  );
  const colorStackParitySummary =
    colorStackParityReceipt === null
      ? null
      : colorStackParityReceipt.status === 'matched'
        ? t('export.status.colorStackParityMatched', {
            hash: colorStackParityReceipt.activeColorStackHash,
            profile: colorStackParityReceipt.export.effectiveColorProfile ?? t('export.status.parityUnknown'),
          })
        : t('export.status.colorStackParityWarning', {
            count: colorStackParityReceipt.mismatches.length,
            hash: colorStackParityReceipt.activeColorStackHash,
          });
  const isExporting = status === Status.Exporting;
  const effectiveIsCancellingExport = resolveExportCancellationPending({
    isExporting,
    requested: isCancellingExport,
  });
  const isLibraryContext = !!onClose;
  const isCurrentExternalVariantStatus = externalVariantStatus.receiptOutputPath === firstReceiptOutput?.outputPath;
  const currentExternalVariantError = isCurrentExternalVariantStatus ? externalVariantStatus.error : null;
  const currentExternalVariantImportedPath = isCurrentExternalVariantStatus ? externalVariantStatus.importedPath : null;
  const currentExternalVariantEmbeddedIccProfile = isCurrentExternalVariantStatus
    ? externalVariantStatus.embeddedIccProfile
    : null;
  const currentExternalVariantVerifiedBitDepth = isCurrentExternalVariantStatus
    ? externalVariantStatus.verifiedBitDepth
    : null;
  const isImportingCurrentExternalVariant = isCurrentExternalVariantStatus && externalVariantStatus.importing;
  const isCurrentExternalEditorWatch = externalEditorWatch?.outputPath === firstReceiptOutput?.outputPath;
  const currentExternalEditorWatch = isCurrentExternalEditorWatch ? externalEditorWatch : null;

  const handleImportExternalVariant = useCallback(
    async (sourceVirtualPath: string, output: NonNullable<typeof firstReceiptOutput>) => {
      const outputPath = output.outputPath;
      setExternalVariantStatus({
        embeddedIccProfile: null,
        error: null,
        importedPath: null,
        importing: true,
        receiptOutputPath: outputPath,
        verifiedBitDepth: null,
      });
      try {
        const receipt = await invokeWithSchema(
          Invokes.ImportExternalEditorVariant,
          {
            bitDepth: output.bitDepth ?? null,
            colorProfile: output.colorProfile ?? null,
            outputPath,
            renderingIntent: output.renderingIntent ?? null,
            sourceVirtualPath,
          },
          externalEditorVariantReceiptSchema,
        );
        await onLinkedVariantImported?.(receipt.outputPath);
        setExternalVariantStatus({
          embeddedIccProfile: receipt.embeddedIccProfile,
          error: null,
          importedPath: receipt.outputPath,
          importing: false,
          receiptOutputPath: outputPath,
          verifiedBitDepth: receipt.verifiedBitDepth ?? null,
        });
      } catch (error) {
        setExternalVariantStatus({
          embeddedIccProfile: null,
          error: formatUnknownError(error),
          importedPath: null,
          importing: false,
          receiptOutputPath: outputPath,
          verifiedBitDepth: null,
        });
      }
    },
    [onLinkedVariantImported],
  );

  const handleChooseExternalEditor = useCallback(async () => {
    if (!appSettings) return;
    setExternalEditorError(null);
    try {
      const selectedPath = await open({
        directory: osPlatform === 'macos',
        multiple: false,
        title: t('export.status.chooseExternalEditorTitle'),
      });
      if (typeof selectedPath !== 'string') return;
      onSettingsChange({ ...appSettings, externalEditorPath: selectedPath });
    } catch (error) {
      setExternalEditorError(formatUnknownError(error));
    }
  }, [appSettings, onSettingsChange, osPlatform, t]);

  const handleOpenInExternalEditor = useCallback(
    async (outputPath: string) => {
      setExternalEditorError(null);
      try {
        const baseline = await invokeWithSchema(
          Invokes.GetExternalEditorFileWatchSnapshot,
          { outputPath },
          externalEditorFileWatchSnapshotSchema,
        );
        await invokeWithSchema(
          Invokes.LaunchExternalEditor,
          { editorPath: configuredExternalEditorPath || null, outputPath },
          emptyTauriResponseSchema,
        );
        setExternalEditorWatch({
          baselineByteSize: baseline.byteSize,
          baselineModifiedMs: baseline.modifiedMs,
          detected: false,
          outputPath,
          polling: true,
        });
      } catch (error) {
        setExternalEditorError(formatUnknownError(error));
      }
    },
    [configuredExternalEditorPath],
  );

  useEffect(() => {
    if (!externalEditorWatch || externalEditorWatch.detected || !externalEditorWatch.polling) return;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const snapshot = await invokeWithSchema(
            Invokes.GetExternalEditorFileWatchSnapshot,
            { outputPath: externalEditorWatch.outputPath },
            externalEditorFileWatchSnapshotSchema,
          );
          if (
            snapshot.modifiedMs !== externalEditorWatch.baselineModifiedMs ||
            snapshot.byteSize !== externalEditorWatch.baselineByteSize
          ) {
            setExternalEditorWatch({ ...externalEditorWatch, detected: true, polling: false });
          }
        } catch (error) {
          setExternalEditorError(formatUnknownError(error));
          setExternalEditorWatch({ ...externalEditorWatch, polling: false });
        }
      })();
    }, 2000);
    return () => {
      window.clearInterval(interval);
    };
  }, [externalEditorWatch]);

  const pathsToExport = useMemo(
    () =>
      resolveExportTargetPaths({
        isLibraryContext,
        multiSelectedPaths,
        selectedImagePath: selectedImage?.path,
      }),
    [isLibraryContext, multiSelectedPaths, selectedImage?.path],
  );
  const numImages = pathsToExport.length;
  const isOfflineSmartPreviewExport = !isLibraryContext && selectedImage?.isOfflineSmartPreview === true;
  const staleSmartPreviewPaths = useMemo(
    () =>
      isLibraryContext
        ? pathsToExport.filter((path) =>
            hasStaleOrOfflineSmartPreview([path], { [path]: thumbnailCache.get(path)?.smartPreview ?? undefined }),
          )
        : [],
    [isLibraryContext, pathsToExport, thumbnailCacheRevision],
  );
  const staleSmartPreviewKey = useMemo(() => staleSmartPreviewPaths.join('\n'), [staleSmartPreviewPaths]);
  const [reconnectedSmartPreviewState, setReconnectedSmartPreviewState] = useState<{
    key: string;
    paths: ReadonlySet<string>;
  }>(() => ({ key: '', paths: new Set() }));
  const reconnectedSmartPreviewPaths = useMemo(
    () =>
      reconnectedSmartPreviewState.key === staleSmartPreviewKey
        ? reconnectedSmartPreviewState.paths
        : new Set<string>(),
    [reconnectedSmartPreviewState, staleSmartPreviewKey],
  );
  const isLibrarySmartPreviewResolving = isResolvingStaleSmartPreviewExport(
    staleSmartPreviewPaths,
    staleSmartPreviewKey,
    reconnectedSmartPreviewState.key,
  );
  const isLibrarySmartPreviewExport = useMemo(
    () =>
      isLibraryContext &&
      pathsToExport.some(
        (path) =>
          !reconnectedSmartPreviewPaths.has(path) &&
          hasStaleOrOfflineSmartPreview([path], { [path]: thumbnailCache.get(path)?.smartPreview ?? undefined }),
      ),
    [isLibraryContext, pathsToExport, reconnectedSmartPreviewPaths, thumbnailCacheRevision],
  );
  const isSmartPreviewExportBlocked = isOfflineSmartPreviewExport || isLibrarySmartPreviewExport;

  useEffect(() => {
    if (staleSmartPreviewPaths.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      staleSmartPreviewPaths.map(async (path): Promise<string | null> => {
        try {
          const isAvailable = await invokeWithSchema(
            Invokes.IsOriginalFileAvailable,
            { path },
            originalFileAvailableSchema,
          );
          return isAvailable ? path : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setReconnectedSmartPreviewState({
        key: staleSmartPreviewKey,
        paths: new Set(results.filter((path): path is string => path !== null)),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [staleSmartPreviewKey, staleSmartPreviewPaths]);

  useEffect(() => {
    const fetchDims = async () => {
      if (!enableWatermark || numImages === 0 || !isVisible) return;
      if (!isLibraryContext && selectedImage && selectedImage.width && selectedImage.height) {
        setImageAspectRatio(selectedImage.width / selectedImage.height);
        return;
      }
      try {
        const dims: ImageDimensions = await invokeWithSchema(
          Invokes.GetImageDimensions,
          { path: pathsToExport[0] },
          imageDimensionsSchema,
        );
        if (dims.width > 0 && dims.height > 0) setImageAspectRatio(dims.width / dims.height);
      } catch {
        setImageAspectRatio(3 / 2);
      }
    };
    void fetchDims();
  }, [pathsToExport, isLibraryContext, selectedImage, enableWatermark, numImages, isVisible]);

  useEffect(() => {
    const fetchWatermarkDimensions = async () => {
      if (!watermarkPath) {
        setWatermarkImageAspectRatio(1);
        return;
      }
      try {
        const dimensions = await invokeWithSchema(
          Invokes.GetImageDimensions,
          { path: watermarkPath },
          imageDimensionsSchema,
        );
        setWatermarkImageAspectRatio(dimensions.height > 0 ? dimensions.width / dimensions.height : 1);
      } catch {
        setWatermarkImageAspectRatio(1);
      }
    };
    void fetchWatermarkDimensions();
  }, [watermarkPath]);

  const anchorOptions = useMemo(
    () => [
      { label: t('export.watermark.anchors.topLeft'), value: WatermarkAnchor.TopLeft },
      { label: t('export.watermark.anchors.topCenter'), value: WatermarkAnchor.TopCenter },
      { label: t('export.watermark.anchors.topRight'), value: WatermarkAnchor.TopRight },
      { label: t('export.watermark.anchors.centerLeft'), value: WatermarkAnchor.CenterLeft },
      { label: t('export.watermark.anchors.center'), value: WatermarkAnchor.Center },
      { label: t('export.watermark.anchors.centerRight'), value: WatermarkAnchor.CenterRight },
      { label: t('export.watermark.anchors.bottomLeft'), value: WatermarkAnchor.BottomLeft },
      { label: t('export.watermark.anchors.bottomCenter'), value: WatermarkAnchor.BottomCenter },
      { label: t('export.watermark.anchors.bottomRight'), value: WatermarkAnchor.BottomRight },
    ],
    [t],
  );

  const colorProfileOptions = useMemo(
    () =>
      [
        { label: t('export.colorProfiles.srgb'), value: ExportColorProfile.Srgb },
        { label: t('export.colorProfiles.displayP3'), value: ExportColorProfile.DisplayP3 },
        { label: t('export.colorProfiles.adobeRgb1998'), value: ExportColorProfile.AdobeRgb1998 },
        { label: t('export.colorProfiles.proPhotoRgb'), value: ExportColorProfile.ProPhotoRgb },
        { label: t('export.colorProfiles.sourceEmbedded'), value: ExportColorProfile.SourceEmbedded },
      ].filter(
        (option) =>
          isSupportedColorProfileForFormat(fileFormat, option.value) &&
          getExportColorCapability(exportColorCapabilityCatalog, option.value) !== null,
      ),
    [exportColorCapabilityCatalog, fileFormat, t],
  );
  const hasColorManagedTransform = hasExportColorManagedTransform(fileFormat, colorProfile);
  const exportColorCapability = useMemo(
    () => getExportColorCapability(exportColorCapabilityCatalog, colorProfile),
    [colorProfile, exportColorCapabilityCatalog],
  );
  const hasColorPolicyCapability =
    hasExportColorCapabilityForFormat(fileFormat, colorProfile) && exportColorCapability !== null;
  const renderingIntentOptions = useMemo(() => {
    const supportedIntents = getSupportedRenderingIntents(exportColorCapabilityCatalog, fileFormat, colorProfile);
    return [
      { label: t('export.renderingIntents.relativeColorimetric'), value: ExportRenderingIntent.RelativeColorimetric },
      { label: t('export.renderingIntents.perceptual'), value: ExportRenderingIntent.Perceptual },
      { label: t('export.renderingIntents.saturation'), value: ExportRenderingIntent.Saturation },
      { label: t('export.renderingIntents.absoluteColorimetric'), value: ExportRenderingIntent.AbsoluteColorimetric },
    ].filter((option) => supportedIntents.includes(option.value));
  }, [colorProfile, exportColorCapabilityCatalog, fileFormat, t]);
  const blackPointCompensationStatus = getBlackPointCompensationStatus(
    exportColorCapabilityCatalog,
    fileFormat,
    colorProfile,
  );
  const resolvedExportRenderingIntent =
    colorProfile === ExportColorProfile.SourceEmbedded ? ExportRenderingIntent.RelativeColorimetric : renderingIntent;
  const resolvedExportBlackPointCompensation =
    colorProfile === ExportColorProfile.SourceEmbedded ? false : blackPointCompensation;
  const isBlackPointCompensationAvailable = getIsBlackPointCompensationAvailable({
    catalog: exportColorCapabilityCatalog,
    colorProfile,
    fileFormat,
    renderingIntent,
  });
  const currentSoftProofPreset = useMemo(
    () => (appSettings?.exportPresets ?? []).find((preset) => preset.id === exportSoftProofRecipeId) ?? null,
    [appSettings?.exportPresets, exportSoftProofRecipeId],
  );
  const softProofResolverStatus = useMemo(
    () =>
      getExportSoftProofResolverStatus({
        appSettingsAvailable: appSettings !== null,
        catalog: exportColorCapabilityCatalog,
        currentExportBlackPointCompensation: blackPointCompensation,
        currentExportColorProfile: colorProfile,
        currentExportRenderingIntent: renderingIntent,
        exportSoftProofRecipeId,
        exportSoftProofTransform,
        fileFormat,
        isExportSoftProofEnabled,
        proofPreset: currentSoftProofPreset,
      }),
    [
      appSettings,
      blackPointCompensation,
      colorProfile,
      currentSoftProofPreset,
      exportColorCapabilityCatalog,
      exportSoftProofRecipeId,
      exportSoftProofTransform,
      fileFormat,
      isExportSoftProofEnabled,
      renderingIntent,
    ],
  );
  const softProofResolverProofProfile =
    currentSoftProofPreset?.colorProfile ?? exportSoftProofTransform?.effectiveColorProfile ?? '';
  const softProofResolverProofIntent =
    currentSoftProofPreset?.renderingIntent ?? exportSoftProofTransform?.effectiveRenderingIntent ?? '';
  const softProofResolverBlackPointCompensation =
    exportSoftProofTransform?.blackPointCompensation ??
    (currentSoftProofPreset ? String(currentSoftProofPreset.blackPointCompensation ?? false) : '');
  const softProofResolverFingerprint = exportSoftProofTransform?.transformPolicyFingerprint ?? '';
  const softProofResolverUnsupportedMessage =
    softProofResolverStatus.unsupportedReason === 'unsupported-profile-format'
      ? t('export.softProofResolver.unsupportedProfileFormat', {
          format: fileFormat.toUpperCase(),
          profile:
            currentSoftProofPreset?.colorProfile === ExportColorProfile.DisplayP3
              ? t('export.colorProfiles.displayP3')
              : currentSoftProofPreset?.colorProfile === ExportColorProfile.AdobeRgb1998
                ? t('export.colorProfiles.adobeRgb1998')
                : currentSoftProofPreset?.colorProfile === ExportColorProfile.ProPhotoRgb
                  ? t('export.colorProfiles.proPhotoRgb')
                  : t('export.colorProfiles.srgb'),
        })
      : softProofResolverStatus.unsupportedReason === 'unsupported-rendering-intent'
        ? t('export.softProofResolver.unsupportedRenderingIntent')
        : softProofResolverStatus.unsupportedReason === 'missing-proof-preset'
          ? t('export.softProofResolver.missingProofPreset')
          : softProofResolverStatus.unsupportedReason === 'missing-app-settings'
            ? t('export.softProofResolver.missingAppSettings')
            : null;

  const handlePreviewCurrentExportSettings = useCallback(() => {
    if (!appSettings) return;
    const updatedPresets = upsertExportSoftProofResolverPreset({
      currentSettings: currentSettingsObject,
      name: t('export.softProofResolver.currentExportPresetName'),
      presets: appSettings.exportPresets ?? [],
    });
    onSettingsChange({ ...appSettings, exportPresets: updatedPresets });
    setEditor({
      exportSoftProofRecipeId: EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID,
      exportSoftProofTransform: null,
      isExportSoftProofEnabled: true,
    });
  }, [appSettings, currentSettingsObject, onSettingsChange, setEditor, t]);

  const handleUseCurrentSoftProofForExport = useCallback(() => {
    if (!currentSoftProofPreset || !softProofResolverStatus.canUseCurrentSoftProofForExport) return;
    updateColorSelection({
      blackPointCompensation: currentSoftProofPreset.blackPointCompensation ?? false,
      colorProfile: currentSoftProofPreset.colorProfile ?? ExportColorProfile.Srgb,
      renderingIntent: currentSoftProofPreset.renderingIntent ?? ExportRenderingIntent.RelativeColorimetric,
    });
  }, [currentSoftProofPreset, softProofResolverStatus.canUseCurrentSoftProofForExport, updateColorSelection]);

  useEffect(() => {
    if (!isVisible) return;
    void invokeWithSchema(Invokes.GetExportColorCapabilities, {}, exportColorCapabilityCatalogV1Schema)
      .then(acceptExportColorCapabilityCatalog)
      .catch(() => {
        acceptExportColorCapabilityCatalog(MOXCMS_EXPORT_COLOR_CAPABILITIES_V1);
      });
  }, [acceptExportColorCapabilityCatalog, isVisible]);

  const revokeSoftProofProfileCompareUrls = useCallback(() => {
    for (const url of softProofProfileCompareUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    softProofProfileCompareUrlsRef.current = [];
  }, []);

  useEffect(() => () => revokeSoftProofProfileCompareUrls(), [revokeSoftProofProfileCompareUrls]);

  const handleGenerateSoftProofProfileCompare = useCallback(async () => {
    revokeSoftProofProfileCompareUrls();

    if (!selectedImage?.isReady) {
      setSoftProofProfileCompareState({
        displayP3: buildSoftProofProfileCompareUnavailableState({
          error: t('export.softProofCompare.unavailableNoImage'),
          requestedColorProfile: ExportColorProfile.DisplayP3,
          requestedRenderingIntent: renderingIntent,
          side: 'displayP3',
        }),
        srgb: buildSoftProofProfileCompareUnavailableState({
          error: t('export.softProofCompare.unavailableNoImage'),
          requestedColorProfile: ExportColorProfile.Srgb,
          requestedRenderingIntent: renderingIntent,
          side: 'srgb',
        }),
      });
      return;
    }

    setSoftProofProfileCompareState({
      displayP3: { side: 'displayP3', status: 'loading' },
      srgb: { side: 'srgb', status: 'loading' },
    });

    const { patchResidency } = useEditorStore.getState();
    const residency = patchResidency.snapshot();
    const { newlySentPatchIds, payload } = prepareAdjustmentPayloadForBackend(
      structuredClone(adjustments),
      residency.residentIds,
    );
    const compareRequests = buildSoftProofProfileCompareRequests({
      blackPointCompensation,
      jsAdjustments: payload,
      renderingIntent,
      targetResolution: EXPORT_SOFT_PROOF_PROFILE_COMPARE_TARGET_RESOLUTION,
    });
    const nextUrls: string[] = [];

    const sideEntries = await Promise.all(
      compareRequests.map(async ({ label, request, side }) => {
        try {
          const [buffer, metadata] = await Promise.all([
            invokeWithSchema(
              Invokes.GenerateExportSoftProofPreview,
              buildSoftProofProfileCompareInvokeRequest(request),
              previewBufferResponseSchema,
            ),
            invokeWithSchema(
              Invokes.ResolveExportSoftProofTransformMetadata,
              request,
              exportSoftProofTransformResponseSchema,
            ),
          ]);

          if (buffer.byteLength === 0) {
            throw new Error(t('export.softProofCompare.emptyPreview'));
          }

          const previewUrl = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
          nextUrls.push(previewUrl);

          return [
            side,
            {
              proof: buildSoftProofProfileCompareProof({
                buffer,
                label,
                metadata,
                previewUrl,
                request,
                side,
              }),
              side,
              status: 'ready',
            } satisfies ExportSoftProofProfileCompareSideState,
          ] as const;
        } catch (error) {
          return [
            side,
            buildSoftProofProfileCompareUnavailableState({
              error: formatUnknownError(error),
              requestedColorProfile: request.colorProfile,
              requestedRenderingIntent: request.renderingIntent,
              side,
            }),
          ] as const;
        }
      }),
    );

    if (newlySentPatchIds.size > 0) {
      patchResidency.markResident(residency.sessionId, newlySentPatchIds);
    }

    softProofProfileCompareUrlsRef.current = nextUrls;
    setSoftProofProfileCompareState(
      Object.fromEntries(sideEntries) as Record<
        ExportSoftProofProfileCompareSideId,
        ExportSoftProofProfileCompareSideState
      >,
    );
  }, [
    adjustments,
    blackPointCompensation,
    renderingIntent,
    revokeSoftProofProfileCompareUrls,
    selectedImage?.isReady,
    t,
  ]);

  const debouncedEstimateSize = useMemo(
    () =>
      debounce(
        async (
          paths: string[],
          currentAdj: Adjustments | null,
          currentPath: string | undefined,
          exportSettings: ExportSettings,
          format: string,
        ) => {
          if (paths.length === 0 || !isVisible) {
            setEstimatedSize(null);
            return;
          }
          setIsEstimating(true);
          try {
            const size = await invokeWithSchema(
              Invokes.EstimateExportSizes,
              {
                paths,
                exportSettings,
                outputFormat: format,
                currentEditPath: currentPath || null,
                currentEditAdjustments: currentAdj || null,
              },
              exportSizeEstimateSchema,
            );
            setEstimatedSize(size);
          } catch {
            setEstimatedSize(null);
          } finally {
            setIsEstimating(false);
          }
        },
        500,
      ),
    [isVisible],
  );

  useEffect(() => {
    const exportSettings: ExportSettings = {
      blackPointCompensation: resolvedExportBlackPointCompensation,
      colorProfile,
      filenameTemplate,
      jpegQuality,
      keepMetadata,
      preserveTimestamps,
      preserveFolders,
      resize: enableResize ? { mode: resizeMode, value: resizeValue, dontEnlarge } : null,
      stripGps,
      exportMasks: !isLibraryContext ? exportMasks : undefined,
      outputSharpening: parsedOutputSharpening,
      renderingIntent: resolvedExportRenderingIntent,
      watermark:
        enableWatermark && watermarkPath
          ? {
              path: watermarkPath,
              anchor: watermarkAnchor,
              scale: watermarkScale,
              spacing: watermarkSpacing,
              opacity: watermarkOpacity,
            }
          : null,
    };
    const format = FILE_FORMATS.find((f: FileFormat) => f.id === fileFormat)?.extensions[0] || 'jpeg';
    debouncedEstimateSize(pathsToExport, adjustments, selectedImage?.path, exportSettings, format);
    return () => {
      debouncedEstimateSize.cancel();
    };
  }, [
    pathsToExport,
    adjustments,
    selectedImage?.path,
    fileFormat,
    resolvedExportBlackPointCompensation,
    colorProfile,
    resolvedExportRenderingIntent,
    jpegQuality,
    enableResize,
    resizeMode,
    resizeValue,
    dontEnlarge,
    keepMetadata,
    preserveTimestamps,
    stripGps,
    filenameTemplate,
    enableWatermark,
    watermarkPath,
    watermarkAnchor,
    watermarkScale,
    watermarkSpacing,
    watermarkOpacity,
    debouncedEstimateSize,
    exportMasks,
    preserveFolders,
    isLibraryContext,
    parsedOutputSharpening,
  ]);

  const handleVariableClick = (variable: string) => {
    if (!filenameInputRef.current) return;
    const input: HTMLInputElement = filenameInputRef.current;
    const start = Number(input.selectionStart);
    const end = Number(input.selectionEnd);
    const currentValue = input.value;
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
    setFilenameTemplate(newValue);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  const handleExport = async () => {
    if (
      numImages === 0 ||
      isExporting ||
      isSmartPreviewExportBlocked ||
      (enableWatermark && !watermarkPath) ||
      (fileFormat !== FileFormats.Cube && !isSupportedColorProfileForFormat(fileFormat, colorProfile))
    ) {
      return;
    }

    const buildExportSettings = (finalFilenameTemplate: string): ExportSettings => ({
      blackPointCompensation: resolvedExportBlackPointCompensation,
      colorProfile,
      filenameTemplate: finalFilenameTemplate,
      jpegQuality,
      keepMetadata,
      preserveTimestamps,
      preserveFolders,
      resize: enableResize ? { mode: resizeMode, value: resizeValue, dontEnlarge } : null,
      stripGps,
      exportMasks: !isLibraryContext ? exportMasks : undefined,
      outputSharpening: parsedOutputSharpening,
      renderingIntent: resolvedExportRenderingIntent,
      watermark:
        enableWatermark && watermarkPath
          ? {
              path: watermarkPath,
              anchor: watermarkAnchor,
              scale: watermarkScale,
              spacing: watermarkSpacing,
              opacity: watermarkOpacity,
            }
          : null,
    });
    const operationExportSettings = buildExportSettings(filenameTemplate);
    const lastExportPath = appSettings?.exportPresets?.find((p) => p.id === EXPORT_LAST_USED_PRESET_ID)?.lastExportPath;
    const operation: AppOperationContext = beginAppOperation({
      action: 'export_images',
      component: 'export.panel',
      details: {
        colorProfile,
        count: numImages,
        exportMasks: operationExportSettings.exportMasks ?? false,
        fileFormat,
        hasCurrentEdit: Boolean(selectedImage?.path),
        preserveFolders,
        resizeEnabled: Boolean(operationExportSettings.resize),
        watermarkEnabled: Boolean(operationExportSettings.watermark),
      },
      domain: 'export',
      operationId: `export_${Date.now().toString(36)}`,
      traceId: selectedImage?.path ? 'export_current_edit' : 'export_library_selection',
    });

    try {
      const destination = await chooseExportDestination(
        {
          fileFormat,
          filenameTemplate,
          isAndroid,
          ...(lastExportPath === undefined ? {} : { lastExportPath }),
          pathsToExport,
          t,
        },
        {
          saveFile: async (options) => (await save(options)) as string | null,
          selectFolder: async (options) => (await open(options)) as string | null,
        },
      );

      if (destination !== null) {
        const { finalFilenameTemplate, lastExportDirectory, outputFolderOrFile, selectedFormat } = destination;
        if (finalFilenameTemplate !== filenameTemplate) setFilenameTemplate(finalFilenameTemplate);
        if (lastExportDirectory !== null) saveLastUsedPreset(lastExportDirectory);

        const exportSettings = buildExportSettings(finalFilenameTemplate);

        setExportState({
          errorMessage: '',
          lastReceipt: undefined,
          progress: { current: 0, total: numImages },
          status: Status.Exporting,
        });
        setIsCancellingExport(false);
        setCancellationAck(null);
        await invoke(Invokes.ExportImages, {
          paths: pathsToExport,
          outputFolderOrFile: outputFolderOrFile,
          isExplicitFilePath: numImages === 1,
          baseOriginFolders: rootPaths,
          exportSettings,
          outputFormat: selectedFormat.extensions[0],
          currentEditPath: selectedImage?.path || null,
          currentEditAdjustments: adjustments,
        });
        logAppOperationSuccess(operation, {
          count: numImages,
          outputTarget: isAndroid ? 'android_default' : numImages === 1 ? 'single_file' : 'folder',
          outputFormat: selectedFormat.extensions[0] ?? fileFormat,
        });
      } else {
        logAppOperationSuccess(operation, {
          count: numImages,
          droppedReason: 'user_cancelled_output_picker',
        });
      }
    } catch (error) {
      logAppOperationFailure(operation, error);
      setExportState({
        errorMessage: typeof error === 'string' ? error : t('export.status.failed'),
        progress,
        status: Status.Error,
      });
    }
  };

  const handleCancel = useCallback(async () => {
    if (effectiveIsCancellingExport) return;
    setIsCancellingExport(true);
    try {
      const acknowledgement = await invokeWithSchema(
        Invokes.CancelExport,
        {},
        exportCancellationAckSchema,
        'cancel_export acknowledgement',
      );
      setCancellationAck(acknowledgement);
    } catch (error) {
      console.error('Failed to cancel:', error);
      setIsCancellingExport(false);
    }
  }, [effectiveIsCancellingExport]);

  useEffect(() => {
    if (!isExporting) return;
    const handleCancellationShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      void handleCancel();
    };
    window.addEventListener('keydown', handleCancellationShortcut);
    return () => window.removeEventListener('keydown', handleCancellationShortcut);
  }, [handleCancel, isExporting]);

  useEffect(() => {
    if (typeof window === 'undefined' || !(('__TAURI_INTERNALS__' as string) in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      void listen<unknown>(EXPORT_CANCELLATION_ACKNOWLEDGED_EVENT, (event) => {
        const acknowledgement = exportCancellationAckSchema.safeParse(event.payload);
        if (acknowledgement.success) setCancellationAck(acknowledgement.data);
      }).then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      });
    } catch {
      // Unit-test and non-Tauri renders do not expose the event bridge.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const selectedFileFormat = FILE_FORMATS.find((format) => format.id === fileFormat);
  const selectedColorProfileLabel =
    colorProfileOptions.find((option) => option.value === colorProfile)?.label ?? t('export.colorProfiles.srgb');
  const selectedRenderingIntentLabel =
    renderingIntentOptions.find((option) => option.value === renderingIntent)?.label ??
    t('export.renderingIntents.relativeColorimetric');
  const selectedResizeModeLabel =
    resizeModeOptions.find((option) => option.value === resizeMode)?.label ?? t('export.resize.modes.longEdge');
  const hasExportTarget = numImages > 0 && !isSmartPreviewExportBlocked;
  const exportContractIssue =
    enableWatermark && !watermarkPath
      ? t('export.status.watermarkMissing')
      : fileFormat !== FileFormats.Cube && !isSupportedColorProfileForFormat(fileFormat, colorProfile)
        ? t('export.status.unsupportedFormatProfile', {
            format: selectedFileFormat?.name ?? fileFormat.toUpperCase(),
            profile: selectedColorProfileLabel,
          })
        : null;
  const canExport = hasExportTarget && exportContractIssue === null;
  const exportFooterWorkflow = deriveExportFooterWorkflow({
    canExport,
    canOpenReceiptInEditor,
    currentExternalVariantImportedPath,
    exportState,
    isCancellingExport: effectiveIsCancellingExport,
    isEstimating,
    isImportingCurrentExternalVariant,
  });
  const {
    canImportLinkedVariant,
    canShowReceipt,
    canUseReceiptActions,
    hasMissingOutput,
    hasPartialExport,
    progressCurrent,
    receiptOutputCount,
    state: exportFooterWorkflowState,
    tone: exportFooterStatusTone,
  } = exportFooterWorkflow;
  const exportFooterStatusText =
    exportFooterWorkflowState === 'importing-linked-variant'
      ? t('export.status.footerImportingLinkedVariant')
      : exportFooterWorkflowState === 'imported-linked-variant'
        ? t('export.status.footerImportedLinkedVariant')
        : exportFooterWorkflowState === 'missing-output'
          ? t('export.status.footerMissingOutput')
          : exportFooterWorkflowState === 'partial'
            ? t('export.status.footerPartial', { count: receiptOutputCount, total: lastReceipt?.total ?? 0 })
            : exportFooterWorkflowState === 'failed'
              ? t('export.status.footerFailed')
              : exportFooterWorkflowState === 'canceled'
                ? t('export.status.footerCanceled')
                : exportFooterWorkflowState === 'completed'
                  ? t('export.status.footerCompleted', {
                      count: lastReceipt?.outputs.length ?? 0,
                      total: lastReceipt?.total ?? 0,
                    })
                  : exportFooterWorkflowState === 'queued'
                    ? t('export.status.footerQueued', { count: progress.total || numImages })
                    : exportFooterWorkflowState === 'running'
                      ? t('export.status.footerRunning', {
                          current: progressCurrent,
                          total: progress.total || numImages,
                        })
                      : exportFooterWorkflowState === 'cancelling'
                        ? t('export.status.footerCancelling')
                        : exportFooterWorkflowState === 'estimating'
                          ? t('export.status.estimatingSize')
                          : t('export.status.footerIdle');
  const exportEstimateText = isEstimating
    ? t('export.status.estimatingSize')
    : estimatedSize !== null
      ? numImages > 1
        ? `${t('export.status.estimatedTotalSize', { size: formatBytes(estimatedSize, t) })}${t(
            'export.status.estimatedAverageSize',
            { size: formatBytes(estimatedSize / numImages, t) },
          )}`
        : t('export.status.estimatedSize', { size: formatBytes(estimatedSize, t) })
      : t('export.status.estimatePending');
  const exportDisabledReason =
    exportContractIssue ??
    (isLibrarySmartPreviewResolving
      ? t('export.status.resolvingOriginalFile')
      : isSmartPreviewExportBlocked
        ? t('export.status.offlineSmartPreviewBlocked')
        : isLibraryContext
          ? t('export.status.noImagesSelected')
          : t('export.status.noImageSelected'));
  const isLut = fileFormat === FileFormats.Cube;
  const itemLabel = isLut ? t('export.labels.lut') : t('export.labels.image');
  const itemLabelPlural = isLut ? t('export.labels.lut_plural') : t('export.labels.image_plural');
  const exportFooterFormatProfileText =
    fileFormat === FileFormats.Cube
      ? `${selectedFileFormat?.name ?? fileFormat.toUpperCase()} · ${t('export.readiness.lutProfile')}`
      : `${selectedFileFormat?.name ?? fileFormat.toUpperCase()} · ${selectedColorProfileLabel}`;
  const exportFooterResizeText = enableResize
    ? t('export.readiness.resizeEnabled', { mode: selectedResizeModeLabel, value: resizeValue })
    : t('export.readiness.resizeOff');
  const exportFooterSmartPreviewText = isLibrarySmartPreviewResolving
    ? t('export.status.reviewSmartPreviewResolving')
    : isSmartPreviewExportBlocked
      ? t('export.status.reviewSmartPreviewBlocked')
      : t('export.status.reviewSmartPreviewReady');
  const exportFooterSmartPreviewTone = isLibrarySmartPreviewResolving
    ? 'warning'
    : isSmartPreviewExportBlocked
      ? 'danger'
      : 'success';
  const latestReceiptOutputPath = firstReceiptOutput?.outputPath ?? '';
  const latestReceiptHash =
    firstReceiptOutput?.transformPolicyFingerprint ??
    firstReceiptOutput?.sourceIccProfileHash ??
    colorStackParityReceipt?.activeColorStackHash ??
    '';
  const latestReceiptText = latestReceiptOutputPath
    ? t('export.status.reviewReceipt', {
        hash: latestReceiptHash || t('export.status.parityUnknown'),
        path: latestReceiptOutputPath,
      })
    : t('export.status.reviewReceiptUnavailable');
  const exportReadinessItems = [
    t('export.readiness.format', {
      count: numImages,
      format: selectedFileFormat?.name ?? fileFormat.toUpperCase(),
    }),
    fileFormat === FileFormats.Cube
      ? t('export.readiness.lutProfile')
      : t('export.readiness.colorProfile', { profile: selectedColorProfileLabel }),
    fileFormat === FileFormats.Cube || !hasColorPolicyCapability
      ? t('export.readiness.renderingIntentUnavailable')
      : t('export.readiness.renderingIntent', { intent: selectedRenderingIntentLabel }),
    enableResize
      ? t('export.readiness.resizeEnabled', { mode: selectedResizeModeLabel, value: resizeValue })
      : t('export.readiness.resizeOff'),
    enableWatermark && watermarkPath ? t('export.readiness.watermarkOn') : t('export.readiness.watermarkOff'),
    parsedOutputSharpening
      ? t('export.readiness.outputSharpeningOn', { target: parsedOutputSharpening.target })
      : t('export.readiness.outputSharpeningOff'),
    keepMetadata
      ? stripGps
        ? t('export.readiness.metadataWithoutGps')
        : t('export.readiness.metadataOn')
      : t('export.readiness.metadataOff'),
  ];
  const softProofWarningItems = useMemo(() => {
    if (fileFormat === FileFormats.Cube || !hasColorManagedTransform) return [];

    const warnings: Array<{ code: string; message: string }> = [];
    const transformProfile = exportSoftProofTransform?.effectiveColorProfile;
    const transformIntent = exportSoftProofTransform?.effectiveRenderingIntent;
    const isCurrentVisibleGamutOverlay =
      isGamutWarningOverlayVisible &&
      isCurrentExportSoftProofGamutWarningOverlay(gamutWarningOverlay, {
        exportSoftProofRecipeId,
        exportSoftProofTransform,
        isExportSoftProofEnabled,
        selectedImagePath,
      });

    if (!isExportSoftProofEnabled || exportSoftProofTransform === null) {
      warnings.push({
        code: 'soft-proof-preview-off',
        message: t('export.softProofWarnings.previewOff', {
          intent: selectedRenderingIntentLabel,
          profile: selectedColorProfileLabel,
        }),
      });
    }

    if (transformProfile && transformProfile !== selectedColorProfileLabel) {
      warnings.push({
        code: 'soft-proof-profile-mismatch',
        message: t('export.softProofWarnings.profileMismatch', {
          exportProfile: selectedColorProfileLabel,
          proofProfile: transformProfile,
        }),
      });
    }

    if (transformIntent && transformIntent !== selectedRenderingIntentLabel) {
      warnings.push({
        code: 'soft-proof-intent-mismatch',
        message: t('export.softProofWarnings.intentMismatch', {
          exportIntent: selectedRenderingIntentLabel,
          proofIntent: transformIntent,
        }),
      });
    }

    if (isCurrentVisibleGamutOverlay) {
      warnings.push({
        code: 'gamut-clipping-visible',
        message: t('export.softProofWarnings.gamutClipping', {
          coverage: formatGamutWarningCoverage(gamutWarningOverlay),
        }),
      });
    }

    return warnings;
  }, [
    exportSoftProofTransform,
    exportSoftProofRecipeId,
    fileFormat,
    gamutWarningOverlay,
    hasColorManagedTransform,
    isExportSoftProofEnabled,
    isGamutWarningOverlayVisible,
    selectedColorProfileLabel,
    selectedImagePath,
    selectedRenderingIntentLabel,
    t,
  ]);
  const softProofProfileCompareStatus = getSoftProofProfileCompareStatus(softProofProfileCompareState);
  const isSoftProofProfileCompareLoading = softProofProfileCompareStatus === 'loading';
  const isSoftProofProfileCompareUnavailable = softProofProfileCompareStatus === 'unavailable';
  const softProofProfileCompareSummary =
    softProofProfileCompareStatus === 'ready'
      ? t('export.softProofCompare.ready')
      : softProofProfileCompareStatus === 'unavailable'
        ? t('export.softProofCompare.unavailable')
        : softProofProfileCompareStatus === 'loading'
          ? t('export.softProofCompare.loading')
          : t('export.softProofCompare.idle');
  const exportFooterParityText =
    colorStackParityReceipt && colorStackParitySummary
      ? colorStackParitySummary
      : canShowReceipt
        ? t('export.status.reviewParityPending')
        : softProofWarningItems.length > 0
          ? t('export.softProofWarnings.title')
          : softProofProfileCompareSummary;
  const exportFooterParityTone =
    colorStackParityReceipt?.status === 'failed'
      ? 'danger'
      : colorStackParityReceipt?.status === 'warning' || softProofWarningItems.length > 0
        ? 'warning'
        : 'success';
  const shouldShowSoftProofResolver =
    fileFormat !== FileFormats.Cube &&
    (softProofWarningItems.length > 0 || !softProofResolverStatus.isCurrentProofExportConsistent);
  const shouldShowProofDiagnostics =
    canExport &&
    !firstReceiptOutput &&
    (isSoftProofProfileCompareUnavailable || shouldShowSoftProofResolver || softProofWarningItems.length > 0);
  const proofDiagnosticTitle = isSoftProofProfileCompareUnavailable
    ? t('export.softProofCompare.footerUnavailableTitle')
    : softProofWarningItems.length > 0
      ? t('export.softProofWarnings.title')
      : t('export.softProofResolver.title');
  const renderSoftProofProfileCompareSide = (sideId: ExportSoftProofProfileCompareSideId) => {
    const sideState = softProofProfileCompareState[sideId];
    const proof = sideState.status === 'ready' ? sideState.proof : null;
    const sideLabel =
      sideId === 'srgb' ? t('export.softProofCompare.srgbTitle') : t('export.softProofCompare.displayP3Title');
    const requestedColorProfile =
      proof?.requestedColorProfile ??
      (sideState.status === 'unavailable'
        ? sideState.requestedColorProfile
        : sideId === 'srgb'
          ? ExportColorProfile.Srgb
          : ExportColorProfile.DisplayP3);
    const requestedRenderingIntent =
      proof?.requestedRenderingIntent ??
      (sideState.status === 'unavailable' ? sideState.requestedRenderingIntent : renderingIntent);
    const effectiveColorProfile = proof?.effectiveColorProfile ?? '';
    const effectiveRenderingIntent = proof?.effectiveRenderingIntent ?? '';
    const transformApplied = proof?.transformApplied;
    const sourcePrecisionPath = proof?.sourcePrecisionPath ?? '';
    const transformPolicyFingerprint = proof?.transformPolicyFingerprint ?? '';
    const proofRole = proof?.proofRole ?? '';

    return (
      <div
        className="min-w-0 rounded-md border border-surface bg-bg-secondary/60 p-2"
        data-export-soft-proof-profile-compare-effective-color-profile={effectiveColorProfile}
        data-export-soft-proof-profile-compare-effective-rendering-intent={effectiveRenderingIntent}
        data-export-soft-proof-profile-compare-preview-hash={proof?.previewHash ?? ''}
        data-export-soft-proof-profile-compare-proof-role={proofRole}
        data-export-soft-proof-profile-compare-requested-color-profile={requestedColorProfile}
        data-export-soft-proof-profile-compare-requested-rendering-intent={requestedRenderingIntent}
        data-export-soft-proof-profile-compare-side={sideId}
        data-export-soft-proof-profile-compare-source-precision-path={sourcePrecisionPath}
        data-export-soft-proof-profile-compare-status={sideState.status}
        data-export-soft-proof-profile-compare-transform-applied={String(transformApplied ?? '')}
        data-export-soft-proof-profile-compare-transform-policy-fingerprint={transformPolicyFingerprint}
        data-testid={`export-soft-proof-profile-compare-${sideId}`}
        key={sideId}
      >
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <UiText className="truncate" variant={TextVariants.label} weight={TextWeights.semibold}>
            {sideLabel}
          </UiText>
          <UiText
            as="span"
            className="rounded bg-surface px-1.5 py-0.5"
            color={sideState.status === 'unavailable' ? TextColors.error : TextColors.secondary}
            variant={TextVariants.small}
          >
            {sideState.status === 'ready'
              ? t('export.softProofCompare.sideReady')
              : sideState.status === 'loading'
                ? t('export.softProofCompare.sideLoading')
                : sideState.status === 'unavailable'
                  ? t('export.softProofCompare.sideUnavailable')
                  : t('export.softProofCompare.sideIdle')}
          </UiText>
        </div>
        <div className="aspect-video overflow-hidden rounded bg-surface">
          {proof ? (
            <img
              alt={sideLabel}
              className="h-full w-full object-contain"
              data-testid={`export-soft-proof-profile-compare-preview-${sideId}`}
              src={proof.previewUrl}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center">
              <UiText color={sideState.status === 'unavailable' ? TextColors.error : TextColors.secondary}>
                {sideState.status === 'unavailable'
                  ? sideState.error
                  : isSoftProofProfileCompareLoading
                    ? t('export.softProofCompare.loading')
                    : t('export.softProofCompare.empty')}
              </UiText>
            </div>
          )}
        </div>
        <div className="mt-2 space-y-1">
          <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
            {t('export.softProofCompare.requested', {
              intent: requestedRenderingIntent,
              profile: requestedColorProfile,
            })}
          </UiText>
          {proof ? (
            <>
              <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                {t('export.softProofCompare.effective', {
                  intent: effectiveRenderingIntent,
                  profile: effectiveColorProfile,
                })}
              </UiText>
              <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                {t('export.softProofCompare.transform', {
                  applied:
                    transformApplied === true
                      ? t('export.softProofCompare.transformApplied')
                      : t('export.softProofCompare.identityTransform'),
                  source: sourcePrecisionPath,
                })}
              </UiText>
              <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                {t('export.softProofCompare.fingerprint', { fingerprint: transformPolicyFingerprint })}
              </UiText>
            </>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className={onClose ? 'h-full bg-bg-secondary rounded-lg flex flex-col' : 'flex flex-col h-full'}>
      <div className="flex shrink-0 items-center justify-between border-b border-surface p-3">
        <UiText variant={TextVariants.title}>{t('export.title')}</UiText>
        {onClose && (
          <button
            aria-label={t('export.closePanel')}
            onClick={onClose}
            className="p-1 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary"
          >
            <X size={20} />
          </button>
        )}
      </div>
      <div className="grow space-y-6 overflow-y-auto p-3" data-right-panel-scroll-root="true">
        {hasExportTarget ? (
          <>
            <ExportPresetsList
              appSettings={appSettings}
              onSettingsChange={onSettingsChange}
              currentSettings={currentSettingsObject}
              onApplyPreset={handleApplyPreset}
            />

            <section className="border-y border-surface py-3" data-testid="export-output-contract">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <UiText variant={TextVariants.heading}>{t('export.sections.outputContract')}</UiText>
                <span className={editorChromeStatusChipClassName(exportContractIssue ? 'danger' : 'success')}>
                  {exportContractIssue ? t('export.status.blocked') : t('export.status.ready')}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1.5">
                <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                  {t('export.status.reviewSelected', { count: numImages })}
                </UiText>
                <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                  {exportFooterFormatProfileText}
                </UiText>
                <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                  {exportFooterResizeText}
                </UiText>
                <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                  {exportReadinessItems[6]}
                </UiText>
              </div>
              <UiText
                as="p"
                className={exportContractIssue ? 'mt-2 break-words text-red-400' : 'mt-2 truncate'}
                color={exportContractIssue ? TextColors.error : TextColors.secondary}
                data-testid="export-output-contract-status"
                variant={TextVariants.small}
              >
                {exportContractIssue ?? exportEstimateText}
              </UiText>
            </section>

            <Section title={t('export.sections.fileSettings')}>
              <div className="grid grid-cols-3 gap-2">
                {FILE_FORMATS.map((format: FileFormat) => (
                  <button
                    className={`px-2 py-1.5 rounded-md transition-colors ${fileFormat === format.id ? 'bg-accent' : 'bg-surface hover:bg-card-active'} disabled:opacity-50`}
                    disabled={isExporting}
                    key={format.id}
                    aria-pressed={fileFormat === format.id}
                    data-tooltip={format.name}
                    onClick={() => {
                      setFileFormat(format.id);
                    }}
                    type="button"
                  >
                    <UiText color={fileFormat === format.id ? TextColors.button : TextColors.secondary}>
                      {format.name}
                    </UiText>
                  </button>
                ))}
              </div>
              {QUALITY_FILE_FORMATS.has(fileFormat) && (
                <div className={isExporting ? 'opacity-50 pointer-events-none' : ''}>
                  <Slider
                    defaultValue={90}
                    label={
                      fileFormat === FileFormats.Jxl && jpegQuality === 100
                        ? t('export.file.qualityLossless')
                        : t('export.file.quality')
                    }
                    max={100}
                    min={1}
                    onChange={(e) => {
                      setJpegQuality(parseInt(String(e.target.value), 10));
                    }}
                    step={1}
                    value={jpegQuality}
                    fillOrigin="min"
                  />
                </div>
              )}
            </Section>

            {numImages > 1 && (
              <Section title={t('export.sections.fileNaming')}>
                <input
                  className="w-full bg-surface border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                  disabled={isExporting}
                  onChange={(e) => {
                    setFilenameTemplate(e.target.value);
                  }}
                  ref={filenameInputRef}
                  type="text"
                  value={filenameTemplate}
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  {FILENAME_VARIABLES.map((variable: string) => (
                    <button
                      className="px-2 py-1 bg-surface text-text-secondary text-xs rounded-md hover:bg-card-active transition-colors disabled:opacity-50"
                      disabled={isExporting}
                      key={variable}
                      onClick={() => {
                        handleVariableClick(variable);
                      }}
                    >
                      {variable}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {fileFormat !== FileFormats.Cube && (
              <>
                <Section title={t('export.sections.imageSizing')}>
                  <Switch
                    label={t('export.resize.resizeToFit')}
                    checked={enableResize}
                    onChange={setEnableResize}
                    disabled={isExporting}
                    trackClassName="bg-surface"
                  />
                  {enableResize && (
                    <div className="space-y-4 pl-2 border-l-2 border-surface">
                      <div className="flex items-center gap-2">
                        <Dropdown
                          options={resizeModeOptions}
                          value={resizeMode}
                          onChange={setResizeMode}
                          disabled={isExporting}
                          className="w-full"
                        />
                        <input
                          className="w-24 bg-surface text-center rounded-md p-2 border border-surface focus:border-accent focus:ring-accent text-text-secondary focus:text-text-primary"
                          disabled={isExporting}
                          min="1"
                          onChange={(e) => {
                            setResizeValue(parseInt(e.target.value, 10));
                          }}
                          type="number"
                          value={resizeValue}
                        />
                        <UiText variant={TextVariants.label}>{t('export.resize.pixels')}</UiText>
                      </div>
                      <Switch
                        checked={dontEnlarge}
                        disabled={isExporting}
                        label={t('export.resize.dontEnlarge')}
                        onChange={setDontEnlarge}
                        trackClassName="bg-surface"
                      />
                    </div>
                  )}
                </Section>

                {fileFormat === FileFormats.Jpeg && (
                  <Section title={t('export.sections.metadata')}>
                    <Switch
                      checked={keepMetadata}
                      disabled={isExporting}
                      label={t('export.metadata.saveWithMetadata')}
                      onChange={setKeepMetadata}
                      trackClassName="bg-surface"
                    />
                    {keepMetadata && (
                      <div className="pl-2 border-l-2 border-surface">
                        <Switch
                          label={t('export.metadata.removeGps')}
                          checked={stripGps}
                          onChange={setStripGps}
                          disabled={isExporting}
                          trackClassName="bg-surface"
                        />
                      </div>
                    )}
                  </Section>
                )}

                <Section title={t('export.sections.watermark')}>
                  <Switch
                    label={t('export.watermark.addWatermark')}
                    checked={enableWatermark}
                    onChange={setEnableWatermark}
                    disabled={isExporting}
                    trackClassName="bg-surface"
                  />
                  {enableWatermark && (
                    <div className="space-y-4 pl-2 border-l-2 border-surface">
                      <ImagePicker
                        label={t('export.watermark.watermarkImage')}
                        imageName={watermarkPath ? watermarkPath.split(/[\\/]/).pop() || null : null}
                        onImageSelect={setWatermarkPath}
                        onClear={() => {
                          setWatermarkPath(null);
                        }}
                      />
                      {watermarkPath && (
                        <>
                          <Dropdown
                            options={anchorOptions}
                            value={watermarkAnchor}
                            onChange={(val) => {
                              setWatermarkAnchor(val);
                            }}
                            disabled={isExporting}
                            className="w-full"
                          />
                          <div>
                            <Slider
                              label={t('export.watermark.scale')}
                              min={1}
                              max={50}
                              step={1}
                              value={watermarkScale}
                              onChange={(e) => {
                                setWatermarkScale(parseInt(String(e.target.value), 10));
                              }}
                              disabled={isExporting}
                              defaultValue={10}
                            />
                            <Slider
                              label={t('export.watermark.spacing')}
                              min={0}
                              max={25}
                              step={1}
                              value={watermarkSpacing}
                              onChange={(e) => {
                                setWatermarkSpacing(parseInt(String(e.target.value), 10));
                              }}
                              disabled={isExporting}
                              defaultValue={5}
                            />
                            <Slider
                              label={t('export.watermark.opacity')}
                              min={0}
                              max={100}
                              step={1}
                              value={watermarkOpacity}
                              onChange={(e) => {
                                setWatermarkOpacity(parseInt(String(e.target.value), 10));
                              }}
                              disabled={isExporting}
                              defaultValue={75}
                            />
                          </div>
                          <WatermarkPreview
                            imageAspectRatio={imageAspectRatio}
                            watermarkImageAspectRatio={watermarkImageAspectRatio}
                            watermarkPath={watermarkPath}
                            anchor={watermarkAnchor}
                            scale={watermarkScale}
                            spacing={watermarkSpacing}
                            opacity={watermarkOpacity}
                          />
                        </>
                      )}
                    </div>
                  )}
                </Section>

                <Section title={t('export.sections.outputSharpening')}>
                  <Switch
                    checked={outputSharpening !== null}
                    disabled={isExporting}
                    label={t('export.outputSharpening.enable')}
                    onChange={(checked) => {
                      if (checked) {
                        enableDefaultOutputSharpening();
                      } else {
                        setOutputSharpening(null);
                      }
                    }}
                    trackClassName="bg-surface"
                  />
                  {outputSharpening !== null && (
                    <div className="space-y-4 pl-2 border-l-2 border-surface">
                      <Dropdown
                        className="w-full"
                        disabled={isExporting}
                        onChange={(target) => {
                          updateOutputSharpening({ target });
                        }}
                        options={outputSharpeningTargetOptions}
                        value={outputSharpening.target}
                      />
                      <Slider
                        defaultValue={35}
                        disabled={isExporting}
                        fillOrigin="min"
                        label={t('export.outputSharpening.amount')}
                        max={100}
                        min={0}
                        onChange={(e) => {
                          updateOutputSharpening({ amount: parseInt(String(e.target.value), 10) });
                        }}
                        step={1}
                        value={outputSharpening.amount}
                      />
                      <Slider
                        defaultValue={0.7}
                        disabled={isExporting}
                        fillOrigin="min"
                        label={t('export.outputSharpening.radius')}
                        max={3}
                        min={0.3}
                        onChange={(e) => {
                          updateOutputSharpening({ radiusPx: parseFloat(String(e.target.value)) });
                        }}
                        step={0.1}
                        suffix=" px"
                        value={outputSharpening.radiusPx}
                      />
                      <Slider
                        defaultValue={2}
                        disabled={isExporting}
                        fillOrigin="min"
                        label={t('export.outputSharpening.threshold')}
                        max={100}
                        min={0}
                        onChange={(e) => {
                          updateOutputSharpening({ threshold: parseInt(String(e.target.value), 10) / 100 });
                        }}
                        step={1}
                        value={Math.round(outputSharpening.threshold * 100)}
                      />
                    </div>
                  )}
                </Section>

                <Section title={t('export.softProofCompare.title')}>
                  <div
                    className="space-y-3"
                    data-export-soft-proof-profile-compare-rendering-intent={renderingIntent}
                    data-export-soft-proof-profile-compare-status={softProofProfileCompareStatus}
                    data-export-soft-proof-profile-compare-target-resolution={
                      EXPORT_SOFT_PROOF_PROFILE_COMPARE_TARGET_RESOLUTION
                    }
                    data-testid="export-soft-proof-profile-compare"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <UiText color={TextColors.primary} variant={TextVariants.label}>
                          {softProofProfileCompareSummary}
                        </UiText>
                        <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                          {t('export.softProofCompare.subtitle', { intent: renderingIntent })}
                        </UiText>
                      </div>
                      <Button
                        className="h-9 shrink-0 bg-surface px-3 text-xs text-text-primary shadow-none"
                        data-testid="export-soft-proof-profile-compare-generate"
                        disabled={isExporting || isSoftProofProfileCompareLoading}
                        onClick={() => {
                          void handleGenerateSoftProofProfileCompare();
                        }}
                      >
                        {isSoftProofProfileCompareLoading ? (
                          <Loader size={14} className="animate-spin" />
                        ) : softProofProfileCompareStatus === 'ready' ? (
                          <RefreshCw size={14} />
                        ) : (
                          <Columns2 size={14} />
                        )}
                        {softProofProfileCompareStatus === 'ready'
                          ? t('export.softProofCompare.refresh')
                          : t('export.softProofCompare.generate')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                      {SOFT_PROOF_PROFILE_COMPARE_SIDE_IDS.map(renderSoftProofProfileCompareSide)}
                    </div>
                  </div>
                </Section>
              </>
            )}

            <div>
              <UiText variant={TextVariants.heading} className="mb-2">
                {t('export.sections.advanced')}
              </UiText>
              <div className="overflow-hidden rounded-md border border-surface">
                <button
                  onClick={() => {
                    setIsAdvancedExpanded(!isAdvancedExpanded);
                  }}
                  className="w-full flex items-center justify-between p-3.5 hover:bg-card-active transition-colors"
                >
                  <UiText
                    as="span"
                    variant={TextVariants.label}
                    color={TextColors.primary}
                    className="flex items-center gap-2"
                  >
                    <Settings size={16} /> {t('export.advanced.title')}
                  </UiText>
                  <UiText color={TextColors.secondary}>
                    {isAdvancedExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </UiText>
                </button>
                <AnimatePresence initial={false}>
                  {isAdvancedExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-2 border-t border-surface/50 flex flex-col gap-4">
                        <Switch
                          label={t('export.advanced.preserveFolders')}
                          checked={preserveFolders}
                          onChange={setPreserveFolders}
                          disabled={isExporting}
                          trackClassName="bg-surface"
                        />
                        {fileFormat !== FileFormats.Cube && (
                          <>
                            <Switch
                              checked={preserveTimestamps}
                              disabled={isExporting}
                              label={t('export.advanced.preserveTimestamps')}
                              onChange={setPreserveTimestamps}
                              trackClassName="bg-surface"
                            />
                            {!isLibraryContext && (
                              <Switch
                                label={t('export.advanced.exportMasks')}
                                checked={exportMasks}
                                onChange={setExportMasks}
                                disabled={isExporting}
                                trackClassName="bg-surface"
                              />
                            )}
                            <div className="space-y-1">
                              <UiText variant={TextVariants.label}>{t('export.advanced.colorProfile')}</UiText>
                              <Dropdown
                                options={colorProfileOptions}
                                value={colorProfile}
                                onChange={setColorProfile}
                                disabled={isExporting}
                                placement="top"
                                className="w-full"
                              />
                            </div>
                            {hasColorPolicyCapability ? (
                              <div
                                className="space-y-1"
                                data-black-point-compensation-status={blackPointCompensationStatus}
                                data-color-engine={exportColorCapability?.engine ?? 'unavailable'}
                                data-rendering-intent-count={renderingIntentOptions.length}
                                data-testid="export-color-capability"
                              >
                                <UiText variant={TextVariants.label}>{t('export.advanced.renderingIntent')}</UiText>
                                <Dropdown
                                  options={renderingIntentOptions}
                                  value={renderingIntent}
                                  onChange={setRenderingIntent}
                                  disabled={isExporting}
                                  className="w-full"
                                />
                                {blackPointCompensationStatus === 'supported' ? (
                                  <Switch
                                    label={t('export.advanced.blackPointCompensation')}
                                    checked={blackPointCompensation && isBlackPointCompensationAvailable}
                                    onChange={setBlackPointCompensation}
                                    disabled={isExporting || !isBlackPointCompensationAvailable}
                                    trackClassName="bg-surface"
                                  />
                                ) : (
                                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                                    {t('export.advanced.blackPointCompensationUnavailable')}
                                  </UiText>
                                )}
                                {blackPointCompensationStatus === 'supported' && !isBlackPointCompensationAvailable ? (
                                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                                    {t('export.advanced.blackPointCompensationJpegTiffRelativeOnly')}
                                  </UiText>
                                ) : null}
                              </div>
                            ) : (
                              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                                {t('export.readiness.renderingIntentUnavailable')}
                              </UiText>
                            )}
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        ) : (
          <UiText
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            {isLibrarySmartPreviewResolving
              ? t('export.status.resolvingOriginalFile')
              : isSmartPreviewExportBlocked
                ? t('export.status.offlineSmartPreviewBlocked')
                : isLibraryContext
                  ? t('export.status.noImagesSelected')
                  : t('export.status.noImageSelected')}
          </UiText>
        )}
      </div>

      <div className="sticky bottom-0 z-10 shrink-0 space-y-2 border-t border-surface bg-bg-secondary p-3">
        <div
          className="min-w-0 rounded-md border border-editor-border bg-editor-panel px-2.5 py-2"
          data-export-footer-color-stack-parity={colorStackParityReceipt?.status ?? 'pending'}
          data-export-footer-format-profile={exportFooterFormatProfileText}
          data-export-footer-latest-receipt-hash={latestReceiptHash}
          data-export-footer-latest-receipt-path={latestReceiptOutputPath}
          data-export-footer-workflow-state={exportFooterWorkflowState}
          data-export-footer-progress-current={progressCurrent}
          data-export-footer-progress-total={progress.total}
          data-export-footer-resize-state={enableResize ? `${resizeMode}:${resizeValue}` : 'off'}
          data-export-footer-selected-count={numImages}
          data-export-footer-smart-preview-state={
            isLibrarySmartPreviewResolving ? 'resolving' : isSmartPreviewExportBlocked ? 'blocked' : 'ready'
          }
          data-export-footer-can-cancel={String(isExporting)}
          data-export-footer-can-retry={String((status === Status.Error || status === Status.Cancelled) && canExport)}
          data-export-footer-can-open={String(canUseReceiptActions && canOpenReceiptInEditor)}
          data-export-footer-can-import-linked-variant={String(canImportLinkedVariant)}
          data-testid="export-footer-workflow-state"
        >
          <div aria-live="polite" className="flex min-w-0 items-center gap-2" role="status">
            <span className={editorChromeStatusChipClassName(exportFooterStatusTone)}>{exportFooterWorkflowState}</span>
            <UiText
              as="p"
              className="min-w-0 flex-1 truncate"
              color={exportFooterWorkflowState === 'failed' ? TextColors.error : TextColors.secondary}
              variant={TextVariants.small}
            >
              {exportFooterStatusText}
            </UiText>
          </div>
          <div
            className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden"
            data-testid="export-readiness-summary"
          >
            <UiText
              as="p"
              className="min-w-0 flex-1 truncate"
              color={TextColors.secondary}
              data-export-readiness-item={exportReadinessItems[0]}
              data-testid="export-footer-review-selected"
              variant={TextVariants.small}
            >
              {t('export.status.reviewSelected', { count: numImages })}
            </UiText>
            <span aria-hidden="true" className="shrink-0 text-text-tertiary">
              ·
            </span>
            <UiText
              as="p"
              className="min-w-0 flex-1 truncate"
              color={TextColors.secondary}
              data-export-readiness-item={exportReadinessItems[1]}
              data-testid="export-footer-review-format-profile"
              variant={TextVariants.small}
            >
              {exportFooterFormatProfileText}
            </UiText>
            <span aria-hidden="true" className="shrink-0 text-text-tertiary">
              ·
            </span>
            <UiText
              as="p"
              className="min-w-0 flex-1 truncate"
              color={TextColors.secondary}
              data-export-readiness-item={exportReadinessItems[3]}
              data-testid="export-footer-review-resize"
              variant={TextVariants.small}
            >
              {exportFooterResizeText}
            </UiText>
          </div>
          <div className="mt-1 grid min-w-0 grid-cols-2 gap-2">
            <div className="flex min-w-0 items-center gap-1.5" data-testid="export-footer-review-smart-preview">
              {exportFooterSmartPreviewTone === 'success' ? (
                <CheckCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-editor-success" />
              ) : exportFooterSmartPreviewTone === 'danger' ? (
                <XCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-editor-danger" />
              ) : (
                <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-editor-warning" />
              )}
              <UiText as="p" className="min-w-0 truncate" color={TextColors.secondary} variant={TextVariants.small}>
                {exportFooterSmartPreviewText}
              </UiText>
            </div>
            <div className="flex min-w-0 items-center gap-1.5" data-testid="export-footer-review-parity">
              {exportFooterParityTone === 'danger' ? (
                <XCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-editor-danger" />
              ) : exportFooterParityTone === 'warning' ? (
                <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-editor-warning" />
              ) : (
                <CheckCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-editor-success" />
              )}
              <UiText
                as="p"
                className="min-w-0 flex-1 truncate"
                color={exportFooterParityTone === 'danger' ? TextColors.error : TextColors.secondary}
                variant={TextVariants.small}
              >
                {exportFooterParityText}
              </UiText>
            </div>
          </div>
          {canShowReceipt ? (
            <UiText
              as="p"
              className="mt-1 min-w-0 truncate"
              color={TextColors.secondary}
              data-testid="export-footer-review-receipt"
              variant={TextVariants.small}
            >
              {latestReceiptText}
            </UiText>
          ) : null}
        </div>
        {shouldShowProofDiagnostics ? (
          <details
            className="group rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-2"
            data-testid="export-proof-footer-proof-state"
          >
            <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
              <UiText
                className="min-w-0 flex-1 truncate text-yellow-200"
                variant={TextVariants.small}
                weight={TextWeights.semibold}
              >
                {proofDiagnosticTitle}
              </UiText>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-yellow-200 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 space-y-2 border-t border-yellow-500/25 pt-2">
              {isSoftProofProfileCompareUnavailable ? (
                <div
                  className="flex min-w-0 items-center gap-2"
                  data-export-soft-proof-compare-footer-status={softProofProfileCompareStatus}
                  data-testid="export-soft-proof-compare-footer-warning"
                >
                  <UiText as="p" className="min-w-0 flex-1" color={TextColors.secondary} variant={TextVariants.small}>
                    {t('export.softProofCompare.footerUnavailableDescription')}
                  </UiText>
                  <button
                    className="shrink-0 rounded border border-yellow-500/40 px-2 py-1 text-xs font-medium text-yellow-200 transition-colors hover:bg-card-active disabled:opacity-50"
                    data-testid="export-soft-proof-compare-footer-action"
                    disabled={isExporting || isSoftProofProfileCompareLoading}
                    onClick={() => {
                      void handleGenerateSoftProofProfileCompare();
                    }}
                    type="button"
                  >
                    {t('export.softProofCompare.footerRetry')}
                  </button>
                </div>
              ) : null}
              {shouldShowSoftProofResolver ? (
                <div
                  className="border-l-2 border-yellow-500/40 pl-2"
                  data-export-soft-proof-resolver-black-point-compensation={softProofResolverBlackPointCompensation}
                  data-export-soft-proof-resolver-can-preview={String(
                    softProofResolverStatus.canPreviewCurrentExportSettings,
                  )}
                  data-export-soft-proof-resolver-can-use-proof={String(
                    softProofResolverStatus.canUseCurrentSoftProofForExport,
                  )}
                  data-export-soft-proof-resolver-export-intent={renderingIntent}
                  data-export-soft-proof-resolver-export-profile={colorProfile}
                  data-export-soft-proof-resolver-fingerprint={softProofResolverFingerprint}
                  data-export-soft-proof-resolver-parity-status={softProofResolverStatus.parityStatus}
                  data-export-soft-proof-resolver-proof-intent={softProofResolverProofIntent}
                  data-export-soft-proof-resolver-proof-profile={softProofResolverProofProfile}
                  data-export-soft-proof-resolver-unsupported-reason={softProofResolverStatus.unsupportedReason ?? ''}
                  data-testid="export-soft-proof-resolver"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <UiText
                      className="min-w-0 truncate text-yellow-200"
                      variant={TextVariants.small}
                      weight={TextWeights.semibold}
                    >
                      {t('export.softProofResolver.title')}
                    </UiText>
                    <span className={editorChromeStatusChipClassName(exportFooterParityTone)}>
                      {t(`export.softProofResolver.parity.${softProofResolverStatus.parityStatus}`)}
                    </span>
                  </div>
                  <UiText as="p" className="mt-1" color={TextColors.secondary} variant={TextVariants.small}>
                    {softProofResolverStatus.isCurrentProofExportConsistent
                      ? t('export.softProofResolver.consistent')
                      : t('export.softProofResolver.description', {
                          exportIntent: selectedRenderingIntentLabel,
                          exportProfile: selectedColorProfileLabel,
                          proofIntent: softProofResolverProofIntent || t('export.status.parityUnknown'),
                          proofProfile: softProofResolverProofProfile || t('export.status.parityUnknown'),
                        })}
                  </UiText>
                  <div className="mt-1 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1">
                    <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                      {t('export.softProofResolver.resultingProfile', {
                        profile: softProofResolverProofProfile || selectedColorProfileLabel,
                      })}
                    </UiText>
                    <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                      {t('export.softProofResolver.renderingIntent', {
                        intent: softProofResolverProofIntent || selectedRenderingIntentLabel,
                      })}
                    </UiText>
                    <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                      {t('export.softProofResolver.blackPointCompensation', {
                        value: softProofResolverBlackPointCompensation || String(blackPointCompensation),
                      })}
                    </UiText>
                    <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                      {t('export.softProofResolver.transformFingerprint', {
                        fingerprint: softProofResolverFingerprint || t('export.status.parityUnknown'),
                      })}
                    </UiText>
                  </div>
                  {softProofResolverUnsupportedMessage ? (
                    <UiText as="p" className="mt-1 text-yellow-200" variant={TextVariants.small}>
                      {softProofResolverUnsupportedMessage}
                    </UiText>
                  ) : null}
                  <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                    <button
                      className="rounded border border-yellow-500/40 px-2 py-1 text-xs font-medium text-yellow-200 transition-colors hover:bg-card-active disabled:opacity-50"
                      data-testid="export-soft-proof-resolver-use-proof"
                      disabled={
                        isExporting ||
                        !softProofResolverStatus.canUseCurrentSoftProofForExport ||
                        softProofResolverStatus.unsupportedReason !== null
                      }
                      onClick={handleUseCurrentSoftProofForExport}
                      type="button"
                    >
                      {t('export.softProofResolver.useCurrentSoftProof')}
                    </button>
                    <button
                      className="rounded border border-yellow-500/40 px-2 py-1 text-xs font-medium text-yellow-200 transition-colors hover:bg-card-active disabled:opacity-50"
                      data-testid="export-soft-proof-resolver-preview-export"
                      disabled={
                        isExporting ||
                        !softProofResolverStatus.canPreviewCurrentExportSettings ||
                        !isSupportedColorProfileForFormat(fileFormat, colorProfile)
                      }
                      onClick={handlePreviewCurrentExportSettings}
                      type="button"
                    >
                      {t('export.softProofResolver.previewCurrentExport')}
                    </button>
                  </div>
                </div>
              ) : null}
              {softProofWarningItems.length > 0 ? (
                <ul
                  aria-label={t('export.softProofWarnings.title')}
                  className="space-y-1 border-l-2 border-yellow-500/40 pl-2"
                  data-export-soft-proof-warning-codes={softProofWarningItems.map((item) => item.code).join(',')}
                  data-export-soft-proof-warning-count={softProofWarningItems.length}
                  data-testid="export-soft-proof-warnings"
                >
                  {softProofWarningItems.map((item) => (
                    <li data-export-soft-proof-warning-code={item.code} key={item.code}>
                      <UiText variant={TextVariants.small} color={TextColors.secondary}>
                        {item.message}
                      </UiText>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}
        {canShowReceipt && firstReceiptOutput && (
          <details
            className="rounded-md border border-editor-border bg-editor-panel p-2"
            data-export-receipt-black-point-compensation={firstReceiptOutput.blackPointCompensation ?? ''}
            data-export-receipt-color-managed-transform={firstReceiptOutput.colorManagedTransform ?? ''}
            data-export-receipt-cmm={firstReceiptOutput.cmm ?? ''}
            data-export-receipt-effective-color-profile={firstReceiptOutput.effectiveColorProfile ?? ''}
            data-export-receipt-format={firstReceiptOutput.format}
            data-export-receipt-icc-embedded={String(firstReceiptOutput.iccEmbedded ?? '')}
            data-export-receipt-output-path={firstReceiptOutput.outputPath}
            data-export-receipt-auxiliary-output-paths={(firstReceiptOutput.auxiliaryOutputPaths ?? []).join(',')}
            data-export-receipt-policy-status={firstReceiptOutput.policyStatus ?? ''}
            data-export-receipt-policy-version={firstReceiptOutput.policyVersion ?? ''}
            data-export-receipt-raw-provenance-sidecar-path={firstReceiptOutput.rawProvenanceSidecarPath ?? ''}
            data-export-receipt-requested-color-profile={firstReceiptOutput.requestedColorProfile ?? ''}
            data-export-receipt-requested-rendering-intent={firstReceiptOutput.requestedRenderingIntent ?? ''}
            data-export-receipt-resolved-disabled-reason={firstReceiptOutput.resolvedDisabledReason ?? ''}
            data-export-receipt-effective-rendering-intent={firstReceiptOutput.effectiveRenderingIntent ?? ''}
            data-export-receipt-source-icc-profile-hash={firstReceiptOutput.sourceIccProfileHash ?? ''}
            data-export-receipt-source-precision-path={firstReceiptOutput.sourcePrecisionPath ?? ''}
            data-export-receipt-terminal-status={lastReceipt.terminalStatus}
            data-export-receipt-total={lastReceipt.total}
            data-export-receipt-transform-applied={String(firstReceiptOutput.transformApplied ?? '')}
            data-export-receipt-transform-policy-fingerprint={firstReceiptOutput.transformPolicyFingerprint ?? ''}
            data-color-stack-parity-hash={colorStackParityReceipt?.activeColorStackHash ?? ''}
            data-color-stack-parity-mismatches={colorStackParityReceipt?.mismatches.join(',') ?? ''}
            data-color-stack-parity-profile={colorStackParityReceipt?.export.effectiveColorProfile ?? ''}
            data-color-stack-parity-range-count={colorStackParityReceipt?.components.selectiveColorRangeCount ?? 0}
            data-color-stack-parity-runtime-delta={colorStackParityReceipt?.runtimeProof?.maxRgb8MeanAbsDelta ?? ''}
            data-color-stack-parity-runtime-export-hash={colorStackParityReceipt?.runtimeProof?.exportHash ?? ''}
            data-color-stack-parity-runtime-preview-hash={colorStackParityReceipt?.runtimeProof?.previewHash ?? ''}
            data-color-stack-parity-runtime-source-hash={colorStackParityReceipt?.runtimeProof?.sourceHash ?? ''}
            data-color-stack-parity-runtime-status={colorStackParityReceipt?.runtimeProof?.status ?? ''}
            data-color-stack-parity-status={colorStackParityReceipt?.status ?? ''}
            data-color-stack-parity-tone-curve={colorStackParityReceipt?.components.toneCurve ?? ''}
            data-testid="export-success-receipt"
          >
            <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0 text-editor-success" />
              <UiText
                as="span"
                className="min-w-0 flex-1 truncate"
                color={TextColors.primary}
                variant={TextVariants.small}
                weight={TextWeights.semibold}
              >
                {t('export.status.exportedFile', { filename: firstReceiptFileName })}
              </UiText>
              <UiText as="span" color={TextColors.secondary} variant={TextVariants.small}>
                {formatBytes(firstReceiptOutput.byteSize, t)}
              </UiText>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
            </summary>
            {exportRawWarningChips.length > 0 && (
              <div
                className="mt-2 flex flex-wrap gap-1"
                data-export-raw-warning-codes={exportRawWarningChips.map((chip) => chip.code).join(',')}
                data-testid="export-raw-warning-chips"
              >
                {exportRawWarningChips.map((chip) => (
                  <span
                    key={chip.code}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      chip.tone === 'warning' ? 'bg-yellow-500/15 text-yellow-200' : 'bg-sky-500/15 text-sky-200'
                    }`}
                    data-export-raw-warning-code={chip.code}
                  >
                    {chip.label.replaceAll('_', ' ')}
                  </span>
                ))}
              </div>
            )}
            {currentExternalVariantImportedPath && (
              <UiText
                as="p"
                className="mt-1 break-all"
                color={TextColors.secondary}
                data-external-editor-embedded-icc-profile={String(currentExternalVariantEmbeddedIccProfile)}
                data-testid="export-success-linked-variant-imported"
                data-external-editor-verified-bit-depth={currentExternalVariantVerifiedBitDepth ?? ''}
                variant={TextVariants.small}
              >
                {t('export.status.linkedVariantImported', { filename: firstReceiptFileName })}
              </UiText>
            )}
            {currentExternalVariantError && (
              <UiText
                as="p"
                className="mt-1 break-all text-red-400"
                data-testid="export-success-linked-variant-error"
                variant={TextVariants.small}
              >
                {t('export.status.linkedVariantImportFailed', { error: currentExternalVariantError })}
              </UiText>
            )}
            {externalEditorError && (
              <UiText
                as="p"
                className="mt-1 break-all text-red-400"
                data-testid="export-success-external-editor-error"
                variant={TextVariants.small}
              >
                {t('export.status.externalEditorFailed', { error: externalEditorError })}
              </UiText>
            )}
            <div className="mt-2 space-y-2">
              <UiText as="p" className="break-all" color={TextColors.secondary} variant={TextVariants.small}>
                {firstReceiptOutput.outputPath}
              </UiText>
              <div className="min-w-0 space-y-0.5" data-testid="export-success-receipt-details">
                <UiText className="truncate" color={TextColors.secondary} variant={TextVariants.small}>
                  {formatBytes(firstReceiptOutput.byteSize, t)} · {firstReceiptOutput.format.toUpperCase()}
                  {firstReceiptMetadataText ? ` · ${firstReceiptMetadataText}` : ''}
                </UiText>
                {firstReceiptOutput.colorManagedTransform && (
                  <UiText
                    className="truncate"
                    color={TextColors.secondary}
                    data-testid="export-success-color-managed-transform"
                    variant={TextVariants.small}
                  >
                    {t('export.status.colorManagedTransform', { transform: firstReceiptOutput.colorManagedTransform })}
                  </UiText>
                )}
                {firstReceiptPolicyText && (
                  <UiText
                    className="truncate"
                    color={TextColors.secondary}
                    data-testid="export-success-color-policy"
                    variant={TextVariants.small}
                  >
                    {firstReceiptPolicyText}
                  </UiText>
                )}
                {firstReceiptOutput.sourceIccProfileHash && (
                  <UiText
                    className="break-all"
                    color={TextColors.secondary}
                    data-testid="export-success-source-icc-profile-hash"
                    variant={TextVariants.small}
                  >
                    {t('editor.metadata.displayProfile.iccHash')} {firstReceiptOutput.sourceIccProfileHash}
                  </UiText>
                )}
                {firstReceiptOutput.transformPolicyFingerprint && (
                  <UiText
                    className="break-all"
                    color={TextColors.secondary}
                    data-testid="export-success-transform-policy-fingerprint"
                    variant={TextVariants.small}
                  >
                    {t('export.softProofResolver.transformFingerprint', {
                      fingerprint: firstReceiptOutput.transformPolicyFingerprint,
                    })}
                  </UiText>
                )}
                {colorStackParityReceipt && colorStackParitySummary && (
                  <UiText
                    className="truncate"
                    color={colorStackParityReceipt.status === 'matched' ? TextColors.secondary : TextColors.error}
                    data-testid="export-success-color-stack-parity"
                    variant={TextVariants.small}
                  >
                    {t('export.status.colorStackParityTitle')}: {colorStackParitySummary}
                  </UiText>
                )}
                {canOpenReceiptInEditor && (
                  <UiText
                    className="truncate"
                    color={TextColors.secondary}
                    data-external-editor-path={configuredExternalEditorPath}
                    data-testid="export-success-external-editor-config"
                    variant={TextVariants.small}
                  >
                    {configuredExternalEditorPath
                      ? t('export.status.externalEditorConfigured', { editor: externalEditorName })
                      : t('export.status.externalEditorDefault')}
                  </UiText>
                )}
                {currentExternalEditorWatch && (
                  <UiText
                    className="truncate"
                    color={currentExternalEditorWatch.detected ? TextColors.primary : TextColors.secondary}
                    data-external-editor-save-detected={String(currentExternalEditorWatch.detected)}
                    data-testid="export-success-external-editor-watch"
                    variant={TextVariants.small}
                  >
                    {currentExternalEditorWatch.detected
                      ? t('export.status.externalEditorSaveDetected')
                      : t('export.status.externalEditorWatching')}
                  </UiText>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1" data-testid="export-success-receipt-actions">
                {canOpenReceiptInEditor && (
                  <>
                    <button
                      className="min-w-0 rounded border border-surface px-2 py-1 text-xs text-text-secondary hover:bg-card-active hover:text-text-primary"
                      data-testid="export-success-choose-external-editor"
                      disabled={!canUseReceiptActions}
                      onClick={() => {
                        void handleChooseExternalEditor();
                      }}
                      type="button"
                    >
                      {t('export.status.chooseExternalEditor')}
                    </button>
                    <button
                      className="min-w-0 rounded border border-surface px-2 py-1 text-xs text-text-secondary hover:bg-card-active hover:text-text-primary"
                      data-testid="export-success-import-linked-variant"
                      disabled={!canImportLinkedVariant}
                      onClick={() => {
                        void handleImportExternalVariant(firstReceiptOutput.sourcePath, firstReceiptOutput);
                      }}
                      type="button"
                    >
                      {isImportingCurrentExternalVariant
                        ? t('export.status.importingLinkedVariant')
                        : t('export.status.importLinkedVariant')}
                    </button>
                    <button
                      className="min-w-0 rounded border border-surface px-2 py-1 text-xs text-text-secondary hover:bg-card-active hover:text-text-primary"
                      data-testid="export-success-open-in-editor"
                      disabled={!canUseReceiptActions}
                      onClick={() => {
                        void handleOpenInExternalEditor(firstReceiptOutput.outputPath);
                      }}
                      type="button"
                    >
                      {t('export.status.openInEditor')}
                    </button>
                  </>
                )}
                <button
                  className="min-w-0 rounded border border-surface px-2 py-1 text-xs text-text-secondary hover:bg-card-active hover:text-text-primary"
                  data-testid="export-success-show-in-finder"
                  disabled={!canUseReceiptActions}
                  onClick={() => {
                    void invoke(Invokes.ShowInFinder, { path: firstReceiptOutput.outputPath });
                  }}
                  type="button"
                >
                  {t('export.status.showInFinder')}
                </button>
              </div>
            </div>
          </details>
        )}
        {canExport ? (
          <div className="flex min-w-0 items-center justify-between gap-3 px-0.5">
            <UiText as="div" variant={TextVariants.small} color={TextColors.secondary} className="min-w-0 truncate">
              {exportEstimateText}
            </UiText>
            <UiText as="span" className="shrink-0" color={TextColors.secondary} variant={TextVariants.small}>
              {numImages > 1 ? `${numImages} ${itemLabelPlural}` : itemLabel}
            </UiText>
          </div>
        ) : (
          <div
            className="rounded-md border border-red-500/40 bg-red-500/20 px-3 py-2"
            data-testid="export-blocked-alert"
          >
            <UiText as="p" className="text-red-400" variant={TextVariants.small} weight={TextWeights.semibold}>
              {exportDisabledReason}
            </UiText>
          </div>
        )}
        {status === Status.Error && errorMessage ? (
          <details
            className="rounded-md border border-red-500/40 bg-red-500/20 px-3 py-2"
            data-testid="export-error-alert"
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5">
              <XCircle className="h-4 w-4 shrink-0 text-red-400" />
              <UiText as="span" className="text-red-400" variant={TextVariants.small} weight={TextWeights.medium}>
                {t('export.status.footerFailed')}
              </UiText>
              <ChevronDown className="ml-auto h-3.5 w-3.5 text-red-400" />
            </summary>
            <UiText as="p" className="mt-1 break-words text-red-400" variant={TextVariants.small}>
              {errorMessage}
            </UiText>
          </details>
        ) : null}
        {hasMissingOutput || hasPartialExport ? (
          <div
            className="flex min-w-0 items-center gap-2 border-l-2 border-yellow-500/40 px-2 py-1"
            data-export-incomplete-state={hasMissingOutput ? 'missing-output' : 'partial'}
            data-testid="export-incomplete-alert"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
            <UiText
              as="p"
              className="min-w-0 text-yellow-200"
              variant={TextVariants.small}
              weight={TextWeights.semibold}
            >
              {hasMissingOutput
                ? t('export.status.footerMissingOutput')
                : t('export.status.footerPartial', { count: receiptOutputCount, total: lastReceipt?.total ?? 0 })}
            </UiText>
          </div>
        ) : null}
        <Button
          className={`group h-10 w-full rounded-md text-sm font-semibold! shadow-none transition-colors ${
            status === Status.Exporting
              ? 'bg-editor-primary-active text-editor-primary-active-text hover:bg-red-600 hover:text-white'
              : status === Status.Success
                ? 'bg-editor-success-surface text-editor-success'
                : status === Status.Error
                  ? 'bg-editor-danger-surface text-editor-danger'
                  : status === Status.Cancelled
                    ? 'bg-editor-warning-surface text-editor-warning'
                    : 'bg-editor-primary-active text-editor-primary-active-text'
          }`}
          aria-busy={isExporting}
          aria-keyshortcuts="Escape"
          aria-label={isExporting ? t('export.status.cancelExport') : undefined}
          data-testid="export-cancel-control"
          data-cancel-active-job-id={cancellationAck?.activeJobId}
          data-cancel-task-attached={cancellationAck?.taskAttached}
          data-cancel-token-observed={cancellationAck?.tokenObserved}
          data-tooltip={isExporting ? t('export.status.cancelExport') : exportDisabledReason}
          disabled={status === Status.Exporting ? effectiveIsCancellingExport : !canExport}
          onClick={() => {
            if (status === Status.Exporting) {
              void handleCancel();
            } else {
              void handleExport();
            }
          }}
          size="lg"
        >
          {status === Status.Exporting ? (
            <>
              {effectiveIsCancellingExport ? <Loader size={16} className="animate-spin" /> : <Ban size={16} />}
              {effectiveIsCancellingExport
                ? t('export.status.footerCancelling')
                : progress.total > 1
                  ? t('export.status.cancelExportingProgress', { current: progressCurrent, total: progress.total })
                  : t('export.status.cancelExport')}
            </>
          ) : status === Status.Success && (hasMissingOutput || hasPartialExport) ? (
            <>
              <RefreshCw size={16} className="mr-2" /> {t('export.status.retryExport')}
            </>
          ) : status === Status.Success ? (
            <>
              <CheckCircle size={16} className="mr-2" /> {t('export.status.exportAgain')}
            </>
          ) : status === Status.Error ? (
            <>
              <XCircle size={16} className="mr-2" /> {t('export.status.retryExport')}
            </>
          ) : status === Status.Cancelled ? (
            <>
              <Ban size={16} className="mr-2" /> {t('export.status.retryExport')}
            </>
          ) : (
            <>
              <FileInput size={16} className="mr-2" />{' '}
              {numImages > 1
                ? t('export.status.exportMultiple', { count: numImages, label: itemLabelPlural })
                : t('export.status.exportSingle', { label: itemLabel })}
            </>
          )}
        </Button>
        {cancellationAck ? (
          <span
            aria-hidden="true"
            className="sr-only"
            data-cancel-active-job-id={cancellationAck.activeJobId}
            data-cancel-task-attached={cancellationAck.taskAttached}
            data-cancel-token-observed={cancellationAck.tokenObserved}
            data-testid="export-cancellation-ack"
          />
        ) : null}
      </div>
    </div>
  );
}
