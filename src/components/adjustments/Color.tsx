import cx from 'clsx';
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackWhiteMixerChannel, BlackWhiteMixerSettings } from '../../schemas/color/blackWhiteMixerSchemas';
import type { ChannelMixerOutput, ChannelMixerSettings } from '../../schemas/color/channelMixerSchemas';
import type { ColorBalanceRgbRange } from '../../schemas/color/colorBalanceRgbSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { ColorAdjustment } from '../../utils/adjustments';
import {
  type BlackWhiteMixerCommitIdentity,
  buildBlackWhiteMixerEditTransaction,
} from '../../utils/blackWhiteMixerEditTransaction';
import {
  buildChannelMixerEditTransaction,
  type ChannelMixerCommitIdentity,
} from '../../utils/channelMixerEditTransaction';
import {
  getRenderedPreviewWarningStatus,
  isCurrentExportSoftProofGamutWarningOverlay,
} from '../../utils/color/runtime/gamutWarningDisplay';
import {
  buildColorBalanceRgbEditTransaction,
  type ColorBalanceRgbCommitIdentity,
} from '../../utils/colorBalanceRgbEditTransaction';
import { COLOR_OUTPUT_FOCUS_EVENT, COLOR_WORKSPACE_TAB_SESSION_KEY } from '../../utils/colorWorkspaceNavigation';
import { selectEditDocumentMasks, selectEditDocumentNode } from '../../utils/editDocumentSelectors';
import {
  applyColorRangeLocalAdjustmentLayerFlow,
  buildColorRangeProposalSourcePixels,
  createColorRangeLocalAdjustmentLayerDraft,
} from '../../utils/layers/colorRangeLocalAdjustmentCommandFlow';
import { buildLayerEditTransactionRequest } from '../../utils/layers/layerEditTransaction';
import { persistLayerStackSidecarInEditDocumentCandidate } from '../../utils/layers/layerStackSidecarAdjustments';
import { createColorRangeMaskParameters } from '../../utils/mask/colorRangeMaskParameters';
import {
  buildSelectiveColorEditTransaction,
  type SelectiveColorCommitIdentity,
  type SelectiveColorMixerSettings,
} from '../../utils/selectiveColorEditTransaction';
import { getSelectiveColorRange } from '../../utils/selectiveColorRanges';
import {
  buildSkinToneUniformityEditTransaction,
  type SkinToneUniformityCommitIdentity,
} from '../../utils/skinToneUniformityEditTransaction';
import type { AppSettings } from '../ui/AppProperties';
import { professionalInspectorDensityTokens } from '../ui/inspectorTokens';
import { ColorAdvancedControls } from './color/ColorAdvancedControls';
import { ColorGradingControls } from './color/ColorGradingControls';
import { ColorMixerControls } from './color/ColorMixerControls';
import { ColorProfileToneControls } from './color/ColorProfileToneControls';
import { ColorProofingDiagnostics } from './color/ColorProofingDiagnostics';
import { ColorQuickControls } from './color/ColorQuickControls';
import { PointColorControls } from './color/PointColorControls';
import type { AdjustmentUpdate, ColorPanelAdjustmentView } from './color/types';

