import cx from 'clsx';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackWhiteMixerChannel } from '../../schemas/color/blackWhiteMixerSchemas';
import type { ChannelMixerOutput } from '../../schemas/color/channelMixerSchemas';
import type { ColorBalanceRgbRange } from '../../schemas/color/colorBalanceRgbSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { type Adjustments, ColorAdjustment } from '../../utils/adjustments';
import {
  formatGamutWarningCoverage,
  isCurrentExportSoftProofGamutWarningOverlay,
  resolveGamutWarningProofDimensions,
} from '../../utils/color/runtime/gamutWarningDisplay';
import { applySkinToneUniformity, type SkinToneUniformityInput } from '../../utils/skinToneUniformity';
import type { AppSettings } from '../ui/AppProperties';
import { ColorAdvancedControls } from './color/ColorAdvancedControls';
import { ColorGradingControls } from './color/ColorGradingControls';
import { ColorMixerControls } from './color/ColorMixerControls';
import { ColorProfileToneControls, getProfileToneLabels } from './color/ColorProfileToneControls';
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

const skinToneInspectorSample: SkinToneUniformityInput = {
  hueDegrees: 18,
  luminance: 0.5,
  saturation: 0.45,
};

const COLOR_WORKSPACE_TAB_IDS = ['quick', 'editor', 'grading', 'output', 'advanced'] as const;
type ColorWorkspaceTabId = (typeof COLOR_WORKSPACE_TAB_IDS)[number];

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

  return tabs[nextIndex]?.id ?? tabs[0]?.id ?? 'quick';
};

