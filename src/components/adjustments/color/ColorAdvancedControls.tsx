import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import type { ColorCalibration } from '../../../utils/adjustments';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import { ColorSwatch } from './ColorSwatch';
import type { ColorPanelGroupProps } from './types';

export const ColorAdvancedControls = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelGroupProps) => {
  const { t } = useTranslation();
  const [activePrimary, setActivePrimary] = useState('red');
  const colorCalibration = adjustments.colorCalibration;

  const primaryColors = useMemo(
    () => [
      { name: 'red', color: '#f87171', label: t('adjustments.color.calibration.colors.red') },
      { name: 'green', color: '#4ade80', label: t('adjustments.color.calibration.colors.green') },
      { name: 'blue', color: '#60a5fa', label: t('adjustments.color.calibration.colors.blue') },
    ],
    [t],
  );

  const handleShadowsChange = (value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      colorCalibration: {
        ...prev.colorCalibration,
        shadowsTint: value,
      },
    }));
  };

  const handlePrimaryChange = (key: 'Hue' | 'Saturation', value: number) => {
    const fullKey = `${activePrimary}${key}` as keyof ColorCalibration;
    setAdjustments((prev) => ({
      ...prev,
      colorCalibration: {
        ...prev.colorCalibration,
        [fullKey]: value,
      },
    }));
  };

  const currentValues = {
    hue: colorCalibration[`${activePrimary}Hue` as keyof ColorCalibration] || 0,
    saturation: colorCalibration[`${activePrimary}Saturation` as keyof ColorCalibration] || 0,
  };

  const trackSuffix = `${activePrimary}s`;

  return (
    <div className="p-2 bg-bg-tertiary rounded-md mt-4">
      <UiText variant={TextVariants.heading} className="mb-2">
        {t('adjustments.color.calibration.title')}
      </UiText>
      <div>
        <UiText color={TextColors.primary} weight={TextWeights.medium} className="mb-1">
          {t('adjustments.color.calibration.shadows')}
        </UiText>
        <AdjustmentSlider
          label={t('adjustments.color.calibration.tint')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={colorCalibration.shadowsTint}
          onValueChange={(value) => {
            handleShadowsChange(value);
          }}
          onDragStateChange={onDragStateChange}
          trackClassName="tint-gradient-track"
        />
      </div>
      <div className="mt-3">
        <UiText color={TextColors.primary} weight={TextWeights.medium} className="mb-3">
          {t('adjustments.color.calibration.primaries')}
        </UiText>
        <div className="flex justify-center gap-6 mb-4 px-1">
          {primaryColors.map(({ name, color, label }) => (
            <ColorSwatch
              color={color}
              isActive={activePrimary === name}
              key={name}
              name={name}
              onClick={setActivePrimary}
              ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
            />
          ))}
        </div>
        <AdjustmentSlider
          label={t('adjustments.color.calibration.hue')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={currentValues.hue}
          onValueChange={(value) => {
            handlePrimaryChange('Hue', value);
          }}
          onDragStateChange={onDragStateChange}
          trackClassName={`hue-slider-${trackSuffix}`}
        />
        <AdjustmentSlider
          label={t('adjustments.color.calibration.saturation')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={currentValues.saturation}
          onValueChange={(value) => {
            handlePrimaryChange('Saturation', value);
          }}
          onDragStateChange={onDragStateChange}
          trackClassName={`sat-slider-${trackSuffix}`}
        />
      </div>
    </div>
  );
};
