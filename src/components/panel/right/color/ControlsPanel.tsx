import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Aperture, ChartArea, ClipboardPaste, Copy, RotateCcw, ScanSearch } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';

import { useContextMenu } from '../../../../context/ContextMenuContext';
import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import {
  type RawReconstructionComparisonResult,
  rawReconstructionComparisonResultSchema,
} from '../../../../schemas/rawReconstructionComparisonSchemas';
import { emptyTauriResponseSchema } from '../../../../schemas/tauriResponseSchemas';
import { type CopiedSectionAdjustments, useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { type CollapsibleSectionsState, useUIStore } from '../../../../store/useUIStore';
import { Invokes } from '../../../../tauri/commands';
import { TextVariants } from '../../../../types/typography';
import {
  ADJUSTMENT_SECTIONS,
  type Adjustments,
  INITIAL_ADJUSTMENTS,
  pickAdjustmentValues,
} from '../../../../utils/adjustments';
import { formatUnknownError } from '../../../../utils/errorFormatting';
import {
  normalizeRawProcessingMode,
  RAW_PROCESSING_MODE_RECIPES,
  RAW_PROCESSING_MODES,
  type RawProcessingMode,
} from '../../../../utils/rawProcessingModes';
import { invokeWithSchema } from '../../../../utils/tauriSchemaInvoke';
import BasicAdjustments from '../../../adjustments/Basic';
import ColorPanel from '../../../adjustments/Color';
import CurveGraph from '../../../adjustments/Curves';
import DetailsPanel from '../../../adjustments/Details';
import EffectsPanel from '../../../adjustments/Effects';
import { OPTION_SEPARATOR, type Option, Orientation } from '../../../ui/AppProperties';
import CollapsibleSection from '../../../ui/CollapsibleSection';
import Dropdown, { type OptionItem } from '../../../ui/primitives/Dropdown';
import UiText from '../../../ui/primitives/Text';
import Resizer from '../../../ui/Resizer';
import Waveform from '../../editor/Waveform';

const ADJUSTMENT_SECTION_NAMES = ['basic', 'curves', 'color', 'details', 'effects'] as const;
type AdjustmentSectionName = (typeof ADJUSTMENT_SECTION_NAMES)[number];
type RawProcessingModeOverrideOption = RawProcessingMode | 'inherit';
type CollapsibleSectionsUpdater =
  | CollapsibleSectionsState
  | ((prev: CollapsibleSectionsState) => CollapsibleSectionsState);

const ADJUSTMENT_SECTION_LABEL_FALLBACKS: Record<AdjustmentSectionName, string> = {
  basic: 'Basic',
  color: 'Color',
  curves: 'Curves',
  details: 'Details',
  effects: 'Effects',
};
const RAW_RECONSTRUCTION_COMPARISON_CROP_SIZE = 256;

const formatBytes = (value: number): string => {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
};

export default function Controls() {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const { isResizingWaveform, onToggleWaveform, setActiveWaveformChannel, handleWaveformResize } =
    useWaveformControls();
  const { setAdjustments, handleAutoAdjustments, handleLutSelect } = useEditorActions();
  const [rawReconstructionComparison, setRawReconstructionComparison] =
    useState<RawReconstructionComparisonResult | null>(null);
  const [isComparingRawReconstruction, setIsComparingRawReconstruction] = useState(false);

  const { appSettings, theme } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      theme: state.theme,
    })),
  );

  const rawProcessingModeOverrideOptions = useMemo<Array<OptionItem<RawProcessingModeOverrideOption>>>(
    () => [
      {
        label: t('editor.adjustments.rawProcessingModeOverride.inherit', {
          mode: t(`settings.processing.rawModes.${normalizeRawProcessingMode(appSettings?.rawProcessingMode)}.label`),
        }),
        value: 'inherit',
      },
      ...RAW_PROCESSING_MODES.map((mode) => ({
        label: t(`settings.processing.rawModes.${mode}.label`),
        value: mode,
      })),
    ],
    [appSettings?.rawProcessingMode, t],
  );

  const { collapsibleSectionsState, setUI } = useUIStore(
    useShallow((state) => ({
      collapsibleSectionsState: state.collapsibleSectionsState,
      setUI: state.setUI,
    })),
  );

  const {
    adjustments,
    copiedSectionAdjustments,
    histogram,
    selectedImage,
    previewScopeStatus,
    isWbPickerActive,
    isWaveformVisible,
    waveform,
    activeWaveformChannel,
    waveformHeight,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      copiedSectionAdjustments: state.copiedSectionAdjustments,
      histogram: state.histogram,
      selectedImage: state.selectedImage,
      previewScopeStatus: state.previewScopeStatus,
      isWbPickerActive: state.isWbPickerActive,
      isWaveformVisible: state.isWaveformVisible,
      waveform: state.waveform,
      activeWaveformChannel: state.activeWaveformChannel,
      waveformHeight: state.waveformHeight,
      setEditor: state.setEditor,
    })),
  );

  const setCopiedSectionAdjustments = useCallback(
    (val: CopiedSectionAdjustments | null) => {
      setEditor({ copiedSectionAdjustments: val });
    },
    [setEditor],
  );

  const toggleWbPicker = useCallback(() => {
    setEditor((state) => ({ isWbPickerActive: !state.isWbPickerActive }));
  }, [setEditor]);

  const onDragStateChange = useCallback(
    (isDragging: boolean) => {
      setEditor({ isSliderDragging: isDragging });
    },
    [setEditor],
  );

  const setCollapsibleState = useCallback(
    (updater: CollapsibleSectionsUpdater) => {
      setUI((state) => ({
        collapsibleSectionsState: typeof updater === 'function' ? updater(state.collapsibleSectionsState) : updater,
      }));
    },
    [setUI],
  );

  const handleToggleVisibility = (sectionName: AdjustmentSectionName) => {
    setAdjustments((prev: Adjustments) => {
      const currentVisibility = prev.sectionVisibility;
      return {
        ...prev,
        sectionVisibility: {
          ...currentVisibility,
          [sectionName]: !currentVisibility[sectionName],
        },
      };
    });
  };

  const handleRawProcessingModeOverrideChange = useCallback(
    async (mode: RawProcessingModeOverrideOption) => {
      if (!selectedImage?.path) return;

      const rawProcessingModeOverride = mode === 'inherit' ? null : mode;
      const nextAdjustments = { ...adjustments, rawProcessingModeOverride };
      setAdjustments(nextAdjustments);

      try {
        await invokeWithSchema(
          Invokes.SaveMetadataAndUpdateThumbnail,
          { adjustments: nextAdjustments, path: selectedImage.path },
          emptyTauriResponseSchema,
        );
        await invokeWithSchema(Invokes.ClearImageCaches, {}, emptyTauriResponseSchema);
        setEditor((state) =>
          state.selectedImage?.path === selectedImage.path
            ? { selectedImage: { ...state.selectedImage, isReady: false } }
            : {},
        );
      } catch (error) {
        toast.error(t('editor.adjustments.rawProcessingModeOverride.error', { error: formatUnknownError(error) }));
      }
    },
    [adjustments, selectedImage, setAdjustments, setEditor, t],
  );

  const handleCompareRawReconstructionModes = useCallback(async () => {
    if (!selectedImage?.path || !selectedImage.isRaw) return;

    setIsComparingRawReconstruction(true);
    try {
      const comparison = await invokeWithSchema(
        Invokes.CompareRawReconstructionModes,
        { cropSize: RAW_RECONSTRUCTION_COMPARISON_CROP_SIZE, path: selectedImage.path },
        rawReconstructionComparisonResultSchema,
      );
      setRawReconstructionComparison(comparison);
    } catch (error) {
      toast.error(t('editor.adjustments.rawReconstructionComparison.error', { error: formatUnknownError(error) }));
    } finally {
      setIsComparingRawReconstruction(false);
    }
  }, [selectedImage, t]);

  const handleResetAdjustments = () => {
    const resetValues = pickAdjustmentValues(
      ADJUSTMENT_SECTION_NAMES.flatMap((sectionName) => ADJUSTMENT_SECTIONS[sectionName]),
      INITIAL_ADJUSTMENTS,
    );

    setAdjustments((prev: Adjustments) => ({
      ...prev,
      ...resetValues,
      sectionVisibility: { ...INITIAL_ADJUSTMENTS.sectionVisibility },
    }));
  };

  const handleToggleSection = (section: AdjustmentSectionName) => {
    setCollapsibleState((prev) => {
      const isOpening = !prev[section];
      if (appSettings?.enableFocusMode && isOpening) {
        const newState = { ...prev };
        ADJUSTMENT_SECTION_NAMES.forEach((key) => {
          newState[key] = false;
        });
        newState[section] = true;
        return newState;
      }
      return { ...prev, [section]: !prev[section] };
    });
  };

  const handleSectionContextMenu = (event: MouseEvent<HTMLDivElement>, sectionName: AdjustmentSectionName) => {
    event.preventDefault();
    event.stopPropagation();

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];

    const handleCopy = () => {
      const adjustmentsToCopy = pickAdjustmentValues(sectionKeys, adjustments, { requireExistingKey: true });
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      const copiedSection = copiedSectionAdjustments;
      if (!copiedSection || copiedSection.section !== sectionName) {
        return;
      }
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...copiedSection.values,
        sectionVisibility: {
          ...prev.sectionVisibility,
          [sectionName]: true,
        },
      }));
    };

    const handleReset = () => {
      const resetValues = pickAdjustmentValues(sectionKeys, INITIAL_ADJUSTMENTS);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...resetValues,
        sectionVisibility: {
          ...prev.sectionVisibility,
          [sectionName]: true,
        },
      }));
    };

    const copiedSection = copiedSectionAdjustments;
    const isPasteAllowed = copiedSection?.section === sectionName;
    const translatedSection = t(`editor.adjustments.sections.${sectionName}`, {
      defaultValue: ADJUSTMENT_SECTION_LABEL_FALLBACKS[sectionName],
    });

    const pasteLabel = copiedSection
      ? t('editor.adjustments.actions.pasteLabel', { section: translatedSection })
      : t('editor.adjustments.actions.pasteSettings');

    const options: Option[] = [
      {
        label: t('editor.adjustments.actions.copySectionSettings', { section: translatedSection }),
        icon: Copy,
        onClick: handleCopy,
      },
      { label: pasteLabel, icon: ClipboardPaste, onClick: handlePaste, disabled: !isPasteAllowed },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.adjustments.actions.resetSectionSettings', { section: translatedSection }),
        icon: RotateCcw,
        onClick: handleReset,
      },
    ];

    showContextMenu(event.clientX, event.clientY, options);
  };

  const renderSectionComponent = (sectionName: AdjustmentSectionName): ReactNode => {
    switch (sectionName) {
      case 'basic':
        return (
          <BasicAdjustments
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'curves':
        return (
          <CurveGraph
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            histogram={histogram}
            theme={theme}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'color':
        return (
          <ColorPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            appSettings={appSettings}
            isWbPickerActive={isWbPickerActive}
            toggleWbPicker={toggleWbPicker}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'details':
        return (
          <DetailsPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'effects':
        return (
          <EffectsPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            isForMask={false}
            handleLutSelect={(path) => {
              void handleLutSelect(path);
            }}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <UiText variant={TextVariants.title}>{t('editor.adjustments.title')}</UiText>
        <div className="flex items-center gap-1">
          <button
            className="p-2 rounded-full hover:bg-surface disabled:cursor-not-allowed transition-colors"
            disabled={!selectedImage?.isReady}
            onClick={() => {
              void handleAutoAdjustments();
            }}
            data-tooltip={t('editor.adjustments.tooltips.autoAdjust')}
          >
            <Aperture size={18} />
          </button>
          <button
            className={cx(
              'p-2 rounded-full transition-colors',
              isWaveformVisible ? 'bg-surface hover:bg-card-active' : 'hover:bg-surface',
            )}
            onClick={onToggleWaveform}
            data-tooltip={t('editor.adjustments.tooltips.toggleAnalytics')}
          >
            <ChartArea size={18} />
          </button>
          <button
            className="p-2 rounded-full hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={!selectedImage}
            onClick={() => {
              handleResetAdjustments();
            }}
            data-tooltip={t('editor.adjustments.tooltips.resetAdjustments')}
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      {selectedImage?.isRaw && (
        <div
          className="shrink-0 border-b border-surface px-4 py-3 space-y-2"
          data-testid="raw-processing-mode-override-control"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <UiText as="div" variant={TextVariants.small} className="font-medium">
                {t('editor.adjustments.rawProcessingModeOverride.label')}
              </UiText>
              <UiText as="div" variant={TextVariants.small} className="text-text-secondary">
                {t('editor.adjustments.rawProcessingModeOverride.description')}
              </UiText>
            </div>
            <Dropdown
              className="w-44 shrink-0"
              onChange={(mode) => {
                void handleRawProcessingModeOverrideChange(mode);
              }}
              options={rawProcessingModeOverrideOptions}
              value={adjustments.rawProcessingModeOverride ?? 'inherit'}
            />
          </div>
          <UiText as="div" variant={TextVariants.small} className="font-mono text-text-secondary">
            {
              RAW_PROCESSING_MODE_RECIPES[
                adjustments.rawProcessingModeOverride ?? normalizeRawProcessingMode(appSettings?.rawProcessingMode)
              ].provenance
            }
          </UiText>
          <button
            className="flex w-full items-center justify-center gap-2 rounded-md bg-surface px-3 py-2 text-sm font-medium hover:bg-card-active disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="raw-reconstruction-comparison-run"
            disabled={isComparingRawReconstruction || !selectedImage.isReady}
            onClick={() => {
              void handleCompareRawReconstructionModes();
            }}
            type="button"
          >
            <ScanSearch size={16} />
            {isComparingRawReconstruction
              ? t('editor.adjustments.rawReconstructionComparison.running')
              : t('editor.adjustments.rawReconstructionComparison.action')}
          </button>
          {rawReconstructionComparison !== null && (
            <div
              className="space-y-2 rounded-md border border-surface bg-background/50 p-2"
              data-crop-size={rawReconstructionComparison.cropSize}
              data-testid="raw-reconstruction-comparison-result"
            >
              <div className="flex items-center justify-between gap-2">
                <UiText variant={TextVariants.small} className="font-medium">
                  {t('editor.adjustments.rawReconstructionComparison.title')}
                </UiText>
                <UiText variant={TextVariants.small} className="font-mono text-text-secondary">
                  {t('editor.adjustments.rawReconstructionComparison.cropSizeLabel', {
                    size: rawReconstructionComparison.cropSize,
                  })}
                </UiText>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {rawReconstructionComparison.modes.map((mode) => (
                  <div
                    className="min-w-0 space-y-1"
                    data-crop-hash={mode.cropHash}
                    data-decode-ms={mode.decodeElapsedMs}
                    data-mode={mode.mode}
                    data-testid={`raw-reconstruction-comparison-mode-${mode.mode}`}
                    key={mode.mode}
                  >
                    <img
                      alt={t('editor.adjustments.rawReconstructionComparison.cropAlt', {
                        mode: t(`settings.processing.rawModes.${mode.mode}.label`),
                      })}
                      className="aspect-square w-full rounded border border-surface object-cover"
                      src={mode.cropDataUrl}
                    />
                    <UiText as="div" variant={TextVariants.small} className="truncate font-medium">
                      {t(`settings.processing.rawModes.${mode.mode}.label`)}
                    </UiText>
                    <UiText as="div" variant={TextVariants.small} className="font-mono text-text-secondary">
                      {t('editor.adjustments.rawReconstructionComparison.decodeMsLabel', {
                        ms: mode.decodeElapsedMs,
                      })}
                    </UiText>
                    <UiText as="div" variant={TextVariants.small} className="truncate font-mono text-text-secondary">
                      {formatBytes(mode.estimatedMemoryBytes)}
                    </UiText>
                  </div>
                ))}
              </div>
              <UiText as="div" variant={TextVariants.small} className="break-all font-mono text-text-secondary">
                {rawReconstructionComparison.proofBoundary}
              </UiText>
            </div>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {isWaveformVisible && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: waveformHeight || 256, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: isResizingWaveform ? 0 : 0.2, ease: 'easeOut' }}
            className="shrink-0 flex flex-col relative border-b border-surface overflow-hidden"
          >
            <div className="grow w-full h-full p-4 pb-2 min-h-0">
              <Waveform
                waveformData={waveform || null}
                histogram={histogram}
                previewScopeStatus={previewScopeStatus}
                displayMode={activeWaveformChannel}
                setDisplayMode={setActiveWaveformChannel}
                showClipping={adjustments.showClipping || false}
                onToggleClipping={() => {
                  setAdjustments((prev: Adjustments) => ({
                    ...prev,
                    showClipping: !prev.showClipping,
                  }));
                }}
                theme={theme}
              />
            </div>
            <Resizer direction={Orientation.Horizontal} onMouseDown={handleWaveformResize} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grow overflow-y-auto p-4 flex flex-col gap-2">
        {ADJUSTMENT_SECTION_NAMES.map((sectionName) => {
          const title = t(`editor.adjustments.sections.${sectionName}`, {
            defaultValue: ADJUSTMENT_SECTION_LABEL_FALLBACKS[sectionName],
          });
          const sectionVisibility = adjustments.sectionVisibility;

          return (
            <div className="shrink-0 group" key={sectionName}>
              <CollapsibleSection
                isContentVisible={sectionVisibility[sectionName]}
                isOpen={collapsibleSectionsState[sectionName]}
                onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
                  handleSectionContextMenu(event, sectionName);
                }}
                onToggle={() => {
                  handleToggleSection(sectionName);
                }}
                onToggleVisibility={() => {
                  handleToggleVisibility(sectionName);
                }}
                title={title}
              >
                {renderSectionComponent(sectionName)}
              </CollapsibleSection>
            </div>
          );
        })}
      </div>
    </div>
  );
}
