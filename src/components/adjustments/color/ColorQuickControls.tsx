import cx from 'clsx';
import { Pipette, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ColorAdjustment, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import {
  buildTechnicalWhiteBalance,
  buildTechnicalWhiteBalancePreset,
  WHITE_BALANCE_PRESETS,
  type WhiteBalanceMode,
} from '../../../utils/color/whiteBalance';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import AdjustmentSlider from '../AdjustmentSlider';
import type { ColorPanelGroupProps } from './types';

interface ColorQuickControlsProps extends ColorPanelGroupProps {
  isForMask: boolean;
  isWbPickerActive: boolean;
  isWgpuEnabled: boolean;
  inputSemantics: 'raw_scene_linear' | 'rendered_scene_linear_approximation';
  toggleWbPicker?: () => void;
}

export const ColorQuickControls = ({
  adjustments,
  isForMask,
  isWbPickerActive,
  isWgpuEnabled,
  inputSemantics,
  onDragStateChange,
  setAdjustments,
  toggleWbPicker,
}: ColorQuickControlsProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const modifiedLabel = t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' });
  const isWhiteBalanceModified = isForMask
    ? adjustments.temperature !== INITIAL_ADJUSTMENTS.temperature || adjustments.tint !== INITIAL_ADJUSTMENTS.tint
    : adjustments.whiteBalanceTechnical.mode !== 'as_shot' ||
      adjustments.creativeTemperature !== INITIAL_ADJUSTMENTS.creativeTemperature ||
      adjustments.creativeTint !== INITIAL_ADJUSTMENTS.creativeTint;
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
      ...(isForMask
        ? { temperature: INITIAL_ADJUSTMENTS.temperature, tint: INITIAL_ADJUSTMENTS.tint }
        : {
            whiteBalanceTechnical: {
              ...structuredClone(INITIAL_ADJUSTMENTS.whiteBalanceTechnical),
              inputSemantics,
            },
            creativeTemperature: INITIAL_ADJUSTMENTS.creativeTemperature,
            creativeTint: INITIAL_ADJUSTMENTS.creativeTint,
            whiteBalanceMigration: 'native_v1' as const,
          }),
    }));
  };

  const updateTechnicalWhiteBalance = (mode: WhiteBalanceMode, kelvin: number, duv: number) => {
    setAdjustments((previous) => ({
      ...previous,
      whiteBalanceTechnical: buildTechnicalWhiteBalance(
        mode,
        kelvin,
        duv,
        mode === 'preset' ? 'preset' : mode === 'auto' ? 'auto' : mode === 'as_shot' ? 'as_shot' : 'user',
        inputSemantics,
      ),
      whiteBalanceMigration: 'native_v1',
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
                ? isForMask
                  ? `${adjustments.temperature || 0} / ${adjustments.tint || 0}`
                  : `${adjustments.whiteBalanceTechnical.mode === 'as_shot' ? t('adjustments.color.asShot') : `${Math.round(adjustments.whiteBalanceTechnical.kelvin)} K`} · ${adjustments.whiteBalanceTechnical.duv.toFixed(3)}`
                : isForMask
                  ? t('adjustments.color.defaultState')
                  : t('adjustments.color.asShot')}
            </span>
          }
          title={isForMask ? t('adjustments.color.localColorBalance') : t('adjustments.color.whiteBalance')}
        />
        {isForMask ? (
          <>
            <AdjustmentSlider
              defaultValue={0}
              density="compact"
              label={t('adjustments.color.creativeWarmth', { defaultValue: 'Creative Warmth' })}
              max={100}
              min={-100}
              onValueChange={(value) => handleGlobalChange(ColorAdjustment.Temperature, value)}
              step={1}
              value={adjustments.temperature || 0}
              trackClassName="temperature-gradient-track"
              onDragStateChange={onDragStateChange}
            />
            <AdjustmentSlider
              defaultValue={0}
              density="compact"
              label={t('adjustments.color.creativeTint', { defaultValue: 'Creative Tint' })}
              max={100}
              min={-100}
              onValueChange={(value) => handleGlobalChange(ColorAdjustment.Tint, value)}
              step={1}
              value={adjustments.tint || 0}
              trackClassName="tint-gradient-track"
              onDragStateChange={onDragStateChange}
            />
          </>
        ) : (
          <>
            <label className="flex items-center justify-between gap-2 py-1 text-xs text-text-secondary">
              <span>{t('adjustments.color.illuminantMode', { defaultValue: 'Illuminant' })}</span>
              <select
                className="h-6 rounded border border-editor-border bg-editor-panel px-1.5 text-xs text-text-primary"
                data-testid="color-white-balance-mode"
                onChange={(event) =>
                  updateTechnicalWhiteBalance(
                    event.target.value as WhiteBalanceMode,
                    adjustments.whiteBalanceTechnical.kelvin,
                    adjustments.whiteBalanceTechnical.duv,
                  )
                }
                value={adjustments.whiteBalanceTechnical.mode}
              >
                <option value="as_shot">{t('adjustments.color.asShot')}</option>
                <option value="auto">{t('adjustments.color.auto', { defaultValue: 'Auto' })}</option>
                <option value="kelvin_tint">
                  {t('adjustments.color.kelvinTint', { defaultValue: 'Kelvin + Tint' })}
                </option>
                <option value="preset">{t('adjustments.color.preset', { defaultValue: 'Preset' })}</option>
              </select>
            </label>
            {adjustments.whiteBalanceTechnical.mode !== 'as_shot' &&
            adjustments.whiteBalanceTechnical.mode !== 'auto' ? (
              <>
                {adjustments.whiteBalanceTechnical.mode === 'preset' ? (
                  <label className="flex items-center justify-between gap-2 py-1 text-xs text-text-secondary">
                    <span>{t('adjustments.color.preset', { defaultValue: 'Preset' })}</span>
                    <select
                      aria-label={t('adjustments.color.preset', { defaultValue: 'Preset' })}
                      className="h-6 rounded border border-editor-border bg-editor-panel px-1.5 text-xs text-text-primary"
                      data-testid="color-white-balance-preset"
                      onChange={(event) =>
                        setAdjustments((previous) => ({
                          ...previous,
                          whiteBalanceTechnical: buildTechnicalWhiteBalancePreset(
                            event.target.value as (typeof WHITE_BALANCE_PRESETS)[number]['id'],
                            previous.whiteBalanceTechnical.synchronization,
                            inputSemantics,
                          ),
                          whiteBalanceMigration: 'native_v1',
                        }))
                      }
                      value={adjustments.whiteBalanceTechnical.presetId ?? 'daylight'}
                    >
                      {WHITE_BALANCE_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="flex items-center justify-between gap-2 py-1 text-xs text-text-secondary">
                  <span>{t('adjustments.color.kelvin', { defaultValue: 'Kelvin' })}</span>
                  <input
                    aria-label={t('adjustments.color.kelvin', { defaultValue: 'Kelvin' })}
                    className="h-6 w-24 rounded border border-editor-border bg-editor-panel px-1.5 text-right text-xs text-text-primary"
                    data-testid="color-white-balance-kelvin"
                    max={25000}
                    min={1667}
                    onChange={(event) =>
                      updateTechnicalWhiteBalance(
                        adjustments.whiteBalanceTechnical.mode,
                        Number(event.target.value),
                        adjustments.whiteBalanceTechnical.duv,
                      )
                    }
                    step={10}
                    type="number"
                    value={adjustments.whiteBalanceTechnical.kelvin}
                  />
                </label>
                <AdjustmentSlider
                  defaultValue={0}
                  density="compact"
                  label={t('adjustments.color.duv', { defaultValue: 'Tint (Duv)' })}
                  max={0.05}
                  min={-0.05}
                  onValueChange={(value) =>
                    updateTechnicalWhiteBalance(
                      adjustments.whiteBalanceTechnical.mode,
                      adjustments.whiteBalanceTechnical.kelvin,
                      value,
                    )
                  }
                  step={0.001}
                  value={adjustments.whiteBalanceTechnical.duv}
                  trackClassName="tint-gradient-track"
                  onDragStateChange={onDragStateChange}
                />
              </>
            ) : null}
            {inputSemantics === 'rendered_scene_linear_approximation' ? (
              <p
                className="py-0.5 text-[10px] leading-tight text-text-secondary"
                data-testid="color-white-balance-rendered-limit"
              >
                {t('adjustments.color.renderedWhiteBalanceLimit', {
                  defaultValue: 'Relative adaptation; rendered files cannot recover the original camera white balance.',
                })}
              </p>
            ) : null}
            <AdjustmentSlider
              defaultValue={0}
              density="compact"
              label={t('adjustments.color.creativeWarmth', { defaultValue: 'Creative Warmth' })}
              max={100}
              min={-100}
              onValueChange={(value) => setAdjustments((previous) => ({ ...previous, creativeTemperature: value }))}
              step={1}
              value={adjustments.creativeTemperature}
              trackClassName="temperature-gradient-track"
              onDragStateChange={onDragStateChange}
            />
            <AdjustmentSlider
              defaultValue={0}
              density="compact"
              label={t('adjustments.color.creativeTint', { defaultValue: 'Creative Tint' })}
              max={100}
              min={-100}
              onValueChange={(value) => setAdjustments((previous) => ({ ...previous, creativeTint: value }))}
              step={1}
              value={adjustments.creativeTint}
              trackClassName="tint-gradient-track"
              onDragStateChange={onDragStateChange}
            />
          </>
        )}
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
