import { Eye, EyeOff, Palette, RotateCcw } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import {
  type EditDocumentV2,
  getEditDocumentNodeDescriptor,
  getEditDocumentNodeTypesForEditorSection,
} from '../../../../../packages/rawengine-schema/src/editDocumentV2';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { selectEditDocumentNode } from '../../../../utils/editDocumentSelectors';
import { resetEditDocumentV2Node } from '../../../../utils/editDocumentV2';
import type { EditNodeOperation } from '../../../../utils/editTransaction';
import ColorPanel from '../../../adjustments/Color';
import type { AdjustmentUpdate, ColorPanelAdjustmentView } from '../../../adjustments/color/types';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import InspectorAnalyticsHeader from '../inspector/InspectorAnalyticsHeader';
import InspectorPanelFrame, {
  type InspectorPanelNotice,
  type InspectorPanelStatus,
} from '../inspector/InspectorPanelFrame';

const PANEL_ACTION_ICON_SIZE = 15;

const selectColorPanelAdjustmentSources = (document: EditDocumentV2) => ({
  blackWhiteMixer: selectEditDocumentNode(document, 'black_white_mixer').params,
  cameraInput: selectEditDocumentNode(document, 'camera_input').params,
  channelMixer: selectEditDocumentNode(document, 'channel_mixer').params,
  colorBalanceRgb: selectEditDocumentNode(document, 'color_balance_rgb').params,
  colorCalibration: selectEditDocumentNode(document, 'color_calibration').params,
  colorPresence: selectEditDocumentNode(document, 'color_presence').params,
  lumaLevels: selectEditDocumentNode(document, 'luma_levels').params,
  perceptualGrading: selectEditDocumentNode(document, 'perceptual_grading').params,
  pointColor: selectEditDocumentNode(document, 'point_color').params,
  sceneCurve: selectEditDocumentNode(document, 'scene_curve').params,
  selectiveColorMixer: selectEditDocumentNode(document, 'selective_color_mixer').params,
  skinToneUniformity: selectEditDocumentNode(document, 'skin_tone_uniformity').params,
});

type ColorPanelAdjustmentSources = ReturnType<typeof selectColorPanelAdjustmentSources>;

const mergeColorPanelAdjustmentSources = (sources: ColorPanelAdjustmentSources): ColorPanelAdjustmentView => ({
  ...sources.blackWhiteMixer,
  ...sources.cameraInput,
  ...sources.channelMixer,
  ...sources.colorBalanceRgb,
  ...sources.colorCalibration,
  ...sources.colorPresence,
  ...sources.lumaLevels,
  ...sources.perceptualGrading,
  ...sources.pointColor,
  ...sources.sceneCurve,
  ...sources.selectiveColorMixer,
  ...sources.skinToneUniformity,
});

const equalColorPanelAdjustmentSources = (
  left: ColorPanelAdjustmentSources,
  right: ColorPanelAdjustmentSources,
): boolean =>
  left.blackWhiteMixer === right.blackWhiteMixer &&
  left.cameraInput === right.cameraInput &&
  left.channelMixer === right.channelMixer &&
  left.colorBalanceRgb === right.colorBalanceRgb &&
  left.colorCalibration === right.colorCalibration &&
  left.colorPresence === right.colorPresence &&
  left.lumaLevels === right.lumaLevels &&
  left.perceptualGrading === right.perceptualGrading &&
  left.pointColor === right.pointColor &&
  left.sceneCurve === right.sceneCurve &&
  left.selectiveColorMixer === right.selectiveColorMixer &&
  left.skinToneUniformity === right.skinToneUniformity;

export const selectColorPanelAdjustmentView = (document: EditDocumentV2): ColorPanelAdjustmentView =>
  mergeColorPanelAdjustmentSources(selectColorPanelAdjustmentSources(document));

