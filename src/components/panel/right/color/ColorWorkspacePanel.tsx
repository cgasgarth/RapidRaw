import cx from 'clsx';
import { RotateCcw } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { TextVariants } from '../../../../types/typography';
import {
  ADJUSTMENT_SECTIONS,
  type Adjustments,
  INITIAL_ADJUSTMENTS,
  pickAdjustmentValues,
} from '../../../../utils/adjustments';
import ColorPanel from '../../../adjustments/Color';
import UiText from '../../../ui/primitives/Text';

const PANEL_ACTION_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PANEL_ACTION_ICON_SIZE = 15;

export default function ColorWorkspacePanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const colorLabel = t('editor.adjustments.sections.color', { defaultValue: 'Color' });
  const resetColorLabel = t('editor.adjustments.actions.resetSectionSettings', {
    defaultValue: 'Reset Color settings',
    section: colorLabel,
  });
  const { adjustments, isWbPickerActive, selectedImage, setEditor } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      isWbPickerActive: state.isWbPickerActive,
      selectedImage: state.selectedImage,
      setEditor: state.setEditor,
    })),
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
    <div aria-label={colorLabel} className="flex h-full flex-col" data-testid="color-workspace-panel">
      <div className="flex min-h-11 shrink-0 items-center justify-between border-b border-surface px-3 py-2">
        <UiText as="h2" variant={TextVariants.heading} className="truncate">
          {colorLabel}
        </UiText>
        <button
          aria-label={resetColorLabel}
          className={cx(PANEL_ACTION_BUTTON_CLASS, 'hover:bg-surface')}
          disabled={!selectedImage}
          onClick={handleResetColor}
          data-tooltip={resetColorLabel}
          type="button"
        >
          <RotateCcw size={PANEL_ACTION_ICON_SIZE} />
        </button>
      </div>

      <div className="grow overflow-y-auto px-3 py-2">
        <ColorPanel
          adjustments={adjustments}
          appSettings={appSettings}
          isWbPickerActive={isWbPickerActive}
          onDragStateChange={onDragStateChange}
          setAdjustments={setAdjustments}
          toggleWbPicker={toggleWbPicker}
        />
      </div>
    </div>
  );
}