interface ColorPanelProps {
  adjustments: ColorPanelAdjustmentView;
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

const resolveSelectiveColorAdjustments = (
  adjustments: ColorPanelAdjustmentView,
  authoritativeHsl: ColorPanelAdjustmentView['hsl'],
  authoritativeSelectiveColorRangeControls: ColorPanelAdjustmentView['selectiveColorRangeControls'],
  isForMask: boolean,
  selectedImagePath: string | null,
): ColorPanelAdjustmentView =>
  isForMask || selectedImagePath === null
    ? adjustments
    : {
        ...adjustments,
        hsl: authoritativeHsl,
        selectiveColorRangeControls: authoritativeSelectiveColorRangeControls,
      };

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
  // Keep a session preference even while a context temporarily hides that tab.
  // The effective tab is derived below, so unavailable preferences never render.
  const [requestedWorkspaceTab, setRequestedWorkspaceTab] = useState<ColorWorkspaceTabId>(readSessionColorWorkspaceTab);
  const [activeColor, setActiveColor] = useState<BlackWhiteMixerChannel>('reds');
  const [activeColorBalanceRange, setActiveColorBalanceRange] = useState<ColorBalanceRgbRange>('midtones');
  const [activeChannelMixerOutput, setActiveChannelMixerOutput] = useState<ChannelMixerOutput>('red');
  const gamutWarningOverlay = useEditorStore((state) => state.gamutWarningOverlay);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const exportSoftProofRecipeId = useEditorStore((state) => state.exportSoftProofRecipeId);
  const exportSoftProofTransform = useEditorStore((state) => state.exportSoftProofTransform);
  const isExportSoftProofEnabled = useEditorStore((state) => state.isExportSoftProofEnabled);
  const isGamutWarningOverlayVisible = useEditorStore((state) => state.isGamutWarningOverlayVisible);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const setEditor = useEditorStore((state) => state.setEditor);
  const authoritativeHsl = useEditorStore(
    (state) => selectEditDocumentNode(state.editDocumentV2, 'selective_color_mixer').params['hsl'],
  );
  const authoritativeSelectiveColorRangeControls = useEditorStore(
    (state) =>
      selectEditDocumentNode(state.editDocumentV2, 'selective_color_mixer').params['selectiveColorRangeControls'],
  );
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const isColorCalibrationVisible = (adjustmentVisibility as { colorCalibration?: boolean }).colorCalibration !== false;
  const isLevelsVisible = adjustmentVisibility[ColorAdjustment.Levels] !== false;
  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;
  const blackWhiteMixerCommitIdentity = useMemo<BlackWhiteMixerCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const blackWhiteMixerCommitIdentityRef = useRef(blackWhiteMixerCommitIdentity);
  blackWhiteMixerCommitIdentityRef.current = blackWhiteMixerCommitIdentity;
  const blackWhiteMixerRef = useRef(adjustments.blackWhiteMixer);
  blackWhiteMixerRef.current = adjustments.blackWhiteMixer;
  const commitBlackWhiteMixer = useCallback(
    (update: (current: BlackWhiteMixerSettings) => BlackWhiteMixerSettings) => {
      const next = update(blackWhiteMixerRef.current);
      const identity = blackWhiteMixerCommitIdentityRef.current;
      if (isForMask || identity === null) {
        blackWhiteMixerRef.current = next;
        setAdjustments((previous) => ({ ...previous, blackWhiteMixer: next }));
        return;
      }
      const result = applyEditTransaction(
        buildBlackWhiteMixerEditTransaction(useEditorStore.getState(), identity, next, crypto.randomUUID()),
      );
      blackWhiteMixerRef.current = next;
      blackWhiteMixerCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
    },
    [applyEditTransaction, isForMask, setAdjustments],
  );
  const channelMixerCommitIdentity = useMemo<ChannelMixerCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const channelMixerCommitIdentityRef = useRef(channelMixerCommitIdentity);
  channelMixerCommitIdentityRef.current = channelMixerCommitIdentity;
  const channelMixerRef = useRef(adjustments.channelMixer);
  channelMixerRef.current = adjustments.channelMixer;
  const commitChannelMixer = useCallback(
    (update: (current: ChannelMixerSettings) => ChannelMixerSettings) => {
      const next = update(channelMixerRef.current);
      const identity = channelMixerCommitIdentityRef.current;
      if (isForMask || identity === null) {
        channelMixerRef.current = next;
        setAdjustments((previous) => ({ ...previous, channelMixer: next }));
        return;
      }
      const result = applyEditTransaction(
        buildChannelMixerEditTransaction(useEditorStore.getState(), identity, next, crypto.randomUUID()),
      );
      channelMixerRef.current = next;
      channelMixerCommitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
    },
    [applyEditTransaction, isForMask, setAdjustments],
  );
  const colorBalanceRgbCommitIdentity = useMemo<ColorBalanceRgbCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const colorBalanceRgbCommitIdentityRef = useRef(colorBalanceRgbCommitIdentity);
  colorBalanceRgbCommitIdentityRef.current = colorBalanceRgbCommitIdentity;
  const colorBalanceRgbRef = useRef(adjustments.colorBalanceRgb);
  colorBalanceRgbRef.current = adjustments.colorBalanceRgb;
  const commitColorBalanceRgb = useCallback(
    (update: (current: ColorPanelAdjustmentView['colorBalanceRgb']) => ColorPanelAdjustmentView['colorBalanceRgb']) => {
      const next = update(colorBalanceRgbRef.current);
      const identity = colorBalanceRgbCommitIdentityRef.current;
      if (isForMask) {
        colorBalanceRgbRef.current = next;
        setAdjustments((previous) => ({ ...previous, colorBalanceRgb: next }));
        return;
      }
      if (identity === null) return;

      const result = applyEditTransaction(
        buildColorBalanceRgbEditTransaction(useEditorStore.getState(), identity, next, crypto.randomUUID()),
      );
      colorBalanceRgbRef.current = next;
      colorBalanceRgbCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
    },
    [applyEditTransaction, isForMask, setAdjustments],
  );
  const selectiveColorCommitIdentity = useMemo<SelectiveColorCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const selectiveColorCommitIdentityRef = useRef(selectiveColorCommitIdentity);
  selectiveColorCommitIdentityRef.current = selectiveColorCommitIdentity;
  const selectiveColorAdjustments = useMemo(
    () =>
      resolveSelectiveColorAdjustments(
        adjustments,
        authoritativeHsl,
        authoritativeSelectiveColorRangeControls,
        isForMask,
        selectedImagePath,
      ),
    [adjustments, authoritativeHsl, authoritativeSelectiveColorRangeControls, isForMask, selectedImagePath],
  );
  const selectiveColorMixerRef = useRef<SelectiveColorMixerSettings>({
    hsl: selectiveColorAdjustments.hsl,
    selectiveColorRangeControls: selectiveColorAdjustments.selectiveColorRangeControls,
  });
  selectiveColorMixerRef.current = {
    hsl: selectiveColorAdjustments.hsl,
    selectiveColorRangeControls: selectiveColorAdjustments.selectiveColorRangeControls,
  };
  const commitSelectiveColorMixer = useCallback(
    (update: (current: SelectiveColorMixerSettings) => SelectiveColorMixerSettings) => {
      const next = update(selectiveColorMixerRef.current);
      const identity = selectiveColorCommitIdentityRef.current;
      if (isForMask) {
        selectiveColorMixerRef.current = next;
        setAdjustments((previous) => ({
          ...previous,
          hsl: next.hsl,
          selectiveColorRangeControls: next.selectiveColorRangeControls,
        }));
        return;
      }
      if (identity === null) return;

      const result = applyEditTransaction(
        buildSelectiveColorEditTransaction(useEditorStore.getState(), identity, next, crypto.randomUUID()),
      );
      selectiveColorMixerRef.current = next;
      selectiveColorCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
    },
    [applyEditTransaction, isForMask, setAdjustments],
  );
  const skinToneUniformityCommitIdentity = useMemo<SkinToneUniformityCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const skinToneUniformityCommitIdentityRef = useRef(skinToneUniformityCommitIdentity);
  skinToneUniformityCommitIdentityRef.current = skinToneUniformityCommitIdentity;
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
    const currentState = useEditorStore.getState();
    const currentImage = currentState.selectedImage;
    if (isForMask || currentImage === null) return;

