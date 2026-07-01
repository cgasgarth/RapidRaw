import cx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { type Adjustments, ColorAdjustment, type ColorCalibration } from '../../../utils/adjustments';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import { ColorSwatch } from './ColorSwatch';
import type { ColorPanelGroupProps } from './types';

type LevelsNumericKey = Exclude<keyof Adjustments['levels'], 'enabled'>;

interface ColorAdvancedControlsProps extends ColorPanelGroupProps {
  adjustmentVisibility: Record<string, boolean>;
  isColorCalibrationVisible: boolean;
  levelsClippingWarnings: Array<string>;
}

export const ColorAdvancedControls = ({
  adjustmentVisibility,
  adjustments,
  isColorCalibrationVisible,
  levelsClippingWarnings,
  setAdjustments,
  onDragStateChange,
}: ColorAdvancedControlsProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const [activePrimary, setActivePrimary] = useState('red');
  const colorCalibration = adjustments.colorCalibration;
  const levels = adjustments.levels;
  const isLevelsVisible = adjustmentVisibility[ColorAdjustment.Levels] !== false;
  const inputBlackMax = Math.max(0, Math.min(99, Math.round(levels.inputWhite * 100) - 1));
  const inputWhiteMin = Math.min(100, Math.max(1, Math.round(levels.inputBlack * 100) + 1));
  const outputBlackMax = Math.max(0, Math.min(99, Math.round(levels.outputWhite * 100) - 1));
  const outputWhiteMin = Math.min(100, Math.max(1, Math.round(levels.outputBlack * 100) + 1));

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

  const handleLevelsToggle = () => {
    setAdjustments((prev) => ({
      ...prev,
      levels: {
        ...prev.levels,
        enabled: !prev.levels.enabled,
      },
    }));
  };

  const handleLevelsChange = (key: LevelsNumericKey, value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      levels: {
        ...prev.levels,
        [key]: value,
      },
    }));
  };

  const currentValues = {
    hue: colorCalibration[`${activePrimary}Hue` as keyof ColorCalibration] || 0,
    saturation: colorCalibration[`${activePrimary}Saturation` as keyof ColorCalibration] || 0,
  };

  const trackSuffix = `${activePrimary}s`;

  return (
    <details className={density.card.nestedPanel} data-testid="advanced-color-disclosure">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-1 py-1 text-xs">
        <span className="min-w-0">
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.color.advanced.title')}
          </UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className={density.sectionHeader.summary}>
            {t('adjustments.color.advanced.summary')}
          </UiText>
        </span>
        <span className={density.sectionHeader.badge}>{t('adjustments.color.collapsed')}</span>
      </summary>
      <div className={cx(density.gutter.panel, 'border-t border-border p-1.5')} data-testid="advanced-color-controls">
        {isLevelsVisible && (
          <div className={density.card.panel} data-testid="color-levels-controls">
            <div className={density.sectionHeader.root}>
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.color.levels.title')}
              </UiText>
              <button
                className={cx(
                  density.actionButton.base,
                  levels.enabled ? density.actionButton.active : density.actionButton.inactive,
                )}
                onClick={handleLevelsToggle}
                type="button"
              >
                {levels.enabled ? t('adjustments.color.levels.enabled') : t('adjustments.color.levels.disabled')}
              </button>
            </div>
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.levels.inputBlack')}
              max={inputBlackMax}
              min={0}
              onValueChange={(value) => {
                handleLevelsChange('inputBlack', value / 100);
              }}
              step={1}
              value={Math.round(levels.inputBlack * 100)}
              onDragStateChange={onDragStateChange}
            />
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.levels.inputWhite')}
              max={100}
              min={inputWhiteMin}
              onValueChange={(value) => {
                handleLevelsChange('inputWhite', value / 100);
              }}
              step={1}
              value={Math.round(levels.inputWhite * 100)}
              onDragStateChange={onDragStateChange}
            />
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.levels.gamma')}
              max={300}
              min={25}
              onValueChange={(value) => {
                handleLevelsChange('gamma', value / 100);
              }}
              step={1}
              value={Math.round(levels.gamma * 100)}
              onDragStateChange={onDragStateChange}
            />
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.levels.outputBlack')}
              max={outputBlackMax}
              min={0}
              onValueChange={(value) => {
                handleLevelsChange('outputBlack', value / 100);
              }}
              step={1}
              value={Math.round(levels.outputBlack * 100)}
              onDragStateChange={onDragStateChange}
            />
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.levels.outputWhite')}
              max={100}
              min={outputWhiteMin}
              onValueChange={(value) => {
                handleLevelsChange('outputWhite', value / 100);
              }}
              step={1}
              value={Math.round(levels.outputWhite * 100)}
              onDragStateChange={onDragStateChange}
            />
            {levelsClippingWarnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {levelsClippingWarnings.map((warning) => (
                  <UiText key={warning} variant={TextVariants.small} color={TextColors.secondary} className="block">
                    {warning}
                  </UiText>
                ))}
              </div>
            )}
          </div>
        )}
        {isColorCalibrationVisible && (
          <div className={density.card.panel} data-testid="color-calibration-controls">
            <UiText variant={TextVariants.heading} className={cx(density.sectionHeader.title, 'mb-2 block')}>
              {t('adjustments.color.calibration.title')}
            </UiText>
            <div>
              <UiText color={TextColors.primary} weight={TextWeights.medium} className="mb-1 text-[12px] leading-4">
                {t('adjustments.color.calibration.shadows')}
              </UiText>
              <AdjustmentSlider
                density="compact"
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
            <div className="mt-2">
              <UiText color={TextColors.primary} weight={TextWeights.medium} className="mb-2 text-[12px] leading-4">
                {t('adjustments.color.calibration.primaries')}
              </UiText>
              <div className="mb-2 flex justify-center gap-5 px-1">
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
                density="compact"
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
                density="compact"
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
        )}
      </div>
    </details>
  );
};
