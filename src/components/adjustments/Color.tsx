import cx from 'clsx';
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { debouncedSave } from '../../hooks/editor/useEditorActions';
import type { BlackWhiteMixerChannel } from '../../schemas/color/blackWhiteMixerSchemas';
import type { ChannelMixerOutput } from '../../schemas/color/channelMixerSchemas';
import type { ColorBalanceRgbRange } from '../../schemas/color/colorBalanceRgbSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { type Adjustments, ColorAdjustment } from '../../utils/adjustments';
import {
  getRenderedPreviewWarningStatus,
  isCurrentExportSoftProofGamutWarningOverlay,
} from '../../utils/color/runtime/gamutWarningDisplay';
import { COLOR_OUTPUT_FOCUS_EVENT, COLOR_WORKSPACE_TAB_SESSION_KEY } from '../../utils/colorWorkspaceNavigation';
import {
  applyColorRangeLocalAdjustmentLayerFlow,
  buildColorRangeProposalSourcePixels,
  createColorRangeLocalAdjustmentLayerDraft,
} from '../../utils/layers/colorRangeLocalAdjustmentCommandFlow';
import { persistLayerStackSidecarInAdjustments } from '../../utils/layers/layerStackSidecarAdjustments';
import { createColorRangeMaskParameters } from '../../utils/mask/colorRangeMaskParameters';
import { getSelectiveColorRange } from '../../utils/selectiveColorRanges';
import type { AppSettings } from '../ui/AppProperties';
import { professionalInspectorDensityTokens } from '../ui/inspectorTokens';
import { ColorAdvancedControls } from './color/ColorAdvancedControls';
import { ColorGradingControls } from './color/ColorGradingControls';
import { ColorMixerControls } from './color/ColorMixerControls';
import { ColorProfileToneControls } from './color/ColorProfileToneControls';
import { ColorProofingDiagnostics } from './color/ColorProofingDiagnostics';
import { ColorQuickControls } from './color/ColorQuickControls';
import type { AdjustmentUpdate } from './color/types';

interface ColorPanelProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  isWbPickerActive?: boolean;
  toggleWbPicker?: () => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

const COLOR_WORKSPACE_TAB_IDS = ['foundation', 'mixer', 'grading', 'output'] as const;
type ColorWorkspaceTabId = (typeof COLOR_WORKSPACE_TAB_IDS)[number];
let sessionColorWorkspaceTab: ColorWorkspaceTabId = 'foundation';
const COLOR_WORKSPACE_TAB_BASE_CLASS = professionalInspectorDensityTokens.workspaceNavigation.tab;
const COLOR_WORKSPACE_TAB_ACTIVE_CLASS = professionalInspectorDensityTokens.workspaceNavigation.active;
const COLOR_WORKSPACE_TAB_INACTIVE_CLASS = professionalInspectorDensityTokens.workspaceNavigation.inactive;
interface ColorWorkspaceTab {
  id: ColorWorkspaceTabId;
  label: string;
  panel: ReactNode;
}

const getNextColorWorkspaceTabId = (
  tabs: Array<ColorWorkspaceTab>,
  activeTabId: ColorWorkspaceTabId,
  direction: 1 | -1,
): ColorWorkspaceTabId => {
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;

  return tabs[nextIndex]?.id ?? tabs[0]?.id ?? 'foundation';
};

const parseColorWorkspaceTabId = (value: string | null): ColorWorkspaceTabId | null => {
  if (value === 'quick') return 'foundation';
  if (value === 'editor') return 'mixer';
  return COLOR_WORKSPACE_TAB_IDS.find((tabId) => tabId === value) ?? null;
};

