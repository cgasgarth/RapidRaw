import cx from 'clsx';
import { Pipette, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ColorAdjustment, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
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
  const modifiedLabel = t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' });
  const isWhiteBalanceModified =
    adjustments.temperature !== INITIAL_ADJUSTMENTS.temperature || adjustments.tint !== INITIAL_ADJUSTMENTS.tint;
  const isPresenceModified =
    adjustments.vibrance !== INITIAL_ADJUSTMENTS.vibrance ||
    adjustments.saturation !== INITIAL_ADJUSTMENTS.saturation ||
    adjustments.hue !== INITIAL_ADJUSTMENTS.hue;

  const handleGlobalChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  };

  const resetWhiteBalance = () => {
    setAdjustments((prev) => ({
      ...prev,
      temperature: INITIAL_ADJUSTMENTS.temperature,
      tint: INITIAL_ADJUSTMENTS.tint,
    }));
  };

  return (
    <div className={cx('space-y-px px-0.5', density.scrollPadding)} data-testid="quick-color-controls">
      <section
        className="border-b border-editor-border pb-1.5"
        data-testid="color-quick-white-balance"
        data-white-balance-state={isWhiteBalanceModified ? 'custom' : isForMask ? 'default' : 'as-shot'}
      >
        <CompactInspectorSectionHeader
          actions={
            <div className="flex items-center gap-0.5">
              <button
                aria-label={
                  isForMask
                    ? t('adjustments.color.resetLocalColorBalance')
                    : t('adjustments.color.resetWhiteBalanceAsShot')
                }
                className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
                data-testid="color-white-balance-as-shot"
                data-tooltip={
                  isForMask
                    ? t('adjustments.color.resetLocalColorBalance')
                    : t('adjustments.color.resetWhiteBalanceAsShot')
                }
                disabled={!isWhiteBalanceModified}
                onClick={resetWhiteBalance}
                type="button"
              >
                <RotateCcw size={13} />
              </button>
              {!isForMask && toggleWbPicker ? (
                <button
                  aria-label={
                    isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
                  }
                  aria-pressed={isWbPickerActive}
                  className={cx(
                    density.actionButton.base,
                    density.actionButton.icon,
                    'border border-transparent data-[state=active]:border-accent',
                    isWgpuEnabled
                      ? 'cursor-not-allowed text-text-secondary hover:bg-transparent'
                      : isWbPickerActive
                        ? density.actionButton.active
                        : density.actionButton.quiet,
                  )}
                  data-state={isWbPickerActive ? 'active' : isWgpuEnabled ? 'disabled' : 'idle'}
                  data-testid="color-white-balance-picker"
                  data-tooltip={
                    isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
                  }
                  disabled={isWgpuEnabled}
                  onClick={toggleWbPicker}
                  type="button"
                >
                  <Pipette size={14} />
                </button>
              ) : null}
            </div>
          }
          modified={isWhiteBalanceModified}
          modifiedLabel={modifiedLabel}
          summary={
            <span data-testid="color-quick-white-balance-summary">
              {isWhiteBalanceModified
                ? `${adjustments.temperature || 0} / ${adjustments.tint || 0}`
                : isForMask
                  ? t('adjustments.color.defaultState')
                  : t('adjustments.color.asShot')}
            </span>
          }
          title={isForMask ? t('adjustments.color.localColorBalance') : t('adjustments.color.whiteBalance')}
        />
        <AdjustmentSlider
          defaultValue={0}
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
          defaultValue={0}
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
      </section>

      <section className="border-b border-editor-border pb-1.5 pt-0.5" data-testid="color-quick-presence">
        <CompactInspectorSectionHeader
          modified={isPresenceModified}
          modifiedLabel={modifiedLabel}
          summary={
            <span data-testid="color-quick-presence-summary">
              {adjustments.vibrance || 0} / {adjustments.saturation || 0}
            </span>
          }
          title={isForMask ? t('adjustments.color.localColor') : t('adjustments.color.globalColor')}
        />
        <AdjustmentSlider
          defaultValue={0}
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
          defaultValue={0}
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
        {!isForMask ? (
          <AdjustmentSlider
            defaultValue={0}
            density="compact"
            label={t('adjustments.color.hue')}
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
        ) : null}
      </section>
    </div>
  );
};
