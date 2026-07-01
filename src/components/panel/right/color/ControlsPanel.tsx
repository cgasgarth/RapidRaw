import cx from 'clsx';
import type { TFunction } from 'i18next';
import { Aperture, ChartArea, ChevronDown, ClipboardPaste, Copy, Info, RotateCcw, ScanSearch } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';

import { useContextMenu } from '../../../../context/ContextMenuContext';
import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import type { RawDevelopmentReport } from '../../../../schemas/imageLoaderSchemas';
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
  hasAdjustmentValueChanges,
  INITIAL_ADJUSTMENTS,
  pickAdjustmentValues,
} from '../../../../utils/adjustments';
import { formatUnknownError } from '../../../../utils/errorFormatting';
import {
  getRawProcessingModeDisplayCopy,
  getRawProcessingModeProvenance,
  normalizeRawProcessingMode,
  RAW_PROCESSING_MODES,
  type RawProcessingMode,
} from '../../../../utils/rawProcessingModes';
import { invokeWithSchema } from '../../../../utils/tauriSchemaInvoke';
import BasicAdjustments from '../../../adjustments/Basic';
import CurveGraph from '../../../adjustments/Curves';
import DetailsPanel from '../../../adjustments/Details';
import EffectsPanel from '../../../adjustments/Effects';
import { OPTION_SEPARATOR, type Option } from '../../../ui/AppProperties';
import CollapsibleSection, { type CollapsibleSectionHeaderAction } from '../../../ui/CollapsibleSection';
import { editorChromeStatusChipClassName } from '../../../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import Dropdown, { type OptionItem } from '../../../ui/primitives/Dropdown';
import UiText from '../../../ui/primitives/Text';
import PanelScopesStrip from '../inspector/PanelScopesStrip';

const ADJUSTMENT_SECTION_NAMES = ['basic', 'curves', 'details', 'effects'] as const;
type AdjustmentSectionName = (typeof ADJUSTMENT_SECTION_NAMES)[number];
type RawProcessingModeOverrideOption = RawProcessingMode | 'inherit';
type CollapsibleSectionsUpdater =
  | CollapsibleSectionsState
  | ((prev: CollapsibleSectionsState) => CollapsibleSectionsState);
interface AdjustmentSectionActions {
  headerActions: CollapsibleSectionHeaderAction[];
  menuOptions: Option[];
}

const ADJUSTMENT_SECTION_LABEL_FALLBACKS: Record<AdjustmentSectionName, string> = {
  basic: 'Basic Tone',
  curves: 'Tone Curves',
  details: 'Detail',
  effects: 'Effects & Looks',
};
const RAW_RECONSTRUCTION_COMPARISON_CROP_SIZE = 256;
const PANEL_ACTION_ICON_SIZE = 14;

const formatBytes = (value: number): string => {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
};

const hasRawProcessingStatusRequiringAttention = (report: RawDevelopmentReport | null | undefined): boolean => {
  const cameraProfile = report?.cameraProfile;
  if (!cameraProfile) return false;

  return (
    cameraProfile.warningCodes.length > 0 ||
    cameraProfile.fallbackReason != null ||
    cameraProfile.status === 'fallback' ||
    cameraProfile.status === 'unavailable' ||
    cameraProfile.colorCheckerGate?.status === 'gated_fail' ||
    cameraProfile.colorCheckerGate?.status === 'gated_warn' ||
    cameraProfile.colorCheckerGate?.fallbackReason != null ||
    report.demosaicPath === 'fast' ||
    report.demosaicPath === 'linear_bypass'
  );
};

const getAdjustmentSectionLabel = (t: TFunction, sectionName: AdjustmentSectionName): string =>
  String(
    t(`editor.adjustments.scopedSections.${sectionName}`, {
      defaultValue: ADJUSTMENT_SECTION_LABEL_FALLBACKS[sectionName],
    }),
  );

const toHeaderAction = (option: Option, testId: string): CollapsibleSectionHeaderAction | null => {
  if (option.type === OPTION_SEPARATOR || !option.icon || !option.label || !option.onClick) {
    return null;
  }

  return {
    ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
    icon: option.icon,
    label: option.label,
    onClick: option.onClick,
    testId,
  };
};