const readSessionColorWorkspaceTab = (): ColorWorkspaceTabId => {
  if (typeof window === 'undefined') return sessionColorWorkspaceTab;

  try {
    const storedTab = parseColorWorkspaceTabId(window.sessionStorage.getItem(COLOR_WORKSPACE_TAB_SESSION_KEY));
    if (storedTab !== null) {
      sessionColorWorkspaceTab = storedTab;
    }
  } catch {
    return sessionColorWorkspaceTab;
  }

  return sessionColorWorkspaceTab;
};

const rememberSessionColorWorkspaceTab = (tabId: ColorWorkspaceTabId) => {
  sessionColorWorkspaceTab = tabId;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(COLOR_WORKSPACE_TAB_SESSION_KEY, tabId);
    } catch {
      // Local state still carries the selection when browser storage is unavailable.
    }
  }
};

const skinTonePreviewHsl = (settings: Adjustments['skinToneUniformity']) => {
  const hueDelta = Math.min(
    settings.maxHueShiftDegrees,
    Math.max(-settings.maxHueShiftDegrees, settings.targetHueDegrees - 18),
  );

  return {
    hue: (hueDelta * settings.hueUniformity).toFixed(1),
    luminance: ((settings.targetLuminance - 0.5) * 100 * settings.luminanceUniformity).toFixed(1),
    saturation: ((settings.targetSaturation - 0.45) * 100 * settings.saturationUniformity).toFixed(1),
  };
};

