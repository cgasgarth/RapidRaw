import cx from 'clsx';
import { ChartArea, Palette, RotateCcw } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import {
  ADJUSTMENT_SECTIONS,
  type Adjustments,
  hasAdjustmentValueChanges,
  INITIAL_ADJUSTMENTS,
  pickAdjustmentValues,
} from '../../../../utils/adjustments';
import ColorPanel from '../../../adjustments/Color';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import InspectorPanelFrame, {
  type InspectorPanelNotice,
  type InspectorPanelStatus,
} from '../inspector/InspectorPanelFrame';
import PanelScopesStrip from '../inspector/PanelScopesStrip';

const PANEL_ACTION_ICON_SIZE = 15;

export default function ColorWorkspacePanel() {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const { setAdjustments } = useEditorActions();
  const { onToggleWaveform } = useWaveformControls();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const colorLabel = t('editor.adjustments.sections.color', { defaultValue: 'Color' });
  const resetColorLabel = t('editor.adjustments.actions.resetSectionSettings', {
    defaultValue: 'Reset Color settings',
    section: colorLabel,
  });
  const { adjustments, isWaveformVisible, isWbPickerActive, selectedImage, setEditor } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      isWaveformVisible: state.isWaveformVisible,
      isWbPickerActive: state.isWbPickerActive,
      selectedImage: state.selectedImage,
      setEditor: state.setEditor,
    })),
  );
  const panelStatus: InspectorPanelStatus | undefined = hasAdjustmentValueChanges(
    ADJUSTMENT_SECTIONS.color,
    adjustments,
  )
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

  const handleResetColor = useCallback(() => {
    const resetValues = pickAdjustmentValues(ADJUSTMENT_SECTIONS.color, INITIAL_ADJUSTMENTS);

    setAdjustments((prev: Adjustments) => ({
      ...prev,
      ...resetValues,
      sectionVisibility: {
        ...prev.sectionVisibility,
        color: true,
      },
    }));
  }, [setAdjustments]);

  return (
    <InspectorPanelFrame
      actions={
        <>
          <button
            aria-label={t('editor.adjustments.tooltips.toggleAnalytics')}
            aria-pressed={isWaveformVisible}
            className={cx(density.frame.actionButton, isWaveformVisible ? density.frame.actionButtonActive : undefined)}
            data-state={isWaveformVisible ? 'open' : 'closed'}
            data-testid="color-workspace-scopes-toggle"
            data-tooltip={t('editor.adjustments.tooltips.toggleAnalytics')}
            onClick={onToggleWaveform}
            type="button"
          >
            <ChartArea size={PANEL_ACTION_ICON_SIZE} />
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
      <PanelScopesStrip testId="color-workspace-scopes-strip" />

      <div className="grow overflow-y-auto bg-editor-panel px-2.5 py-1" data-testid="color-workspace-scroll-root">
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