/** Cache the merged view by node identity so unrelated document edits do not publish a new panel snapshot. */
export const createColorPanelAdjustmentViewSelector = () => {
  let previousSources: ColorPanelAdjustmentSources | undefined;
  let previousView: ColorPanelAdjustmentView | undefined;

  return (state: { editDocumentV2: EditDocumentV2 }): ColorPanelAdjustmentView => {
    const sources = selectColorPanelAdjustmentSources(state.editDocumentV2);
    if (previousSources && previousView && equalColorPanelAdjustmentSources(previousSources, sources)) {
      return previousView;
    }
    previousSources = sources;
    previousView = mergeColorPanelAdjustmentSources(sources);
    return previousView;
  };
};

export const useColorPanelAdjustmentView = (): ColorPanelAdjustmentView => {
  const selector = useMemo(createColorPanelAdjustmentViewSelector, []);
  return useEditorStore(selector);
};

const changed = (left: unknown, right: unknown): boolean => JSON.stringify(left) !== JSON.stringify(right);

export const buildColorPanelOperations = (
  current: ColorPanelAdjustmentView,
  next: ColorPanelAdjustmentView,
): readonly EditNodeOperation[] => [
  ...(changed(current.whiteBalanceTechnical, next.whiteBalanceTechnical) ||
  changed(current.cameraProfile, next.cameraProfile) ||
  changed(current.cameraProfileAmount, next.cameraProfileAmount)
    ? [
        {
          nodeType: 'camera_input' as const,
          patch: {
            cameraProfile: next.cameraProfile,
            cameraProfileAmount: next.cameraProfileAmount,
            whiteBalanceTechnical: next.whiteBalanceTechnical,
          },
          type: 'patch-edit-document-node' as const,
        },
      ]
    : []),
  ...(
    [
      ['black_white_mixer', ['blackWhiteMixer']],
      ['channel_mixer', ['channelMixer']],
      ['color_balance_rgb', ['colorBalanceRgb']],
      ['color_calibration', ['colorCalibration']],
      ['color_presence', ['hue', 'saturation', 'vibrance']],
      ['luma_levels', ['levels']],
      ['perceptual_grading', ['colorGrading', 'perceptualGradingV1']],
      ['point_color', ['pointColor']],
      ['scene_curve', ['curveMode', 'curves', 'parametricCurve', 'pointCurves', 'toneCurve']],
      ['selective_color_mixer', ['hsl', 'selectiveColorRangeControls']],
      ['skin_tone_uniformity', ['skinToneUniformity']],
    ] as const
  ).flatMap(([nodeType, keys]) => {
    const patch = Object.fromEntries(keys.map((key) => [key, next[key]]));
    return keys.some((key) => changed(current[key], next[key]))
      ? [{ nodeType, patch, type: 'patch-edit-document-node' as const } as EditNodeOperation]
      : [];
  }),
];

interface ColorWorkspacePanelProps {
  embeddedHeader?: boolean;
}