const skinToneTargetDistance = (
  input: SkinToneUniformityInput,
  settings: Pick<Adjustments['skinToneUniformity'], 'targetHueDegrees' | 'targetLuminance' | 'targetSaturation'>,
): number => {
  const hueDelta = Math.abs((((settings.targetHueDegrees - input.hueDegrees + 540) % 360) - 180) / 180);
  return (
    hueDelta +
    Math.abs(settings.targetLuminance - input.luminance) +
    Math.abs(settings.targetSaturation - input.saturation)
  );
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
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<ColorWorkspaceTabId>('quick');
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
  const setEditor = useEditorStore((state) => state.setEditor);
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const isColorCalibrationVisible = (adjustmentVisibility as { colorCalibration?: boolean }).colorCalibration !== false;
  const isLevelsVisible = adjustmentVisibility[ColorAdjustment.Levels] !== false;
  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;
  const activeExportPresetName = appSettings?.exportPresets?.[0]?.name ?? null;
  const isCurrentGamutWarningOverlay = isCurrentExportSoftProofGamutWarningOverlay(gamutWarningOverlay, {
    exportSoftProofRecipeId,
    exportSoftProofTransform,
    isExportSoftProofEnabled,
    selectedImagePath,
  });
  const currentGamutWarningOverlay = isCurrentGamutWarningOverlay ? gamutWarningOverlay : null;
  const proofDimensions = resolveGamutWarningProofDimensions(gamutWarningOverlay, selectedImage);
  const gamutWarningCoverage = formatGamutWarningCoverage(currentGamutWarningOverlay);
  const levels = adjustments.levels;
  const levelsClippingWarnings = [
    levels.inputBlack > 0 ? t('adjustments.color.levels.warnings.shadowClipping') : null,
    levels.inputWhite < 1 ? t('adjustments.color.levels.warnings.highlightClipping') : null,
    levels.outputBlack > 0 || levels.outputWhite < 1 ? t('adjustments.color.levels.warnings.outputCompression') : null,
  ].filter((warning): warning is string => warning !== null);
  const colorWorkspaceWarningChips = [
    gamutWarningOverlay !== null ? t('adjustments.color.gamutWarning.coverage', { value: gamutWarningCoverage }) : null,
    ...levelsClippingWarnings,
    adjustments.skinToneUniformity.enabled ? t('adjustments.color.skinToneUniformity.warning') : null,
  ].filter((warning): warning is string => warning !== null);
  const skinTonePreview = skinTonePreviewHsl(adjustments.skinToneUniformity);
  const skinToneInspectorOutput = applySkinToneUniformity(skinToneInspectorSample, adjustments.skinToneUniformity);
  const skinToneInspectorBeforeDistance = skinToneTargetDistance(
    skinToneInspectorSample,
    adjustments.skinToneUniformity,
  );
  const skinToneInspectorAfterDistance = skinToneTargetDistance(
    skinToneInspectorOutput,
    adjustments.skinToneUniformity,
  );
  const skinToneInspectorImprovement = skinToneInspectorBeforeDistance - skinToneInspectorAfterDistance;
  const { activeCameraProfileLabel, activeToneCurveLabel } = getProfileToneLabels(adjustments, t);

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
        id: 'quick',
        label: t('adjustments.color.workspaceTabs.quick'),
        panel: (
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
        ),
      },
      {
        id: 'editor',
        label: t('adjustments.color.workspaceTabs.editor'),
        panel: (
          <div className="space-y-4">
            {!isForMask && (
              <ColorProfileToneControls
                adjustmentVisibility={adjustmentVisibility}
                adjustments={adjustments}
                appSettings={appSettings}
                onDragStateChange={onDragStateChange}
                setActiveChannelMixerOutput={setActiveChannelMixerOutput}
                setActiveColor={setActiveColor}
                setActiveColorBalanceRange={setActiveColorBalanceRange}
                setAdjustments={setAdjustments}
              />
            )}
            <ColorMixerControls
              activeChannelMixerOutput={activeChannelMixerOutput}
              activeColor={activeColor}
              activeColorBalanceRange={activeColorBalanceRange}
              adjustmentVisibility={adjustmentVisibility}
              adjustments={adjustments}
              appSettings={appSettings}
              isForMask={isForMask}
              onDragStateChange={onDragStateChange}
              setActiveChannelMixerOutput={setActiveChannelMixerOutput}
              setActiveColor={setActiveColor}
              setActiveColorBalanceRange={setActiveColorBalanceRange}
              setAdjustments={setAdjustments}
            />
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
            activeCameraProfileLabel={activeCameraProfileLabel}
            activeExportPresetName={activeExportPresetName}
            activeToneCurveLabel={activeToneCurveLabel}
            adjustments={adjustments}
            appSettings={appSettings}
            colorWorkspaceWarningChips={colorWorkspaceWarningChips}
            currentGamutWarningOverlay={currentGamutWarningOverlay}
            gamutWarningCoverage={gamutWarningCoverage}
            isGamutWarningOverlayVisible={isGamutWarningOverlayVisible}
            onDragStateChange={onDragStateChange}
            proofDimensions={proofDimensions}
            setAdjustments={setAdjustments}
            setEditor={setEditor}
            skinToneInspectorAfterDistance={skinToneInspectorAfterDistance}
            skinToneInspectorBeforeDistance={skinToneInspectorBeforeDistance}
            skinToneInspectorImprovement={skinToneInspectorImprovement}
            skinToneInspectorOutputHue={skinToneInspectorOutput.hueDegrees}
            skinTonePreview={skinTonePreview}
            syncSkinToneUniformity={syncSkinToneUniformity}
          />
        ),
      });
    }

    if (!isForMask && (isLevelsVisible || isColorCalibrationVisible)) {
      tabs.push({
        id: 'advanced',
        label: t('adjustments.color.workspaceTabs.advanced'),
        panel: (
          <ColorAdvancedControls
            adjustmentVisibility={adjustmentVisibility}
            adjustments={adjustments}
            appSettings={appSettings}
            isColorCalibrationVisible={isColorCalibrationVisible}
            levelsClippingWarnings={levelsClippingWarnings}
            onDragStateChange={onDragStateChange}
            setAdjustments={setAdjustments}
          />
        ),
      });
    }

    return tabs;
  }, [
    activeCameraProfileLabel,
    activeChannelMixerOutput,
    activeColor,
    activeColorBalanceRange,
    activeExportPresetName,
    activeToneCurveLabel,
    adjustmentVisibility,
    adjustments,
    appSettings,
    colorWorkspaceWarningChips,
    currentGamutWarningOverlay,
    gamutWarningCoverage,
    isColorCalibrationVisible,
    isForMask,
    isGamutWarningOverlayVisible,
    isLevelsVisible,
    isWbPickerActive,
    isWgpuEnabled,
    levelsClippingWarnings,
    onDragStateChange,
    proofDimensions,
    setAdjustments,
    setEditor,
    skinToneInspectorAfterDistance,
    skinToneInspectorBeforeDistance,
    skinToneInspectorImprovement,
    skinToneInspectorOutput.hueDegrees,
    skinTonePreview,
    syncSkinToneUniformity,
    t,
    toggleWbPicker,
  ]);

  useEffect(() => {
    if (!workspaceTabs.some((tab) => tab.id === activeWorkspaceTab)) {
      setActiveWorkspaceTab(workspaceTabs[0]?.id ?? 'quick');
    }
  }, [activeWorkspaceTab, workspaceTabs]);

  const focusColorWorkspaceTab = (tabId: ColorWorkspaceTabId) => {
    requestAnimationFrame(() => {
      document.getElementById(`${tablistId}-${tabId}-tab`)?.focus();
    });
  };

  const handleWorkspaceTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextTabId = getNextColorWorkspaceTabId(workspaceTabs, activeWorkspaceTab, 1);

      setActiveWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextTabId = getNextColorWorkspaceTabId(workspaceTabs, activeWorkspaceTab, -1);

      setActiveWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      const nextTabId = workspaceTabs[0]?.id ?? 'quick';

      setActiveWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const nextTabId = workspaceTabs.at(-1)?.id ?? 'quick';

      setActiveWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
    }
  };

  return (
    <div className="space-y-3">
      <div
        aria-label={t('adjustments.color.workspaceTabs.label')}
        className="flex gap-1 overflow-x-auto rounded-md border border-surface bg-bg-tertiary p-1"
        data-testid="color-workspace-tabs"
        onKeyDown={handleWorkspaceTabKeyDown}
        role="tablist"
      >
        {workspaceTabs.map((tab) => {
          const isActive = activeWorkspaceTab === tab.id;

          return (
            <button
              aria-controls={`${tablistId}-${tab.id}-panel`}
              aria-selected={isActive}
              className={cx(
                'min-h-7 shrink-0 rounded px-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isActive
                  ? 'bg-accent text-button-text shadow-sm'
                  : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary',
              )}
              data-testid={`color-workspace-tab-${tab.id}`}
              id={`${tablistId}-${tab.id}-tab`}
              key={tab.id}
              onClick={() => {
                setActiveWorkspaceTab(tab.id);
              }}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {workspaceTabs.map((tab) => (
        <div
          aria-labelledby={`${tablistId}-${tab.id}-tab`}
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