    const rangeControl = selectEditDocumentNode(currentState.editDocumentV2, 'selective_color_mixer').params
      .selectiveColorRangeControls[activeColor];
    const currentHsl = selectEditDocumentNode(currentState.editDocumentV2, 'selective_color_mixer').params['hsl'][
      activeColor
    ];
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
    const result = applyColorRangeLocalAdjustmentLayerFlow(selectEditDocumentMasks(currentState.editDocumentV2), {
      colorRangeParameters,
      context: {
        graphRevision: `history_${currentState.historyIndex}`,
        imagePath: currentImage.path,
        operationId,
        sessionId: 'rapidraw-color-workspace',
      },
      imageSize: { height: 8, width: 8 },
      layer,
      maskName: layer.subMasks[0]?.name ?? `${rangeLabel} range mask`,
      sourceRgbPixels: buildColorRangeProposalSourcePixels(activeColor),
      toneColor,
    });
    const nextAdjustments = persistLayerStackSidecarInEditDocumentCandidate(
      currentState.editDocumentV2,
      result.masks,
      result.toneResult.sidecar,
    );
    const transaction = buildLayerEditTransactionRequest(currentState, nextAdjustments, operationId);
    const committed = applyEditTransaction(transaction);
    if (committed.noOp) return;

    setEditor({
      activeMaskContainerId: layerId,
      activeMaskId: maskId,
    });
  };

  const syncSkinToneUniformity = useCallback(
    (nextSettings: ColorPanelAdjustmentView['skinToneUniformity']) => {
      const identity = skinToneUniformityCommitIdentityRef.current;
      if (isForMask) {
        setAdjustments((previous) => ({ ...previous, skinToneUniformity: nextSettings }));
        return;
      }
      if (identity === null) return;
      const result = applyEditTransaction(
        buildSkinToneUniformityEditTransaction(useEditorStore.getState(), identity, nextSettings, crypto.randomUUID()),
      );
      skinToneUniformityCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
    },
    [applyEditTransaction, isForMask, setAdjustments],
  );

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
              inputSemantics={
                selectedImage?.rawDevelopmentReport ? 'raw_scene_linear' : 'rendered_scene_linear_approximation'
              }
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
            <PointColorControls
              adjustments={adjustments}
              appSettings={appSettings}
              isForMask={isForMask}
              onDragStateChange={onDragStateChange}
              setAdjustments={setAdjustments}
            />
            <ColorMixerControls
              activeChannelMixerOutput={activeChannelMixerOutput}
              activeColor={activeColor}
              activeColorBalanceRange={activeColorBalanceRange}
              adjustmentVisibility={adjustmentVisibility}
              adjustments={selectiveColorAdjustments}
              blackWhiteMixerCommitIdentity={blackWhiteMixerCommitIdentity}
              channelMixerCommitIdentity={channelMixerCommitIdentity}
              canCreateLocalAdjustmentFromActiveRange={!isForMask && selectedImage !== null}
              appSettings={appSettings}
              isForMask={isForMask}
              commitBlackWhiteMixer={commitBlackWhiteMixer}
              commitChannelMixer={commitChannelMixer}
              commitColorBalanceRgb={commitColorBalanceRgb}
              commitSelectiveColorMixer={commitSelectiveColorMixer}
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
            isForMask={isForMask}
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
    blackWhiteMixerCommitIdentity,
    channelMixerCommitIdentity,
    commitBlackWhiteMixer,
    commitChannelMixer,
    commitColorBalanceRgb,
    commitSelectiveColorMixer,
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
    selectiveColorAdjustments,
    setAdjustments,
    setEditor,
    syncSkinToneUniformity,
    t,
    toggleWbPicker,
  ]);
  const effectiveWorkspaceTab = workspaceTabs.some((tab) => tab.id === requestedWorkspaceTab)
    ? requestedWorkspaceTab
    : (workspaceTabs[0]?.id ?? 'foundation');

  const selectWorkspaceTab = useCallback((tabId: ColorWorkspaceTabId) => {
    setRequestedWorkspaceTab(tabId);
    rememberSessionColorWorkspaceTab(tabId);
  }, []);

  useEffect(() => {
    const focusOutputControls = () => {
      const outputExists = workspaceTabs.some((tab) => tab.id === 'output');
      const nextTabId: ColorWorkspaceTabId = outputExists ? 'output' : (workspaceTabs[0]?.id ?? 'foundation');
      selectWorkspaceTab(nextTabId);
      requestAnimationFrame(() => {
        document.getElementById(`${tablistId}-${nextTabId}-tab`)?.focus();
      });
    };

    window.addEventListener(COLOR_OUTPUT_FOCUS_EVENT, focusOutputControls);
    return () => window.removeEventListener(COLOR_OUTPUT_FOCUS_EVENT, focusOutputControls);
  }, [selectWorkspaceTab, tablistId, workspaceTabs]);

  const focusColorWorkspaceTab = (tabId: ColorWorkspaceTabId) => {
    requestAnimationFrame(() => {
      document.getElementById(`${tablistId}-${tabId}-tab`)?.focus();
    });
  };

  const handleWorkspaceTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextTabId = getNextColorWorkspaceTabId(workspaceTabs, effectiveWorkspaceTab, 1);

      selectWorkspaceTab(nextTabId);
      focusColorWorkspaceTab(nextTabId);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextTabId = getNextColorWorkspaceTabId(workspaceTabs, effectiveWorkspaceTab, -1);

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
              const isActive = effectiveWorkspaceTab === tab.id;

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
          hidden={effectiveWorkspaceTab !== tab.id}
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
