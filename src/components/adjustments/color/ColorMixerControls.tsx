import cx from 'clsx';
import { Layers, RotateCcw } from 'lucide-react';
import { type MouseEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackWhiteMixerChannel } from '../../../schemas/color/blackWhiteMixerSchemas';
import type { ChannelMixerOutput, ChannelMixerSource } from '../../../schemas/color/channelMixerSchemas';
import type { ColorBalanceRgbChannel, ColorBalanceRgbRange } from '../../../schemas/color/colorBalanceRgbSchemas';
import { TextVariants } from '../../../types/typography';
import { type Adjustments, ColorAdjustment, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import { getSelectiveColorRange, SELECTIVE_COLOR_RANGES } from '../../../utils/selectiveColorRanges';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import { ColorSwatch } from './ColorSwatch';
import type { ColorPanelGroupProps } from './types';

interface ColorOption {
  color: string;
  label: string;
  name: BlackWhiteMixerChannel;
}

interface ColorMixerControlsProps extends ColorPanelGroupProps {
  activeChannelMixerOutput: ChannelMixerOutput;
  activeColor: BlackWhiteMixerChannel;
  activeColorBalanceRange: ColorBalanceRgbRange;
  adjustmentVisibility: Record<string, boolean>;
  canCreateLocalAdjustmentFromActiveRange?: boolean;
  isForMask: boolean;
  onCreateLocalAdjustmentFromActiveRange?: () => void;
  setActiveChannelMixerOutput: (output: ChannelMixerOutput) => void;
  setActiveColor: (color: BlackWhiteMixerChannel) => void;
  setActiveColorBalanceRange: (range: ColorBalanceRgbRange) => void;
}

interface DisclosureToggleProps {
  isOn: boolean;
  offLabel: string;
  onClick: () => void;
  onLabel: string;
  testId?: string;
}

const formatSignedInteger = (value: number) => (value > 0 ? `+${value}` : String(value));

const DisclosureToggle = ({ isOn, offLabel, onClick, onLabel, testId }: DisclosureToggleProps) => {
  const preventDisclosureToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
    event.currentTarget.closest('details')?.setAttribute('open', '');
  };

  return (
    <button
      aria-pressed={isOn}
      className={cx(
        professionalInspectorDensityTokens.actionButton.base,
        isOn
          ? professionalInspectorDensityTokens.actionButton.active
          : professionalInspectorDensityTokens.actionButton.inactive,
      )}
      {...(testId ? { 'data-testid': testId } : {})}
      onClick={preventDisclosureToggle}
      type="button"
    >
      {isOn ? onLabel : offLabel}
    </button>
  );
};

