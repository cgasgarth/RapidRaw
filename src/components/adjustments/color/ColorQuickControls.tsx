import cx from 'clsx';
import { Pipette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../../types/typography';
import { ColorAdjustment } from '../../../utils/adjustments';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
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
  const density = professionalInspectorDensityTokens;

  const handleGlobalChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className={cx(density.gutter.panel, density.scrollPadding)} data-testid="quick-color-controls">
      <div className={density.card.panel} data-testid="color-quick-white-balance">
        <div className={cx(density.sectionHeader.root, 'mb-1')}>
          <div className="min-w-0">
            <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
              {t('adjustments.color.whiteBalance')}
            </UiText>
            <span className={density.sectionHeader.summary}>
              {t('adjustments.color.temperature')} {adjustments.temperature || 0} / {t('adjustments.color.tint')}{' '}
              {adjustments.tint || 0}
            </span>
          </div>
          {!isForMask && toggleWbPicker && (
            <button
              onClick={toggleWbPicker}
              disabled={isWgpuEnabled}
              className={cx(
                density.actionButton.base,
                density.actionButton.icon,
                isWgpuEnabled
                  ? 'cursor-not-allowed text-text-secondary hover:bg-transparent'
                  : isWbPickerActive
                    ? density.actionButton.active
                    : density.actionButton.quiet,
              )}
              data-tooltip={
                isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
              }
              type="button"
            >
              <Pipette size={14} />
            </button>
          )}
        </div>
        <AdjustmentSlider
          density="compact"
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
          density="compact"
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

      <div className={density.card.panel} data-testid="color-quick-presence">
        <div className={cx(density.sectionHeader.root, 'mb-1')}>
          <div className="min-w-0">
            <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
              {t('adjustments.color.presence')}
            </UiText>
            <span className={density.sectionHeader.summary}>
              {t('adjustments.color.vibrance')} {adjustments.vibrance || 0} / {t('adjustments.color.saturation')}{' '}
              {adjustments.saturation || 0}
            </span>
          </div>
        </div>
        <AdjustmentSlider
          density="compact"
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
          density="compact"
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
          density="compact"
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
    </div>
  );
};
