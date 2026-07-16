import { Eye, EyeOff, Palette, RotateCcw } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { getEditDocumentNodeTypesForEditorSection } from '../../../../../packages/rawengine-schema/src/editDocumentV2';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
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
import InspectorAnalyticsHeader from '../inspector/InspectorAnalyticsHeader';
import InspectorPanelFrame, {
  type InspectorPanelNotice,
  type InspectorPanelStatus,
} from '../inspector/InspectorPanelFrame';

const PANEL_ACTION_ICON_SIZE = 15;

export default function ColorWorkspacePanel() {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const { setAdjustments, setEditorSectionEnabled } = useEditorActions();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const colorLabel = t('editor.adjustments.sections.color', { defaultValue: 'Color' });
  const resetColorLabel = t('editor.adjustments.actions.resetSectionSettings', {
    defaultValue: 'Reset Color settings',
    section: colorLabel,
  });
  const { adjustments, editDocumentV2, isWbPickerActive, selectedImage, setEditor } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustmentSnapshot.value,
      editDocumentV2: state.editDocumentV2,
      isWbPickerActive: state.isWbPickerActive,
      selectedImage: state.selectedImage,
      setEditor: state.setEditor,
    })),
  );
  const isColorEnabled = getEditDocumentNodeTypesForEditorSection('color').every(
    (nodeType) => editDocumentV2.nodes[nodeType]?.enabled !== false,
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
    }));
  }, [setAdjustments]);

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
      <InspectorAnalyticsHeader testId="color-analytics-header" />

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