export const ColorMixerControls = ({
  activeChannelMixerOutput,
  activeColor,
  activeColorBalanceRange,
  adjustmentVisibility,
  adjustments,
  canCreateLocalAdjustmentFromActiveRange = false,
  isForMask,
  onCreateLocalAdjustmentFromActiveRange,
  onDragStateChange,
  setActiveChannelMixerOutput,
  setActiveColor,
  setActiveColorBalanceRange,
  setAdjustments,
}: ColorMixerControlsProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const hslColors = useMemo<Array<ColorOption>>(
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
  const activeRange = getSelectiveColorRange(activeColor);
  const activeRangeControls = adjustments.selectiveColorRangeControls[activeColor];
  const blackWhiteMixer = adjustments.blackWhiteMixer;
  const colorBalanceRgb = adjustments.colorBalanceRgb;
  const channelMixer = adjustments.channelMixer;
  const activeColorBalance = colorBalanceRgb[activeColorBalanceRange];
  const activeChannelMixerRow = channelMixer[activeChannelMixerOutput];
  const hslSummary = [
    `H ${formatSignedInteger(currentHsl.hue)}`,
    `S ${formatSignedInteger(currentHsl.saturation)}`,
    `L ${formatSignedInteger(currentHsl.luminance)}`,
  ].join(' / ');
  const colorBalanceSummary = colorBalanceChannels
    .map((channel) => `${channel.label.charAt(0)} ${formatSignedInteger(activeColorBalance[channel.key])}`)
    .join(' / ');
  const channelMixerSummary = channelMixerSources
    .map((source) => `${source.label.charAt(0)} ${formatSignedInteger(activeChannelMixerRow[source.key])}`)
    .join(' / ');
  const activeBlackWhiteWeight = blackWhiteMixer.weights[activeColor];
  const hasActiveHslChanges =
    currentHsl.hue !== INITIAL_ADJUSTMENTS.hsl[activeColor].hue ||
    currentHsl.saturation !== INITIAL_ADJUSTMENTS.hsl[activeColor].saturation ||
    currentHsl.luminance !== INITIAL_ADJUSTMENTS.hsl[activeColor].luminance;
  const hasActiveLocalRangeChanges =
    activeRangeControls.centerHueDegrees !==
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor].centerHueDegrees ||
    activeRangeControls.widthDegrees !== INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor].widthDegrees ||
    activeRangeControls.falloffSmoothness !==
      INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor].falloffSmoothness;

  const handleHslChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((previous) => ({
      ...previous,
      hsl: {
        ...previous.hsl,
        [activeColor]: {
          ...previous.hsl[activeColor],
          [key]: value,
        },
      },
    }));
  };

  const resetActiveHsl = () => {
    setAdjustments((previous) => ({
      ...previous,
      hsl: {
        ...previous.hsl,
        [activeColor]: { ...INITIAL_ADJUSTMENTS.hsl[activeColor] },
      },
    }));
  };

  const resetActiveLocalRange = () => {
    setAdjustments((previous) => ({
      ...previous,
      selectiveColorRangeControls: {
        ...previous.selectiveColorRangeControls,
        [activeColor]: { ...INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor] },
      },
    }));
  };

  const handleRangeControlChange = (
    key: keyof Adjustments['selectiveColorRangeControls'][BlackWhiteMixerChannel],
    value: number,
  ) => {
    setAdjustments((previous) => ({
      ...previous,
      selectiveColorRangeControls: {
        ...previous.selectiveColorRangeControls,
        [activeColor]: {
          ...previous.selectiveColorRangeControls[activeColor],
          [key]: value,
        },
      },
    }));
  };

  const handleBlackWhiteToggle = () => {
    setAdjustments((previous) => {
      const current = previous.blackWhiteMixer;
      const enabling = !current.enabled;
      const weightsHaveContribution = Object.values(current.weights).some((weight) => weight !== 0);

      return {
        ...previous,
        blackWhiteMixer: {
          ...current,
          enabled: enabling,
          weights: enabling && !weightsHaveContribution ? { ...current.weights, [activeColor]: 20 } : current.weights,
        },
      };
    });
  };

  const handleBlackWhiteWeightChange = (value: number) => {
    setAdjustments((previous) => ({
      ...previous,
      blackWhiteMixer: {
        ...previous.blackWhiteMixer,
        weights: {
          ...previous.blackWhiteMixer.weights,
          [activeColor]: value,
        },
      },
    }));
  };

  const handleColorBalanceToggle = () => {
    setAdjustments((previous) => ({
      ...previous,
      colorBalanceRgb: {
        ...previous.colorBalanceRgb,
        enabled: !previous.colorBalanceRgb.enabled,
      },
    }));
  };

  const handleColorBalanceChange = (channel: ColorBalanceRgbChannel, value: number) => {
    setAdjustments((previous) => ({
      ...previous,
      colorBalanceRgb: {
        ...previous.colorBalanceRgb,
        [activeColorBalanceRange]: {
          ...previous.colorBalanceRgb[activeColorBalanceRange],
          [channel]: value,
        },
      },
    }));
  };

  const handleChannelMixerToggle = () => {
    setAdjustments((previous) => ({
      ...previous,
      channelMixer: {
        ...previous.channelMixer,
        enabled: !previous.channelMixer.enabled,
      },
    }));
  };

  const handleChannelMixerChange = (source: ChannelMixerSource, value: number) => {
    setAdjustments((previous) => ({
      ...previous,
      channelMixer: {
        ...previous.channelMixer,
        [activeChannelMixerOutput]: {
          ...previous.channelMixer[activeChannelMixerOutput],
          [source]: value,
        },
      },
    }));
  };

  const handleColorBalancePreserveLuminance = () => {
    setAdjustments((previous) => ({
      ...previous,
      colorBalanceRgb: {
        ...previous.colorBalanceRgb,
        preserveLuminance: !previous.colorBalanceRgb.preserveLuminance,
      },
    }));
  };

  const handleChannelMixerPreserveLuminance = () => {
    setAdjustments((previous) => ({
      ...previous,
      channelMixer: {
        ...previous.channelMixer,
        preserveLuminance: !previous.channelMixer.preserveLuminance,
      },
    }));
  };

  const onLabel = t('adjustments.color.colorBalanceRgb.enabled');
  const offLabel = t('adjustments.color.colorBalanceRgb.disabled');

  return (
    <div className="border-b border-editor-border" data-testid="color-mixer-controls">
      <section
        className="pb-2"
        data-active-range={activeColor}
        data-dirty={String(hasActiveHslChanges)}
        data-testid="selective-color-range-controls"
      >
        <div className={density.sectionHeader.rootLoose}>
          <div className="min-w-0">
            <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
              {t('adjustments.color.colorMixer')}
            </UiText>
            <span className={density.sectionHeader.summary}>{hslSummary}</span>
          </div>
          <span className={density.sectionHeader.badge} data-testid="selective-color-active-range-chip">
            {t(activeRange.labelKey)}
          </span>
        </div>
        <div className="mb-1.5 grid grid-cols-6 gap-1">
          {hslColors.map(({ color, label, name }) => (
            <ColorSwatch
              ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
              color={color}
              isActive={activeColor === name}
              key={name}
              label={label}
              name={name}
              onClick={setActiveColor}
              size="sm"
              testId={`selective-color-range-${name}`}
            />
          ))}
        </div>
        <div className="grid gap-1">
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.color.hue')}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              handleHslChange(ColorAdjustment.Hue, value);
            }}
            step={1}
            trackClassName={`hue-slider-${activeColor}`}
            value={currentHsl.hue}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.color.saturation')}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              handleHslChange(ColorAdjustment.Saturation, value);
            }}
            step={1}
            trackClassName={`sat-slider-${activeColor}`}
            value={currentHsl.saturation}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.color.luminance')}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              handleHslChange(ColorAdjustment.Luminance, value);
            }}
            step={1}
            value={currentHsl.luminance}
          />
        </div>
        <div className="mt-1 flex justify-end">
          <button
            aria-label={t('adjustments.color.resetActiveRange')}
            className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
            data-testid="selective-color-reset-active-range"
            disabled={!hasActiveHslChanges}
            onClick={resetActiveHsl}
            title={t('adjustments.color.resetActiveRange')}
            type="button"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </section>

      {!isForMask && (
        <details
          className="border-t border-editor-border"
          data-scope="local-adjustment"
          data-testid="local-color-range-adjustment-disclosure"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <span className={density.sectionHeader.title}>{t('adjustments.color.createLocalAdjustmentFromRange')}</span>
            <span className={cx(density.sectionHeader.summary, 'flex items-center gap-1')}>
              <span>{Math.round(activeRangeControls.centerHueDegrees)}°</span>
              <span aria-hidden="true">/</span>
              <span>{Math.round(activeRangeControls.widthDegrees)}°</span>
            </span>
          </summary>
          <div
            className="grid gap-1 border-t border-editor-border pb-2 pt-1.5"
            data-testid="local-color-range-adjustment-controls"
          >
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.rangeCenter')}
              max={359}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                handleRangeControlChange('centerHueDegrees', value);
              }}
              step={1}
              suffix="°"
              value={Math.round(activeRangeControls.centerHueDegrees)}
            />
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.rangeWidth')}
              max={180}
              min={10}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                handleRangeControlChange('widthDegrees', value);
              }}
              step={1}
              suffix="°"
              value={Math.round(activeRangeControls.widthDegrees)}
            />
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.falloffSmoothness')}
              max={40}
              min={3}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                handleRangeControlChange('falloffSmoothness', value / 10);
              }}
              step={1}
              value={Math.round(activeRangeControls.falloffSmoothness * 10)}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <button
                aria-label={t('adjustments.color.resetActiveRange')}
                className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
                data-testid="local-color-range-reset"
                disabled={!hasActiveLocalRangeChanges}
                onClick={resetActiveLocalRange}
                title={t('adjustments.color.resetActiveRange')}
                type="button"
              >
                <RotateCcw size={13} />
              </button>
              <button
                className={cx(
                  density.actionButton.base,
                  'w-fit gap-1 border border-editor-border bg-editor-panel text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
                )}
                data-command-type="layerMask.createRangeMask"
                data-range-key={activeColor}
                data-testid="selective-color-create-local-adjustment"
                disabled={
                  !canCreateLocalAdjustmentFromActiveRange || onCreateLocalAdjustmentFromActiveRange === undefined
                }
                onClick={onCreateLocalAdjustmentFromActiveRange}
                type="button"
              >
                <Layers size={13} />
                <span>{t('adjustments.color.createLocalAdjustmentFromRange')}</span>
              </button>
            </div>
          </div>
        </details>
      )}

      {!isForMask && adjustmentVisibility[ColorAdjustment.ColorBalanceRgb] !== false && (
        <details className="border-t border-editor-border" data-testid="color-balance-disclosure">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.color.colorBalanceRgb.title')}
              </UiText>
              <span className={density.sectionHeader.summary}>
                {colorBalanceRgb.enabled ? colorBalanceSummary : offLabel}
              </span>
            </span>
            <DisclosureToggle
              isOn={colorBalanceRgb.enabled}
              offLabel={offLabel}
              onClick={handleColorBalanceToggle}
              onLabel={onLabel}
              testId="color-balance-toggle"
            />
          </summary>
          {colorBalanceRgb.enabled && (
            <div
              className="grid gap-1.5 border-t border-editor-border pb-2 pt-1.5"
              data-testid="color-balance-controls"
            >
              <div className="grid grid-cols-3 gap-1">
                {colorBalanceRanges.map((range) => (
                  <button
                    aria-pressed={activeColorBalanceRange === range.key}
                    className={cx(
                      density.actionButton.base,
                      'w-full',
                      activeColorBalanceRange === range.key
                        ? density.actionButton.selectedQuiet
                        : density.actionButton.inactive,
                    )}
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
                  density="compact"
                  key={channel.key}
                  label={channel.label}
                  max={100}
                  min={-100}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(value) => {
                    handleColorBalanceChange(channel.key, value);
                  }}
                  step={1}
                  value={activeColorBalance[channel.key]}
                />
              ))}
              <button
                aria-pressed={colorBalanceRgb.preserveLuminance}
                className={cx(
                  density.actionButton.base,
                  'w-fit border border-editor-border',
                  colorBalanceRgb.preserveLuminance
                    ? density.actionButton.selectedQuiet
                    : density.actionButton.inactive,
                )}
                onClick={handleColorBalancePreserveLuminance}
                type="button"
              >
                {t('adjustments.color.colorBalanceRgb.preserveLuminance')}:{' '}
                {colorBalanceRgb.preserveLuminance ? onLabel : offLabel}
              </button>
            </div>
          )}
        </details>
      )}

      {!isForMask && adjustmentVisibility[ColorAdjustment.ChannelMixer] !== false && (
        <details className="border-t border-editor-border" data-testid="channel-mixer-disclosure">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.color.channelMixer.title')}
              </UiText>
              <span className={density.sectionHeader.summary}>
                {channelMixer.enabled ? channelMixerSummary : offLabel}
              </span>
            </span>
            <DisclosureToggle
              isOn={channelMixer.enabled}
              offLabel={offLabel}
              onClick={handleChannelMixerToggle}
              onLabel={onLabel}
              testId="channel-mixer-toggle"
            />
          </summary>
          {channelMixer.enabled && (
            <div
              className="grid gap-1.5 border-t border-editor-border pb-2 pt-1.5"
              data-testid="channel-mixer-controls"
            >
              <div className="grid grid-cols-3 gap-1">
                {channelMixerOutputs.map((output) => (
                  <button
                    aria-pressed={activeChannelMixerOutput === output.key}
                    className={cx(
                      density.actionButton.base,
                      'w-full',
                      activeChannelMixerOutput === output.key
                        ? density.actionButton.selectedQuiet
                        : density.actionButton.inactive,
                    )}
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
                  density="compact"
                  key={source.key}
                  label={source.label}
                  max={source.key === 'constant' ? 100 : 200}
                  min={source.key === 'constant' ? -100 : -200}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(value) => {
                    handleChannelMixerChange(source.key, value);
                  }}
                  step={1}
                  value={activeChannelMixerRow[source.key]}
                />
              ))}
              <button
                aria-pressed={channelMixer.preserveLuminance}
                className={cx(
                  density.actionButton.base,
                  'w-fit border border-editor-border',
                  channelMixer.preserveLuminance ? density.actionButton.selectedQuiet : density.actionButton.inactive,
                )}
                onClick={handleChannelMixerPreserveLuminance}
                type="button"
              >
                {t('adjustments.color.channelMixer.preserveLuminance')}:{' '}
                {channelMixer.preserveLuminance ? onLabel : offLabel}
              </button>
            </div>
          )}
        </details>
      )}

      {!isForMask && adjustmentVisibility[ColorAdjustment.BlackWhiteMixer] !== false && (
        <details className="border-t border-editor-border" data-testid="black-white-mixer-disclosure">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.color.blackWhiteMixer.title')}
              </UiText>
              <span className={density.sectionHeader.summary}>
                {blackWhiteMixer.enabled
                  ? `${t(activeRange.labelKey)} ${formatSignedInteger(activeBlackWhiteWeight)}`
                  : offLabel}
              </span>
            </span>
            <DisclosureToggle
              isOn={blackWhiteMixer.enabled}
              offLabel={offLabel}
              onClick={handleBlackWhiteToggle}
              onLabel={onLabel}
              testId="black-white-mixer-toggle"
            />
          </summary>
          {blackWhiteMixer.enabled && (
            <div
              className="grid gap-1.5 border-t border-editor-border pb-2 pt-1.5"
              data-testid="black-white-mixer-controls"
            >
              <div className="grid grid-cols-6 gap-1">
                {hslColors.map(({ color, label, name }) => (
                  <ColorSwatch
                    ariaLabel={t('adjustments.color.blackWhiteMixer.ariaSelectChannel', { name: label })}
                    color={color}
                    isActive={activeColor === name}
                    key={name}
                    label={label}
                    name={name}
                    onClick={setActiveColor}
                    size="sm"
                  />
                ))}
              </div>
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.color.blackWhiteMixer.contribution', { name: t(activeRange.labelKey) })}
                max={100}
                min={-100}
                onDragStateChange={onDragStateChange}
                onValueChange={handleBlackWhiteWeightChange}
                step={1}
                value={activeBlackWhiteWeight}
              />
            </div>
          )}
        </details>
      )}
    </div>
  );
};
