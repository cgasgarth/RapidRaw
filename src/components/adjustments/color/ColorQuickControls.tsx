import { Pipette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../../types/typography';
import { ColorAdjustment } from '../../../utils/adjustments';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import type { ColorPanelGroupProps } from './types';

interface ColorQuickControlsProps extends ColorPanelGroupProps {
  isForMask: boolean;
  isWbPickerActive: boolean;
  isWgpuEnabled: boolean;
  toggleWbPicker?: () => void;
}

export const ColorQuickControls = ({
  adjustments,
  isForMask,
  isWbPickerActive,
  isWgpuEnabled,
  onDragStateChange,
  setAdjustments,
  toggleWbPicker,
}: ColorQuickControlsProps) => {
  const { t } = useTranslation();

  const handleGlobalChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <>
      <div className="p-2 bg-bg-tertiary rounded-md">
        <div className="flex justify-between items-center mb-2">
          <UiText variant={TextVariants.heading}>{t('adjustments.color.whiteBalance')}</UiText>
          {!isForMask && toggleWbPicker && (
            <button
              onClick={toggleWbPicker}
              disabled={isWgpuEnabled}
              className={`p-1.5 rounded-md transition-colors ${
                isWgpuEnabled
                  ? 'cursor-not-allowed text-text-secondary hover:bg-transparent'
                  : isWbPickerActive
                    ? 'bg-accent text-button-text'
                    : 'hover:bg-bg-secondary text-text-secondary'
              }`}
              data-tooltip={
                isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
              }
              type="button"
            >
              <Pipette size={16} />
            </button>
          )}
        </div>
        <AdjustmentSlider
          label={t('adjustments.color.temperature')}
          max={100}
          min={-100}
          onValueChange={(value) => {
            handleGlobalChange(ColorAdjustment.Temperature, value);
          }}
          step={1}
          value={adjustments.temperature || 0}
          trackClassName="temperature-gradient-track"
          onDragStateChange={onDragStateChange}
        />
        <AdjustmentSlider
          label={t('adjustments.color.tint')}
          max={100}
          min={-100}
          onValueChange={(value) => {
            handleGlobalChange(ColorAdjustment.Tint, value);
          }}
          step={1}
          value={adjustments.tint || 0}
          trackClassName="tint-gradient-track"
          onDragStateChange={onDragStateChange}
        />
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <UiText variant={TextVariants.heading} className="mb-2">
          {t('adjustments.color.presence')}
        </UiText>
        <AdjustmentSlider
          label={t('adjustments.color.vibrance')}
          max={100}
          min={-100}
          onValueChange={(value) => {
            handleGlobalChange(ColorAdjustment.Vibrance, value);
          }}
          step={1}
          value={adjustments.vibrance || 0}
          onDragStateChange={onDragStateChange}
        />
        <AdjustmentSlider
          label={t('adjustments.color.saturation')}
          max={100}
          min={-100}
          onValueChange={(value) => {
            handleGlobalChange(ColorAdjustment.Saturation, value);
          }}
          step={1}
          value={adjustments.saturation || 0}
          onDragStateChange={onDragStateChange}
        />
        <AdjustmentSlider
          label={isForMask ? t('adjustments.color.localHue') : t('adjustments.color.hue')}
          max={180}
          min={-180}
          onValueChange={(value) => {
            handleGlobalChange(ColorAdjustment.Hue, value);
          }}
          step={1}
          value={adjustments.hue || 0}
          trackClassName="hue-range-track"
          onDragStateChange={onDragStateChange}
        />
      </div>
    </>
  );
};