export default function ColorWorkspacePanel({ embeddedHeader = false }: ColorWorkspacePanelProps = {}) {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const { commitEditNodeOperations, setEditorSectionEnabled } = useEditorActions();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const colorLabel = t('editor.adjustments.sections.color', { defaultValue: 'Color' });
  const resetColorLabel = t('editor.adjustments.actions.resetSectionSettings', {
    defaultValue: 'Reset Color settings',
    section: colorLabel,
  });
  const adjustments = useColorPanelAdjustmentView();
  const { isColorEnabled, isWbPickerActive, selectedImage, setEditor } = useEditorStore(
    useShallow((state) => ({
      isColorEnabled: getEditDocumentNodeTypesForEditorSection('color').every(
        (nodeType) => state.editDocumentV2.nodes[nodeType]?.enabled !== false,
      ),
      isWbPickerActive: state.isWbPickerActive,
      selectedImage: state.selectedImage,
      setEditor: state.setEditor,
    })),
  );
  const isColorEdited = getEditDocumentNodeTypesForEditorSection('color').some((nodeType) => {
    const document = useEditorStore.getState().editDocumentV2;
    return changed(document.nodes[nodeType]?.params, getEditDocumentNodeDescriptor(nodeType)?.defaultParams);
  });
  const panelStatus: InspectorPanelStatus | undefined = isColorEdited
    ? {
        label: t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' }),
        tone: 'info',
      }
    : undefined;
  const panelNotice: InspectorPanelNotice | undefined =
    selectedImage === null
      ? {
          kind: 'empty',
          label: t('editor.ai.noImageSelected', { defaultValue: 'No image selected.' }),
        }
      : !selectedImage.isReady
        ? {
            kind: 'loading',
            label: t('editor.adjustments.status.loadingImage', { defaultValue: 'Loading image preview' }),
          }
        : undefined;

  const toggleWbPicker = useCallback(() => {
    setEditor((state) => ({ isWbPickerActive: !state.isWbPickerActive }));
  }, [setEditor]);

  const onDragStateChange = useCallback(
    (isDragging: boolean) => {
      setEditor({ isSliderDragging: isDragging });
    },
    [setEditor],
  );

  const setAdjustments = useCallback(
    (update: AdjustmentUpdate) => {
      const current = selectColorPanelAdjustmentView(useEditorStore.getState().editDocumentV2);
      const next = typeof update === 'function' ? update(current) : { ...current, ...update };
      const operations = buildColorPanelOperations(current, next);
      if (operations.length > 0) commitEditNodeOperations(operations);
    },
    [commitEditNodeOperations],
  );

  const handleResetColor = useCallback(() => {
    let document = useEditorStore.getState().editDocumentV2;
    for (const nodeType of getEditDocumentNodeTypesForEditorSection('color')) {
      document = resetEditDocumentV2Node(document, nodeType);
    }
    commitEditNodeOperations([{ editDocumentV2: document, type: 'replace-edit-document' }]);
  }, [commitEditNodeOperations]);

  return (
    <InspectorPanelFrame
      actions={
        <>
          <button
            aria-label={
              isColorEnabled ? t('ui.collapsibleSection.disableSection') : t('ui.collapsibleSection.enableSection')
            }
            aria-pressed={!isColorEnabled}
            className={density.frame.actionButton}
            data-testid="color-workspace-enable-toggle"
            data-tooltip={
              isColorEnabled ? t('ui.collapsibleSection.disableSection') : t('ui.collapsibleSection.enableSection')
            }
            onClick={() => {
              setEditorSectionEnabled('color', !isColorEnabled);
            }}
            type="button"
          >
            {isColorEnabled ? <Eye size={PANEL_ACTION_ICON_SIZE} /> : <EyeOff size={PANEL_ACTION_ICON_SIZE} />}
          </button>
          <button
            aria-label={resetColorLabel}
            className={density.frame.actionButton}
            disabled={!selectedImage}
            onClick={handleResetColor}
            data-tooltip={resetColorLabel}
            type="button"
          >
            <RotateCcw size={PANEL_ACTION_ICON_SIZE} />
          </button>
        </>
      }
      icon={Palette}
      label={colorLabel}
      notice={panelNotice}
      status={panelStatus}
      testId="color-workspace-panel"
    >
      {!embeddedHeader && <InspectorAnalyticsHeader includeDevelopToolStrip testId="color-analytics-header" />}
      <div
        className="grow overflow-y-auto bg-editor-panel px-2.5 py-1"
        data-right-panel-scroll-root="true"
        data-testid="color-workspace-scroll-root"
      >
        <ColorPanel
          adjustments={adjustments}
          appSettings={appSettings}
          isWbPickerActive={isWbPickerActive}
          onDragStateChange={onDragStateChange}
          setAdjustments={setAdjustments}
          toggleWbPicker={toggleWbPicker}
        />
      </div>
    </InspectorPanelFrame>
  );
}