export default function Controls() {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const { showContextMenu } = useContextMenu();
  const { onToggleWaveform } = useWaveformControls();
  const { setAdjustments, handleAutoAdjustments, handleLutSelect } = useEditorActions();
  const [rawReconstructionComparison, setRawReconstructionComparison] =
    useState<RawReconstructionComparisonResult | null>(null);
  const [isComparingRawReconstruction, setIsComparingRawReconstruction] = useState(false);
  const [isRawProcessingModeProvenanceVisible, setIsRawProcessingModeProvenanceVisible] = useState(false);
  const [isRawProcessingControlsOpen, setIsRawProcessingControlsOpen] = useState(false);

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

  const { adjustments, copiedSectionAdjustments, histogram, selectedImage, isWaveformVisible, setEditor } =
    useEditorStore(
      useShallow((state) => ({
        adjustments: state.adjustments,
        copiedSectionAdjustments: state.copiedSectionAdjustments,
        histogram: state.histogram,
        selectedImage: state.selectedImage,
        isWaveformVisible: state.isWaveformVisible,
        setEditor: state.setEditor,
      })),
    );

  const rawProcessingModeDisplay = useMemo(
    () =>
      getRawProcessingModeDisplayCopy(
        adjustments.rawProcessingModeOverride ?? normalizeRawProcessingMode(appSettings?.rawProcessingMode),
        t,
      ),
    [adjustments.rawProcessingModeOverride, appSettings?.rawProcessingMode, t],
  );

  const isRawProcessingStatusAttentionRequired = useMemo(
    () => selectedImage?.isRaw === true && hasRawProcessingStatusRequiringAttention(selectedImage.rawDevelopmentReport),
    [selectedImage?.isRaw, selectedImage?.rawDevelopmentReport],
  );

  useEffect(() => {
    setIsRawProcessingControlsOpen(isRawProcessingStatusAttentionRequired);
    setIsRawProcessingModeProvenanceVisible(false);
    setRawReconstructionComparison(null);
  }, [isRawProcessingStatusAttentionRequired, selectedImage?.path]);

  const setCopiedSectionAdjustments = useCallback(
    (val: CopiedSectionAdjustments | null) => {
      setEditor({ copiedSectionAdjustments: val });
    },
    [setEditor],
  );

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
    const resetValues = pickAdjustmentValues(Object.values(ADJUSTMENT_SECTIONS).flat(), INITIAL_ADJUSTMENTS);

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

  const buildSectionActions = (sectionName: AdjustmentSectionName): AdjustmentSectionActions => {
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
    const translatedSection = getAdjustmentSectionLabel(t, sectionName);

    const pasteLabel = copiedSection
      ? t('editor.adjustments.actions.pasteLabel', { section: translatedSection })
      : t('editor.adjustments.actions.pasteSettings');

    const copyOption: Option = {
      label: t('editor.adjustments.actions.copySectionSettings', { section: translatedSection }),
      icon: Copy,
      onClick: handleCopy,
    };
    const pasteOption: Option = {
      label: pasteLabel,
      icon: ClipboardPaste,
      onClick: handlePaste,
      disabled: !isPasteAllowed,
    };
    const resetOption: Option = {
      label: t('editor.adjustments.actions.resetSectionSettings', { section: translatedSection }),
      icon: RotateCcw,
      onClick: handleReset,
    };
    const menuOptions: Option[] = [copyOption, pasteOption, { type: OPTION_SEPARATOR }, resetOption];

    return {
      headerActions: (
        [
          [copyOption, 'copy'],
          [pasteOption, 'paste'],
          [resetOption, 'reset'],
        ] satisfies Array<[Option, string]>
      ).flatMap(([option, actionName]) => {
        const action = toHeaderAction(option, `adjustments-section-${sectionName}-action-${String(actionName)}`);
        return action ? [action] : [];
      }),
      menuOptions,
    };
  };

  const openSectionActionsMenu = (x: number, y: number, sectionName: AdjustmentSectionName) => {
    showContextMenu(x, y, buildSectionActions(sectionName).menuOptions);
  };

  const handleSectionContextMenu = (event: MouseEvent<HTMLDivElement>, sectionName: AdjustmentSectionName) => {
    event.preventDefault();
    event.stopPropagation();
    openSectionActionsMenu(event.clientX, event.clientY, sectionName);
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
    <div className="flex h-full flex-col bg-editor-panel text-text-primary">
      <div className={density.panelHeader.root}>
        <UiText as="h2" variant={TextVariants.heading} className={density.panelHeader.title}>
          {t('editor.adjustments.title')}
        </UiText>
        <div className="flex items-center gap-1">
          <button
            aria-label={t('editor.adjustments.tooltips.autoAdjust')}
            className={density.panelHeader.actionButton}
            disabled={!selectedImage?.isReady}
            onClick={() => {
              void handleAutoAdjustments();
            }}
            data-tooltip={t('editor.adjustments.tooltips.autoAdjust')}
            type="button"
          >
            <Aperture size={PANEL_ACTION_ICON_SIZE} />
          </button>
          <button
            aria-label={t('editor.adjustments.tooltips.toggleAnalytics')}
            aria-pressed={isWaveformVisible}
            className={cx(
              density.panelHeader.actionButton,
              isWaveformVisible && density.panelHeader.actionButtonActive,
            )}
            data-state={isWaveformVisible ? 'open' : 'closed'}
            onClick={onToggleWaveform}
            data-testid="adjustments-panel-scopes-toggle"
            data-tooltip={t('editor.adjustments.tooltips.toggleAnalytics')}
            type="button"
          >
            <ChartArea size={PANEL_ACTION_ICON_SIZE} />
          </button>
          <button
            aria-label={t('editor.adjustments.tooltips.resetAdjustments')}
            className={density.panelHeader.actionButton}
            disabled={!selectedImage}
            onClick={() => {
              handleResetAdjustments();
            }}
            data-tooltip={t('editor.adjustments.tooltips.resetAdjustments')}
            type="button"
          >
            <RotateCcw size={PANEL_ACTION_ICON_SIZE} />
          </button>
        </div>
      </div>

      {selectedImage?.isRaw && (
        <div
          className={density.rawProcessing.root}
          data-attention={isRawProcessingStatusAttentionRequired}
          data-testid="raw-processing-mode-override-control"
        >
          <button
            aria-expanded={isRawProcessingControlsOpen}
            className={density.rawProcessing.disclosure}
            onClick={() => {
              setIsRawProcessingControlsOpen((previous) => !previous);
            }}
            type="button"
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <UiText as="span" variant={TextVariants.small} className={density.rawProcessing.label}>
                {t('editor.adjustments.rawProcessingModeOverride.label')}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className={density.rawProcessing.statusValue}>
                {t('editor.adjustments.rawProcessingModeOverride.currentValue', {
                  mode: rawProcessingModeDisplay,
                })}
              </UiText>
              {isRawProcessingStatusAttentionRequired && (
                <span className={editorChromeStatusChipClassName('warning')}>
                  {t('editor.adjustments.rawProcessingModeOverride.attention', { defaultValue: 'Check' })}
                </span>
              )}
            </span>
            <ChevronDown
              className={cx('shrink-0 text-accent/90 transition-transform duration-200', {
                'rotate-180': isRawProcessingControlsOpen,
              })}
              size={16}
            />
          </button>

          {isRawProcessingControlsOpen && (
            <div className={density.rawProcessing.body}>
              <div className="grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-2 max-[380px]:grid-cols-1">
                <UiText as="div" variant={TextVariants.small} className={density.rawProcessing.description}>
                  {t('editor.adjustments.rawProcessingModeOverride.description')}
                </UiText>
                <Dropdown
                  chrome="editor"
                  className="w-full shrink-0"
                  onChange={(mode) => {
                    void handleRawProcessingModeOverrideChange(mode);
                  }}
                  options={rawProcessingModeOverrideOptions}
                  value={adjustments.rawProcessingModeOverride ?? 'inherit'}
                />
              </div>
              <div className="flex items-center justify-end">
                <button
                  className={density.rawProcessing.provenanceButton}
                  onClick={() => {
                    setIsRawProcessingModeProvenanceVisible((previous) => !previous);
                  }}
                  type="button"
                >
                  <Info size={12} />
                  {isRawProcessingModeProvenanceVisible
                    ? t('editor.adjustments.rawProcessingModeOverride.hideRecipeId')
                    : t('editor.adjustments.rawProcessingModeOverride.showRecipeId')}
                </button>
              </div>
              {isRawProcessingModeProvenanceVisible ? (
                <UiText as="div" variant={TextVariants.small} className={density.rawProcessing.provenanceValue}>
                  {getRawProcessingModeProvenance(
                    adjustments.rawProcessingModeOverride ?? normalizeRawProcessingMode(appSettings?.rawProcessingMode),
                  )}
                </UiText>
              ) : null}
              <button
                className={density.rawProcessing.compareButton}
                data-testid="raw-reconstruction-comparison-run"
                disabled={isComparingRawReconstruction || !selectedImage.isReady}
                aria-busy={isComparingRawReconstruction}
                onClick={() => {
                  void handleCompareRawReconstructionModes();
                }}
                type="button"
              >
                <ScanSearch size={14} />
                {isComparingRawReconstruction
                  ? t('editor.adjustments.rawReconstructionComparison.running')
                  : t('editor.adjustments.rawReconstructionComparison.action')}
              </button>
              {rawReconstructionComparison !== null && (
                <div
                  className={density.rawProcessing.resultCard}
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
                  <div className="grid grid-cols-3 gap-1.5">
                    {rawReconstructionComparison.modes.map((mode) => (
                      <div
                        className={density.rawProcessing.resultMetric}
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
                          className="aspect-square w-full rounded border border-editor-border object-cover"
                          src={mode.cropDataUrl}
                        />
                        <UiText
                          as="div"
                          variant={TextVariants.small}
                          className="truncate text-[11px] font-medium leading-4"
                        >
                          {t(`settings.processing.rawModes.${mode.mode}.label`)}
                        </UiText>
                        <UiText
                          as="div"
                          variant={TextVariants.small}
                          className="font-mono text-[10px] leading-3 text-text-secondary"
                        >
                          {t('editor.adjustments.rawReconstructionComparison.decodeMsLabel', {
                            ms: mode.decodeElapsedMs,
                          })}
                        </UiText>
                        <UiText
                          as="div"
                          variant={TextVariants.small}
                          className="truncate font-mono text-[10px] leading-3 text-text-secondary"
                        >
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
        </div>
      )}

      <PanelScopesStrip testId="adjustments-panel-scopes-strip" />

      <div className="grow overflow-y-auto px-2 py-1.5 flex flex-col gap-1">
        {ADJUSTMENT_SECTION_NAMES.map((sectionName) => {
          const title = getAdjustmentSectionLabel(t, sectionName);
          const sectionVisibility = adjustments.sectionVisibility;
          const sectionActions = buildSectionActions(sectionName);

          return (
            <div className="shrink-0 group" data-testid={`adjustments-section-${sectionName}`} key={sectionName}>
              <CollapsibleSection
                actionsMenuLabel={sectionActions.headerActions.map((action) => action.label).join(', ')}
                actionsMenuTestId={`adjustments-section-${sectionName}-actions-menu`}
                headerActions={sectionActions.headerActions}
                isContentVisible={sectionVisibility[sectionName]}
                isDirty={hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS[sectionName], adjustments)}
                isOpen={collapsibleSectionsState[sectionName]}
                onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
                  handleSectionContextMenu(event, sectionName);
                }}
                onToggle={() => {
                  handleToggleSection(sectionName);
                }}
                onOpenActionsMenu={(x, y) => {
                  showContextMenu(x, y, sectionActions.menuOptions);
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
