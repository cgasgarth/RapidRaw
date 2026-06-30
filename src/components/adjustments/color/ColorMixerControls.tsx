import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackWhiteMixerChannel } from '../../../schemas/color/blackWhiteMixerSchemas';
import type { ChannelMixerOutput, ChannelMixerSource } from '../../../schemas/color/channelMixerSchemas';
import type { ColorBalanceRgbChannel, ColorBalanceRgbRange } from '../../../schemas/color/colorBalanceRgbSchemas';
import { TextVariants } from '../../../types/typography';
import { type Adjustments, ColorAdjustment, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import {
  applySelectiveColorToRgbPixel,
  type RgbPixel,
  renderSelectiveColorMaskPreviewPixel,
} from '../../../utils/color/selective/selectiveColorRuntime';
import { getSelectiveColorRange, SELECTIVE_COLOR_RANGES } from '../../../utils/selectiveColorRanges';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import { ColorSwatch } from './ColorSwatch';
import type { ColorPanelGroupProps } from './types';

interface ColorProps {
  color: string;
  name: BlackWhiteMixerChannel;
  label: string;
}

type SelectiveColorPreviewMode = 'adjusted' | 'mask';

const hexColorToRgbPixel = (hexColor: string): RgbPixel => ({
  blue: Number.parseInt(hexColor.slice(5, 7), 16) / 255,
  green: Number.parseInt(hexColor.slice(3, 5), 16) / 255,
  red: Number.parseInt(hexColor.slice(1, 3), 16) / 255,
});

const rgbPixelToCssColor = ({ blue, green, red }: RgbPixel): string =>
  `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;

const formatSelectiveColorProofRgb = (pixel: RgbPixel): string =>
  [pixel.red, pixel.green, pixel.blue].map((channel) => channel.toFixed(3)).join(',');

const formatPercent = (value: number) => `${String(value)}%`;
const formatSignedInteger = (value: number) => (value > 0 ? `+${value}` : String(value));

interface ColorMixerControlsProps extends ColorPanelGroupProps {
  activeChannelMixerOutput: ChannelMixerOutput;
  activeColor: BlackWhiteMixerChannel;
  activeColorBalanceRange: ColorBalanceRgbRange;
  adjustmentVisibility: Record<string, boolean>;
  isForMask: boolean;
  setActiveChannelMixerOutput: (output: ChannelMixerOutput) => void;
  setActiveColor: (color: BlackWhiteMixerChannel) => void;
  setActiveColorBalanceRange: (range: ColorBalanceRgbRange) => void;
}

export const ColorMixerControls = ({
  activeChannelMixerOutput,
  activeColor,
  activeColorBalanceRange,
  adjustmentVisibility,
  adjustments,
  isForMask,
  onDragStateChange,
  setActiveChannelMixerOutput,
  setActiveColor,
  setActiveColorBalanceRange,
  setAdjustments,
}: ColorMixerControlsProps) => {
  const { t } = useTranslation();
  const [selectiveColorPreviewMode, setSelectiveColorPreviewMode] = useState<SelectiveColorPreviewMode>('adjusted');

  const HSL_COLORS = useMemo<Array<ColorProps>>(
    () =>
      SELECTIVE_COLOR_RANGES.map((range) => ({
        color: range.color,
        label: t(range.labelKey),
        name: range.key,
      })),
    [t],
  );

  const colorBalanceRanges = useMemo(
    () =>
      [
        { key: 'shadows', label: t('adjustments.color.colorBalanceRgb.ranges.shadows') },
        { key: 'midtones', label: t('adjustments.color.colorBalanceRgb.ranges.midtones') },
        { key: 'highlights', label: t('adjustments.color.colorBalanceRgb.ranges.highlights') },
      ] satisfies Array<{ key: ColorBalanceRgbRange; label: string }>,
    [t],
  );
  const colorBalanceChannels = useMemo(
    () =>
      [
        { key: 'red', label: t('adjustments.color.colorBalanceRgb.channels.red') },
        { key: 'green', label: t('adjustments.color.colorBalanceRgb.channels.green') },
        { key: 'blue', label: t('adjustments.color.colorBalanceRgb.channels.blue') },
      ] satisfies Array<{ key: ColorBalanceRgbChannel; label: string }>,
    [t],
  );
  const channelMixerOutputs = useMemo(
    () =>
      [
        { key: 'red', label: t('adjustments.color.channelMixer.outputs.red') },
        { key: 'green', label: t('adjustments.color.channelMixer.outputs.green') },
        { key: 'blue', label: t('adjustments.color.channelMixer.outputs.blue') },
      ] satisfies Array<{ key: ChannelMixerOutput; label: string }>,
    [t],
  );
  const channelMixerSources = useMemo(
    () =>
      [
        { key: 'red', label: t('adjustments.color.channelMixer.sources.red') },
        { key: 'green', label: t('adjustments.color.channelMixer.sources.green') },
        { key: 'blue', label: t('adjustments.color.channelMixer.sources.blue') },
        { key: 'constant', label: t('adjustments.color.channelMixer.sources.constant') },
      ] satisfies Array<{ key: ChannelMixerSource; label: string }>,
    [t],
  );

  const currentHsl = adjustments.hsl[activeColor];
  const blackWhiteMixer = adjustments.blackWhiteMixer;
  const currentBlackWhiteWeight = blackWhiteMixer.weights[activeColor];
  const colorBalanceRgb = adjustments.colorBalanceRgb;
  const activeColorBalance = colorBalanceRgb[activeColorBalanceRange];
  const channelMixer = adjustments.channelMixer;
  const activeChannelMixerRow = channelMixer[activeChannelMixerOutput];
  const activeSelectiveColorRange = getSelectiveColorRange(activeColor);
  const activeSelectiveColorRangeControl = adjustments.selectiveColorRangeControls[activeColor];
  const activeSelectiveColorSamplePixel = hexColorToRgbPixel(activeSelectiveColorRange.color);
  const activeSelectiveColorAdjustment = currentHsl;
  const activeSelectiveColorMaskPreview = renderSelectiveColorMaskPreviewPixel(
    activeSelectiveColorSamplePixel,
    activeColor,
    {
      [activeColor]: activeSelectiveColorRangeControl,
    },
  );
  const activeSelectiveColorAppliedPreview = applySelectiveColorToRgbPixel(
    activeSelectiveColorSamplePixel,
    activeColor,
    activeSelectiveColorAdjustment,
    { [activeColor]: activeSelectiveColorRangeControl },
  );
  const baseHue = activeSelectiveColorRangeControl.centerHueDegrees;
  const activeSelectiveColorRangeLabel = t(activeSelectiveColorRange.labelKey);
  const activeSelectiveColorRangeCenter = `${Math.round(activeSelectiveColorRangeControl.centerHueDegrees)}°`;
  const activeSelectiveColorRangeWidth = `${Math.round(activeSelectiveColorRangeControl.widthDegrees)}°`;
  const activeSelectiveColorRangeFalloff = activeSelectiveColorRangeControl.falloffSmoothness.toFixed(2);
  const effectiveHue = baseHue + (currentHsl.hue || 0);
  const activeSelectiveColorAdjustedHue = `${Math.round(((effectiveHue % 360) + 360) % 360)}°`;
  const activeSelectiveColorDeltaSummary = [
    `H ${formatSignedInteger(currentHsl.hue)}`,
    `S ${formatSignedInteger(currentHsl.saturation)}`,
    `L ${formatSignedInteger(currentHsl.luminance)}`,
  ].join(' / ');
  const selectiveColorPreviewSummary =
    selectiveColorPreviewMode === 'mask'
      ? t('adjustments.color.maskPreviewEnabled')
      : t('adjustments.color.adjustedPreviewEnabled');
  const isActiveSelectiveColorAdjusted =
    currentHsl.hue !== INITIAL_ADJUSTMENTS.hsl[activeColor].hue ||
    currentHsl.saturation !== INITIAL_ADJUSTMENTS.hsl[activeColor].saturation ||
    currentHsl.luminance !== INITIAL_ADJUSTMENTS.hsl[activeColor].luminance ||
    activeSelectiveColorRangeControl.centerHueDegrees !==
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor].centerHueDegrees ||
    activeSelectiveColorRangeControl.widthDegrees !==
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor].widthDegrees ||
    activeSelectiveColorRangeControl.falloffSmoothness !==
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor].falloffSmoothness;
  const hue_slider = `hue-slider-${activeColor}`;
  const saturation_slider = `sat-slider-${activeColor}`;
  const luminance_slider = `lum-slider-${activeColor}`;

  useEffect(() => {
    const normalizedHue = ((effectiveHue % 360) + 360) % 360;
    const effectiveSaturation = (currentHsl.saturation + 100) / 2;

    document.documentElement.style.setProperty(`--hsl-mixer-hue-${activeColor}`, normalizedHue.toString());
    document.documentElement.style.setProperty(`--hsl-mixer-sat-${activeColor}`, formatPercent(effectiveSaturation));
  }, [effectiveHue, currentHsl.saturation, activeColor]);

  const handleHslChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      hsl: {
        ...prev.hsl,
        [activeColor]: {
          ...prev.hsl[activeColor],
          [key]: value,
        },
      },
    }));
  };

  const resetActiveSelectiveColorRange = () => {
    setAdjustments((prev) => ({
      ...prev,
      hsl: {
        ...prev.hsl,
        [activeColor]: { ...INITIAL_ADJUSTMENTS.hsl[activeColor] },
      },
      selectiveColorRangeControls: {
        ...prev.selectiveColorRangeControls,
        [activeColor]: { ...INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor] },
      },
    }));
  };

  const handleSelectiveColorRangeControlChange = (
    key: keyof Adjustments['selectiveColorRangeControls'][BlackWhiteMixerChannel],
    value: number,
  ) => {
    setAdjustments((prev) => ({
      ...prev,
      selectiveColorRangeControls: {
        ...prev.selectiveColorRangeControls,
        [activeColor]: {
          ...prev.selectiveColorRangeControls[activeColor],
          [key]: value,
        },
      },
    }));
  };

  const toggleSelectiveColorPreviewMode = () => {
    setSelectiveColorPreviewMode((currentMode) => (currentMode === 'mask' ? 'adjusted' : 'mask'));
  };

  const handleBlackWhiteToggle = () => {
    setAdjustments((prev) => {
      const current = prev.blackWhiteMixer;
      const enabling = !current.enabled;
      const weightsHaveContribution = Object.values(current.weights).some((weight) => weight !== 0);

      return {
        ...prev,
        blackWhiteMixer: {
          ...current,
          enabled: enabling,
          weights:
            enabling && !weightsHaveContribution
              ? {
                  ...current.weights,
                  [activeColor]: 20,
                }
              : current.weights,
        },
      };
    });
  };

  const handleBlackWhiteWeightChange = (value: number) => {
    setAdjustments((prev) => {
      const current = prev.blackWhiteMixer;

      return {
        ...prev,
        blackWhiteMixer: {
          ...current,
          weights: {
            ...current.weights,
            [activeColor]: value,
          },
        },
      };
    });
  };

  const handleColorBalanceToggle = () => {
    setAdjustments((prev) => {
      const current = prev.colorBalanceRgb;

      return {
        ...prev,
        colorBalanceRgb: {
          ...current,
          enabled: !current.enabled,
        },
      };
    });
  };

  const handleColorBalancePreserveLuminance = () => {
    setAdjustments((prev) => {
      const current = prev.colorBalanceRgb;

      return {
        ...prev,
        colorBalanceRgb: {
          ...current,
          preserveLuminance: !current.preserveLuminance,
        },
      };
    });
  };

  const handleColorBalanceChange = (channel: ColorBalanceRgbChannel, value: number) => {
    setAdjustments((prev) => {
      const current = prev.colorBalanceRgb;

      return {
        ...prev,
        colorBalanceRgb: {
          ...current,
          [activeColorBalanceRange]: {
            ...current[activeColorBalanceRange],
            [channel]: value,
          },
        },
      };
    });
  };

  const handleChannelMixerToggle = () => {
    setAdjustments((prev) => {
      const current = prev.channelMixer;

      return {
        ...prev,
        channelMixer: {
          ...current,
          enabled: !current.enabled,
        },
      };
    });
  };

  const handleChannelMixerPreserveLuminance = () => {
    setAdjustments((prev) => {
      const current = prev.channelMixer;

      return {
        ...prev,
        channelMixer: {
          ...current,
          preserveLuminance: !current.preserveLuminance,
        },
      };
    });
  };

  const handleChannelMixerChange = (source: ChannelMixerSource, value: number) => {
    setAdjustments((prev) => {
      const current = prev.channelMixer;

      return {
        ...prev,
        channelMixer: {
          ...current,
          [activeChannelMixerOutput]: {
            ...current[activeChannelMixerOutput],
            [source]: value,
          },
        },
      };
    });
  };

  return (
    <>
      {!isForMask && adjustmentVisibility[ColorAdjustment.BlackWhiteMixer] !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.blackWhiteMixer.title')}</UiText>
            <button
              aria-pressed={blackWhiteMixer.enabled}
              className={`rounded px-2 py-1 text-xs font-medium ${
                blackWhiteMixer.enabled ? 'bg-accent text-button-text' : 'bg-bg-secondary text-text-secondary'
              }`}
              data-testid="black-white-mixer-toggle"
              onClick={handleBlackWhiteToggle}
              type="button"
            >
              {blackWhiteMixer.enabled
                ? t('adjustments.color.blackWhiteMixer.enabled')
                : t('adjustments.color.blackWhiteMixer.disabled')}
            </button>
          </div>
          <div className="mb-3 flex justify-between px-1">
            {HSL_COLORS.map(({ name, color, label }) => (
              <ColorSwatch
                ariaLabel={t('adjustments.color.blackWhiteMixer.ariaSelectChannel', { name: label })}
                color={color}
                isActive={activeColor === name}
                key={name}
                name={name}
                onClick={setActiveColor}
              />
            ))}
          </div>
          <AdjustmentSlider
            label={t('adjustments.color.blackWhiteMixer.contribution', {
              name: t(getSelectiveColorRange(activeColor).labelKey),
            })}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleBlackWhiteWeightChange(value);
            }}
            step={1}
            value={currentBlackWhiteWeight}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}

      {!isForMask && adjustmentVisibility[ColorAdjustment.ColorBalanceRgb] !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.colorBalanceRgb.title')}</UiText>
            <div className="flex gap-1">
              <button
                aria-pressed={colorBalanceRgb.preserveLuminance}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  colorBalanceRgb.preserveLuminance
                    ? 'bg-bg-secondary text-text-primary'
                    : 'bg-surface text-text-secondary'
                }`}
                onClick={handleColorBalancePreserveLuminance}
                type="button"
              >
                {t('adjustments.color.colorBalanceRgb.preserveLuminance')}
              </button>
              <button
                aria-pressed={colorBalanceRgb.enabled}
                data-testid="color-balance-toggle"
                className={`rounded px-2 py-1 text-xs font-medium ${
                  colorBalanceRgb.enabled ? 'bg-accent text-button-text' : 'bg-bg-secondary text-text-secondary'
                }`}
                onClick={handleColorBalanceToggle}
                type="button"
              >
                {colorBalanceRgb.enabled
                  ? t('adjustments.color.colorBalanceRgb.enabled')
                  : t('adjustments.color.colorBalanceRgb.disabled')}
              </button>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {colorBalanceRanges.map((range) => (
              <button
                aria-pressed={activeColorBalanceRange === range.key}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  activeColorBalanceRange === range.key
                    ? 'bg-accent text-button-text'
                    : 'bg-bg-secondary text-text-secondary'
                }`}
                key={range.key}
                onClick={() => {
                  setActiveColorBalanceRange(range.key);
                }}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </div>
          {colorBalanceChannels.map((channel) => (
            <AdjustmentSlider
              key={channel.key}
              label={channel.label}
              max={100}
              min={-100}
              onValueChange={(value) => {
                handleColorBalanceChange(channel.key, value);
              }}
              step={1}
              value={activeColorBalance[channel.key]}
              onDragStateChange={onDragStateChange}
            />
          ))}
        </div>
      )}

      {!isForMask && adjustmentVisibility[ColorAdjustment.ChannelMixer] !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.channelMixer.title')}</UiText>
            <div className="flex gap-1">
              <button
                aria-pressed={channelMixer.preserveLuminance}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  channelMixer.preserveLuminance
                    ? 'bg-bg-secondary text-text-primary'
                    : 'bg-surface text-text-secondary'
                }`}
                onClick={handleChannelMixerPreserveLuminance}
                type="button"
              >
                {t('adjustments.color.channelMixer.preserveLuminance')}
              </button>
              <button
                aria-pressed={channelMixer.enabled}
                data-testid="channel-mixer-toggle"
                className={`rounded px-2 py-1 text-xs font-medium ${
                  channelMixer.enabled ? 'bg-accent text-button-text' : 'bg-bg-secondary text-text-secondary'
                }`}
                onClick={handleChannelMixerToggle}
                type="button"
              >
                {channelMixer.enabled
                  ? t('adjustments.color.channelMixer.enabled')
                  : t('adjustments.color.channelMixer.disabled')}
              </button>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-1">
            {channelMixerOutputs.map((output) => (
              <button
                aria-pressed={activeChannelMixerOutput === output.key}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  activeChannelMixerOutput === output.key
                    ? 'bg-accent text-button-text'
                    : 'bg-bg-secondary text-text-secondary'
                }`}
                key={output.key}
                onClick={() => {
                  setActiveChannelMixerOutput(output.key);
                }}
                type="button"
              >
                {output.label}
              </button>
            ))}
          </div>
          {channelMixerSources.map((source) => (
            <AdjustmentSlider
              key={source.key}
              label={source.label}
              max={source.key === 'constant' ? 100 : 200}
              min={source.key === 'constant' ? -100 : -200}
              onValueChange={(value) => {
                handleChannelMixerChange(source.key, value);
              }}
              step={1}
              value={activeChannelMixerRow[source.key]}
              onDragStateChange={onDragStateChange}
            />
          ))}
        </div>
      )}

      <div
        className="p-2 bg-bg-tertiary rounded-md"
        data-active-range={activeColor}
        data-apply-output-rgb={formatSelectiveColorProofRgb(activeSelectiveColorAppliedPreview.outputRgb)}
        data-command-type="toneColor.adjustHsl"
        data-dirty={String(isActiveSelectiveColorAdjusted)}
        data-mask-preview-rgb={formatSelectiveColorProofRgb(activeSelectiveColorMaskPreview)}
        data-mask-weight={activeSelectiveColorAppliedPreview.maskWeight.toFixed(3)}
        data-preview-mode={selectiveColorPreviewMode}
        data-preview-mutates-adjustments="false"
        data-preview-source="selectiveColorRuntime.renderSelectiveColorMaskPreviewPixel"
        data-preview-to-apply-aligned={String(
          formatSelectiveColorProofRgb(activeSelectiveColorAppliedPreview.outputRgb) !==
            formatSelectiveColorProofRgb(activeSelectiveColorSamplePixel),
        )}
        data-testid="selective-color-range-controls"
      >
        <UiText variant={TextVariants.heading} className="mb-3">
          {t('adjustments.color.colorMixer')}
        </UiText>
        <div
          className="mb-3 grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-surface bg-bg-primary px-2 py-1.5 text-xs"
          data-testid="selective-color-range-summary"
        >
          <span className="truncate font-medium text-text-primary" data-testid="selective-color-range-summary-label">
            {activeSelectiveColorRangeLabel}
          </span>
          <span className="flex items-center gap-2 text-text-tertiary">
            <span>{t('adjustments.color.hue')}</span>
            <span className="tabular-nums text-text-secondary" data-testid="selective-color-range-summary-center">
              {activeSelectiveColorRangeCenter}
            </span>
            <span className="tabular-nums text-text-secondary" data-testid="selective-color-range-summary-width">
              {activeSelectiveColorRangeWidth}
            </span>
          </span>
          <span className="text-text-tertiary">{t('adjustments.color.activeRangeAdjustedHue')}</span>
          <span className="text-right tabular-nums text-text-secondary" data-testid="selective-color-adjusted-hue">
            {activeSelectiveColorAdjustedHue}
          </span>
          <span className="text-text-tertiary">{t('adjustments.color.activeRangeDeltas')}</span>
          <span className="text-right tabular-nums text-text-secondary" data-testid="selective-color-hsl-deltas">
            {activeSelectiveColorDeltaSummary}
          </span>
          <span className="text-text-tertiary">{t('adjustments.color.previewMode')}</span>
          <span className="text-right tabular-nums text-text-secondary" data-testid="selective-color-preview-mode">
            {selectiveColorPreviewSummary}
          </span>
          <span className="text-text-tertiary">{t('adjustments.color.falloffSmoothness')}</span>
          <span
            className="text-right tabular-nums text-text-secondary"
            data-testid="selective-color-range-summary-falloff"
          >
            {activeSelectiveColorRangeFalloff}
          </span>
          <button
            aria-pressed={selectiveColorPreviewMode === 'mask'}
            className={`col-span-2 inline-flex h-7 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors ${
              selectiveColorPreviewMode === 'mask'
                ? 'border-accent bg-accent/10 text-text-primary'
                : 'border-surface bg-bg-secondary text-text-secondary hover:border-accent hover:text-text-primary'
            }`}
            data-testid="selective-color-mask-preview-toggle"
            onClick={toggleSelectiveColorPreviewMode}
            type="button"
          >
            {t('adjustments.color.maskPreview')}
          </button>
          <button
            aria-label={t('adjustments.color.resetActiveRange')}
            className="col-span-2 inline-flex h-7 items-center justify-center gap-1 rounded-md border border-surface bg-bg-secondary px-2 text-xs font-medium text-text-secondary transition-colors hover:border-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="selective-color-reset-active-range"
            disabled={!isActiveSelectiveColorAdjusted}
            onClick={resetActiveSelectiveColorRange}
            type="button"
          >
            <RotateCcw size={13} />
            <span>{t('adjustments.color.resetActiveRange')}</span>
          </button>
        </div>
        <div
          className="mb-3 grid gap-2 rounded-md border border-surface bg-bg-primary p-2"
          data-testid="selective-color-range-shape-controls"
        >
          <AdjustmentSlider
            defaultValue={Math.round(activeSelectiveColorRange.centerHueDegrees)}
            label={t('adjustments.color.rangeCenter')}
            max={359}
            min={0}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              handleSelectiveColorRangeControlChange('centerHueDegrees', value);
            }}
            step={1}
            suffix="°"
            value={Math.round(activeSelectiveColorRangeControl.centerHueDegrees)}
          />
          <AdjustmentSlider
            defaultValue={Math.round(activeSelectiveColorRange.widthDegrees)}
            label={t('adjustments.color.rangeWidth')}
            max={180}
            min={10}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              handleSelectiveColorRangeControlChange('widthDegrees', value);
            }}
            step={1}
            suffix="°"
            value={Math.round(activeSelectiveColorRangeControl.widthDegrees)}
          />
          <AdjustmentSlider
            defaultValue={15}
            label={t('adjustments.color.falloffSmoothness')}
            max={40}
            min={3}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              handleSelectiveColorRangeControlChange('falloffSmoothness', value / 10);
            }}
            step={1}
            value={Math.round(activeSelectiveColorRangeControl.falloffSmoothness * 10)}
          />
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-md border border-surface bg-bg-primary p-2 text-[11px]">
          <div className="grid gap-1" data-testid="selective-color-source-swatch">
            <span className="text-text-tertiary">{activeSelectiveColorRangeLabel}</span>
            <span
              className="h-8 rounded border border-surface"
              style={{ backgroundColor: rgbPixelToCssColor(activeSelectiveColorSamplePixel) }}
            />
          </div>
          <div className="grid gap-1" data-testid="selective-color-mask-swatch">
            <span className="text-text-tertiary">{t('adjustments.color.maskPreviewEnabled')}</span>
            <span
              className="h-8 rounded border border-surface"
              style={{ backgroundColor: rgbPixelToCssColor(activeSelectiveColorMaskPreview) }}
            />
          </div>
          <div className="grid gap-1" data-testid="selective-color-apply-swatch">
            <span className="text-text-tertiary">{t('adjustments.color.adjustedPreviewEnabled')}</span>
            <span
              className="h-8 rounded border border-surface"
              style={{ backgroundColor: rgbPixelToCssColor(activeSelectiveColorAppliedPreview.outputRgb) }}
            />
          </div>
        </div>
        <div className="flex justify-between mb-4 px-1">
          {HSL_COLORS.map(({ name, color, label }) => (
            <ColorSwatch
              color={color}
              isActive={activeColor === name}
              key={name}
              name={name}
              onClick={setActiveColor}
              testId={`selective-color-range-${name}`}
              ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
            />
          ))}
        </div>
        <AdjustmentSlider
          label={t('adjustments.color.hue')}
          max={100}
          min={-100}
          onValueChange={(value) => {
            handleHslChange(ColorAdjustment.Hue, value);
          }}
          step={1}
          value={currentHsl.hue}
          trackClassName={hue_slider}
          onDragStateChange={onDragStateChange}
        />
        <AdjustmentSlider
          label={t('adjustments.color.saturation')}
          max={100}
          min={-100}
          onValueChange={(value) => {
            handleHslChange(ColorAdjustment.Saturation, value);
          }}
          step={1}
          value={currentHsl.saturation}
          trackClassName={saturation_slider}
          onDragStateChange={onDragStateChange}
        />
        <AdjustmentSlider
          label={t('adjustments.color.luminance')}
          max={100}
          min={-100}
          onValueChange={(value) => {
            handleHslChange(ColorAdjustment.Luminance, value);
          }}
          step={1}
          value={currentHsl.luminance}
          trackClassName={luminance_slider}
          onDragStateChange={onDragStateChange}
        />
      </div>
    </>
  );
};