export default function ColorPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  isWbPickerActive = false,
  toggleWbPicker,
  onDragStateChange,
}: ColorPanelProps) {
  const { t } = useTranslation();
  const tablistId = useId();
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<ColorWorkspaceTabId>(readSessionColorWorkspaceTab);
  const [activeColor, setActiveColor] = useState<BlackWhiteMixerChannel>('reds');
  const [activeColorBalanceRange, setActiveColorBalanceRange] = useState<ColorBalanceRgbRange>('midtones');
  const [activeChannelMixerOutput, setActiveChannelMixerOutput] = useState<ChannelMixerOutput>('red');
  const gamutWarningOverlay = useEditorStore((state) => state.gamutWarningOverlay);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const exportSoftProofRecipeId = useEditorStore((state) => state.exportSoftProofRecipeId);
  const exportSoftProofTransform = useEditorStore((state) => state.exportSoftProofTransform);
  const isExportSoftProofEnabled = useEditorStore((state) => state.isExportSoftProofEnabled);
  const isGamutWarningOverlayVisible = useEditorStore((state) => state.isGamutWarningOverlayVisible);
  const pushHistory = useEditorStore((state) => state.pushHistory);
  const setEditor = useEditorStore((state) => state.setEditor);
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const isColorCalibrationVisible = (adjustmentVisibility as { colorCalibration?: boolean }).colorCalibration !== false;
  const isLevelsVisible = adjustmentVisibility[ColorAdjustment.Levels] !== false;
  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;
  const isCurrentGamutWarningOverlay = isCurrentExportSoftProofGamutWarningOverlay(gamutWarningOverlay, {
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    isExportSoftProofEnabled,
    selectedImagePath,
  });
  const currentGamutWarningOverlay = isCurrentGamutWarningOverlay ? gamutWarningOverlay : null;
  const renderedPreviewWarningStatus = getRenderedPreviewWarningStatus(gamutWarningOverlay, {
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    isExportSoftProofEnabled,
    selectedImagePath,
  });
  const levels = adjustments.levels;
  const levelsClippingWarnings = [
    levels.inputBlack > 0 ? t('adjustments.color.levels.warnings.shadowClipping') : null,
    levels.inputWhite < 1 ? t('adjustments.color.levels.warnings.highlightClipping') : null,
    levels.outputBlack > 0 || levels.outputWhite < 1 ? t('adjustments.color.levels.warnings.outputCompression') : null,
  ].filter((warning): warning is string => warning !== null);
  const createLocalAdjustmentFromActiveColorRange = () => {
    if (isForMask || selectedImage === null) return;

    const currentState = useEditorStore.getState();
    const rangeControl = adjustments.selectiveColorRangeControls[activeColor];
    const currentHsl = adjustments.hsl[activeColor];
    const rangeLabel = t(getSelectiveColorRange(activeColor).labelKey);
    const layerId = crypto.randomUUID();
    const maskId = `${layerId}_color_range_mask`;
    const operationId = crypto.randomUUID();
    const feather = Math.max(0.05, Math.min(0.95, rangeControl.falloffSmoothness / 4));
    const colorRangeParameters = createColorRangeMaskParameters(activeColor, {
      centerHueDegrees: rangeControl.centerHueDegrees,
      feather,
      hueToleranceDegrees: Math.max(1, Math.min(180, rangeControl.widthDegrees / 2)),
    });
    const toneColor = {
      blackPoint: 0,
      clarity: 0,
      contrast: 0,
      exposureEv: Number((currentHsl.luminance / 100).toFixed(3)),
      highlights: 0,
      saturation: currentHsl.saturation === 0 && currentHsl.luminance === 0 ? 10 : currentHsl.saturation,
      shadows: 0,
      whitePoint: 0,
    };
    const layer = createColorRangeLocalAdjustmentLayerDraft({
      layerId,
      maskId,
      maskName: t('adjustments.color.colorRangeLocalAdjustmentMaskName', {
        defaultValue: '{{range}} range mask',
        range: rangeLabel,
      }),
      name: t('adjustments.color.colorRangeLocalAdjustmentLayerName', {
        defaultValue: '{{range}} local adjustment',
        range: rangeLabel,
      }),
      parameters: colorRangeParameters,
    });
    const result = applyColorRangeLocalAdjustmentLayerFlow(currentState.adjustments.masks, {
      colorRangeParameters,
      context: {
        graphRevision: `history_${currentState.historyIndex}`,
        imagePath: selectedImage.path,
        operationId,
        sessionId: 'rapidraw-color-workspace',
      },
      imageSize: { height: 8, width: 8 },
      layer,
      maskName: layer.subMasks[0]?.name ?? `${rangeLabel} range mask`,
      sourceRgbPixels: buildColorRangeProposalSourcePixels(activeColor),
      toneColor,
    });
    const nextAdjustments = persistLayerStackSidecarInAdjustments(
      { ...currentState.adjustments, masks: result.masks },
      result.toneResult.sidecar,
    );

    setEditor({
      activeMaskContainerId: layerId,
      activeMaskId: maskId,
      adjustments: nextAdjustments,
      uncroppedAdjustedPreviewUrl: null,
    });
    pushHistory(nextAdjustments);
    debouncedSave(selectedImage.path, nextAdjustments);
  };

  const syncSkinToneUniformity = (nextSettings: Adjustments['skinToneUniformity']) => {
    const nextPreview = skinTonePreviewHsl(nextSettings);
    setAdjustments((prev) => ({
      ...prev,
      hsl: {
        ...prev.hsl,
        oranges: {
          ...prev.hsl.oranges,
          hue: nextSettings.enabled ? Number(nextPreview.hue) : 0,
          luminance: nextSettings.enabled ? Number(nextPreview.luminance) : 0,
          saturation: nextSettings.enabled ? Number(nextPreview.saturation) : 0,
        },
      },
      skinToneUniformity: nextSettings,
    }));
  };

  const workspaceTabs = useMemo<Array<ColorWorkspaceTab>>(() => {
    const tabs: Array<ColorWorkspaceTab> = [
      {
        id: 'foundation',
        label: t('adjustments.color.workspaceTabs.foundation'),
        panel: (
          <div className="space-y-px" data-testid="color-foundation-controls">
            {!isForMask && (
              <ColorProfileToneControls
                adjustmentVisibility={adjustmentVisibility}
                adjustments={adjustments}
                appSettings={appSettings}
                rawDevelopmentReport={selectedImage?.rawDevelopmentReport ?? null}
                onDragStateChange={onDragStateChange}
                setAdjustments={setAdjustments}
              />
            )}
            <ColorQuickControls
              adjustments={adjustments}
              appSettings={appSettings}
              isForMask={isForMask}
              isWbPickerActive={isWbPickerActive}
              isWgpuEnabled={isWgpuEnabled}
              onDragStateChange={onDragStateChange}
              setAdjustments={setAdjustments}
              {...(toggleWbPicker ? { toggleWbPicker } : {})}
            />
            {!isForMask && isColorCalibrationVisible ? (
              <ColorAdvancedControls
                adjustmentVisibility={adjustmentVisibility}
                adjustments={adjustments}
                appSettings={appSettings}
                isColorCalibrationVisible={isColorCalibrationVisible}
                levelsClippingWarnings={levelsClippingWarnings}
                mode="calibration"
                onDragStateChange={onDragStateChange}
                setAdjustments={setAdjustments}
              />
            ) : null}
          </div>
        ),
      },
      {
        id: 'mixer',
        label: t('adjustments.color.workspaceTabs.mixer'),
        panel: (
          <div className="space-y-1">
            <ColorMixerControls
              activeChannelMixerOutput={activeChannelMixerOutput}
              activeColor={activeColor}
              activeColorBalanceRange={activeColorBalanceRange}
              adjustmentVisibility={adjustmentVisibility}
              adjustments={adjustments}
              canCreateLocalAdjustmentFromActiveRange={!isForMask && selectedImage !== null}
              appSettings={appSettings}
              isForMask={isForMask}
              onCreateLocalAdjustmentFromActiveRange={createLocalAdjustmentFromActiveColorRange}
              onDragStateChange={onDragStateChange}
              setActiveChannelMixerOutput={setActiveChannelMixerOutput}
              setActiveColor={setActiveColor}
              setActiveColorBalanceRange={setActiveColorBalanceRange}
              setAdjustments={setAdjustments}
            />
            {!isForMask && isLevelsVisible ? (
              <ColorAdvancedControls
                adjustmentVisibility={adjustmentVisibility}
                adjustments={adjustments}
                appSettings={appSettings}
                isColorCalibrationVisible={isColorCalibrationVisible}
                levelsClippingWarnings={levelsClippingWarnings}
                mode="levels"
                onDragStateChange={onDragStateChange}
                setAdjustments={setAdjustments}
              />
            ) : null}
          </div>
        ),
      },
      {
        id: 'grading',
        label: t('adjustments.color.workspaceTabs.grading'),
        panel: (
          <ColorGradingControls
            adjustments={adjustments}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
            setAdjustments={setAdjustments}
          />
        ),
      },
    ];

    if (!isForMask) {
      tabs.push({
        id: 'output',
        label: t('adjustments.color.workspaceTabs.output'),
        panel: (
          <ColorProofingDiagnostics
            adjustments={adjustments}
            appSettings={appSettings}
            hasCurrentGamutWarning={currentGamutWarningOverlay !== null}
            isGamutWarningOverlayVisible={isGamutWarningOverlayVisible}
            onDragStateChange={onDragStateChange}
            renderedPreviewWarningStatus={renderedPreviewWarningStatus}
            setAdjustments={setAdjustments}
            setEditor={setEditor}
            syncSkinToneUniformity={syncSkinToneUniformity}
          />
        ),
      });
    }

    return tabs;
  }, [
    activeChannelMixerOutput,
    activeColor,
    activeColorBalanceRange,
    adjustmentVisibility,
    adjustments,
    appSettings,
    currentGamutWarningOverlay,
    isColorCalibrationVisible,
    isForMask,
    isGamutWarningOverlayVisible,
    isLevelsVisible,
    isWbPickerActive,
    isWgpuEnabled,
    levelsClippingWarnings,
    onDragStateChange,
    renderedPreviewWarningStatus,
    selectedImage,
    setAdjustments,
    setEditor,
    syncSkinToneUniformity,
    t,
    toggleWbPicker,
  ]);
  useEffect(() => {
    if (!workspaceTabs.some((tab) => tab.id === activeWorkspaceTab)) {
      const nextTabId = workspaceTabs[0]?.id ?? 'foundation';

      setActiveWorkspaceTab(nextTabId);
      rememberSessionColorWorkspaceTab(nextTabId);
    }
  }, [activeWorkspaceTab, workspaceTabs]);

  const selectWorkspaceTab = useCallback((tabId: ColorWorkspaceTabId) => {
    setActiveWorkspaceTab(tabId);
    rememberSessionColorWorkspaceTab(tabId);
  }, []);

  useEffect(() => {
    const focusOutputControls = () => {
      selectWorkspaceTab('output');
      requestAnimationFrame(() => {
        document.getElementById(`${tablistId}-output-tab`)?.focus();
      });
    };

    window.addEventListener(COLOR_OUTPUT_FOCUS_EVENT, focusOutputControls);
    return () => window.removeEventListener(COLOR_OUTPUT_FOCUS_EVENT, focusOutputControls);
  }, [selectWorkspaceTab, tablistId]);

  const focusColorWorkspaceTab = (tabId: ColorWorkspaceTabId) => {
    requestAnimationFrame(() => {
      document.getElementById(`${tablistId}-${tabId}-tab`)?.focus();
    });
  };

  const handleWorkspaceTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextTabId = getNextColorWorkspaceTabId(workspaceTabs, activeWorkspaceTab, 1);

      selectWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextTabId = getNextColorWorkspaceTabId(workspaceTabs, activeWorkspaceTab, -1);

      selectWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      const nextTabId = workspaceTabs[0]?.id ?? 'foundation';

      selectWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const nextTabId = workspaceTabs.at(-1)?.id ?? 'foundation';

      selectWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
    }
  };

  return (
    <div className="space-y-1" data-color-inspector-density="compact">
      <div
        className="sticky top-0 z-20 -mx-2.5 border-b border-editor-border bg-editor-panel px-2.5 py-1"
        data-sticky="true"
        data-testid="color-workspace-tab-header"
      >
        <div className={professionalInspectorDensityTokens.workspaceNavigation.scroller}>
          <div
            aria-label={t('adjustments.color.workspaceTabs.label')}
            className={professionalInspectorDensityTokens.workspaceNavigation.tabList}
            data-testid="color-workspace-tabs"
            onKeyDown={handleWorkspaceTabKeyDown}
            role="tablist"
          >
            {workspaceTabs.map((tab) => {
              const isActive = activeWorkspaceTab === tab.id;

              return (
                <button
                  aria-controls={`${tablistId}-${tab.id}-panel`}
                  aria-label={tab.label}
                  aria-selected={isActive}
                  className={cx(
                    COLOR_WORKSPACE_TAB_BASE_CLASS,
                    isActive ? COLOR_WORKSPACE_TAB_ACTIVE_CLASS : COLOR_WORKSPACE_TAB_INACTIVE_CLASS,
                  )}
                  data-active={String(isActive)}
                  data-testid={`color-workspace-tab-${tab.id}`}
                  data-tooltip={tab.label}
                  id={`${tablistId}-${tab.id}-tab`}
                  key={tab.id}
                  onClick={() => {
                    selectWorkspaceTab(tab.id);
                  }}
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  title={tab.label}
                  type="button"
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {workspaceTabs.map((tab) => (
        <div
          aria-labelledby={`${tablistId}-${tab.id}-tab`}
          className="pb-0.5"
          hidden={activeWorkspaceTab !== tab.id}
          id={`${tablistId}-${tab.id}-panel`}
          key={tab.id}
          role="tabpanel"
          data-testid={`color-workspace-tab-panel-${tab.id}`}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
