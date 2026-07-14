import cx from 'clsx';
import { ChevronDown, Layers, RotateCcw } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, type MouseEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackWhiteMixerChannel, BlackWhiteMixerSettings } from '../../../schemas/color/blackWhiteMixerSchemas';
import type {
  ChannelMixerOutput,
  ChannelMixerSettings,
  ChannelMixerSource,
} from '../../../schemas/color/channelMixerSchemas';
import type {
  ColorBalanceRgbChannel,
  ColorBalanceRgbRange,
  ColorBalanceRgbSettings,
} from '../../../schemas/color/colorBalanceRgbSchemas';
import { type Adjustments, ColorAdjustment, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import { getSelectiveColorRange, SELECTIVE_COLOR_RANGES } from '../../../utils/selectiveColorRanges';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import AdjustmentSlider from '../AdjustmentSlider';
import type { ColorPanelGroupProps } from './types';

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

interface HueBandSegment {
  leftPercent: number;
  widthPercent: number;
}

const formatSignedInteger = (value: number) => (value > 0 ? `+${value}` : String(value));

const colorBalanceRanges: Array<ColorBalanceRgbRange> = ['shadows', 'midtones', 'highlights'];
const colorBalanceChannels: Array<ColorBalanceRgbChannel> = ['red', 'green', 'blue'];
const channelMixerOutputs: Array<ChannelMixerOutput> = ['red', 'green', 'blue'];
const channelMixerSources: Array<ChannelMixerSource> = ['red', 'green', 'blue', 'constant'];

export const enableBlackWhiteMixer = (
  settings: BlackWhiteMixerSettings,
  activeChannel: BlackWhiteMixerChannel,
): BlackWhiteMixerSettings => {
  const hasAdjustment = Object.values(settings.weights).some((weight) => weight !== 0);
  if (!hasAdjustment && settings.process === 'legacy_fixed_band_v1') {
    return { ...settings, enabled: true, process: 'continuous_sensitivity_v1' };
  }
  return {
    ...settings,
    enabled: true,
    weights: hasAdjustment ? settings.weights : { ...settings.weights, [activeChannel]: 20 },
  };
};

export const isBlackWhiteMixerModified = (settings: BlackWhiteMixerSettings): boolean =>
  settings.enabled !== INITIAL_ADJUSTMENTS.blackWhiteMixer.enabled ||
  settings.process !== INITIAL_ADJUSTMENTS.blackWhiteMixer.process ||
  Object.keys(settings.weights).some(
    (channel) =>
      settings.weights[channel as BlackWhiteMixerChannel] !==
      INITIAL_ADJUSTMENTS.blackWhiteMixer.weights[channel as BlackWhiteMixerChannel],
  );

export const isColorBalanceRgbModified = (settings: ColorBalanceRgbSettings): boolean =>
  settings.enabled !== INITIAL_ADJUSTMENTS.colorBalanceRgb.enabled ||
  settings.preserveLuminance !== INITIAL_ADJUSTMENTS.colorBalanceRgb.preserveLuminance ||
  colorBalanceRanges.some((range) =>
    colorBalanceChannels.some(
      (channel) => settings[range][channel] !== INITIAL_ADJUSTMENTS.colorBalanceRgb[range][channel],
    ),
  );

export const isChannelMixerModified = (settings: ChannelMixerSettings): boolean =>
  settings.enabled !== INITIAL_ADJUSTMENTS.channelMixer.enabled ||
  settings.preserveLuminance !== INITIAL_ADJUSTMENTS.channelMixer.preserveLuminance ||
  channelMixerOutputs.some((output) =>
    channelMixerSources.some((source) => settings[output][source] !== INITIAL_ADJUSTMENTS.channelMixer[output][source]),
  );

export const formatRgbSummary = (values: { red: number; green: number; blue: number }): string =>
  `R ${formatSignedInteger(values.red)} / G ${formatSignedInteger(values.green)} / B ${formatSignedInteger(values.blue)}`;

export const resetColorBalanceRange = (
  settings: ColorBalanceRgbSettings,
  range: ColorBalanceRgbRange,
): ColorBalanceRgbSettings => ({
  ...settings,
  [range]: { ...INITIAL_ADJUSTMENTS.colorBalanceRgb[range] },
});

export const resetChannelMixerOutput = (
  settings: ChannelMixerSettings,
  output: ChannelMixerOutput,
): ChannelMixerSettings => ({
  ...settings,
  [output]: { ...INITIAL_ADJUSTMENTS.channelMixer[output] },
});

interface HeaderToggleProps {
  checked: boolean;
  label: string;
  onChange: () => void;
  testId: string;
}

const HeaderToggle = ({ checked, label, onChange, testId }: HeaderToggleProps) => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onChange();
  };

  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cx(
        professionalInspectorDensityTokens.actionButton.base,
        checked
          ? professionalInspectorDensityTokens.actionButton.active
          : professionalInspectorDensityTokens.actionButton.inactive,
      )}
      data-testid={testId}
      onClick={handleClick}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative h-3.5 w-7 rounded-full border transition-colors',
          checked
            ? 'border-editor-primary-active bg-editor-primary-active/25'
            : 'border-editor-border bg-editor-panel-well',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-2 w-2 rounded-full transition-[background-color,transform]',
            checked ? 'bg-editor-primary-active translate-x-4' : 'translate-x-0.5 bg-editor-disabled',
          )}
        />
      </span>
    </button>
  );
};

export const getHueBandSegments = (centerHueDegrees: number, widthDegrees: number): Array<HueBandSegment> => {
  const halfWidth = Math.min(180, Math.max(0, widthDegrees)) / 2;
  const start = (((centerHueDegrees - halfWidth) % 360) + 360) % 360;
  const end = (((centerHueDegrees + halfWidth) % 360) + 360) % 360;

  if (widthDegrees >= 360) return [{ leftPercent: 0, widthPercent: 100 }];
  if (start <= end) return [{ leftPercent: start / 3.6, widthPercent: (end - start) / 3.6 }];
  return [
    { leftPercent: 0, widthPercent: end / 3.6 },
    { leftPercent: start / 3.6, widthPercent: (360 - start) / 3.6 },
  ];
};

export const getNextSelectiveColorRange = (
  activeRange: BlackWhiteMixerChannel,
  key: string,
): BlackWhiteMixerChannel => {
  const activeIndex = Math.max(
    0,
    SELECTIVE_COLOR_RANGES.findIndex((range) => range.key === activeRange),
  );
  if (key === 'Home') return SELECTIVE_COLOR_RANGES[0]?.key ?? activeRange;
  if (key === 'End') return SELECTIVE_COLOR_RANGES.at(-1)?.key ?? activeRange;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return activeRange;
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  return (
    SELECTIVE_COLOR_RANGES[(activeIndex + direction + SELECTIVE_COLOR_RANGES.length) % SELECTIVE_COLOR_RANGES.length]
      ?.key ?? activeRange
  );
};

export const getNextAdvancedMixerSelection = <T extends string>(items: Array<T>, active: T, key: string): T => {
  const activeIndex = Math.max(0, items.indexOf(active));
  if (key === 'Home') return items[0] ?? active;
  if (key === 'End') return items.at(-1) ?? active;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return active;
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  return items[(activeIndex + direction + items.length) % items.length] ?? active;
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
  const [mixerMode, setMixerMode] = useState<'color' | 'hsl'>('color');
  const ranges = useMemo(
    () =>
      SELECTIVE_COLOR_RANGES.map((range) => {
        const hsl = adjustments.hsl[range.key];
        const selection = adjustments.selectiveColorRangeControls[range.key];
        const initialHsl = INITIAL_ADJUSTMENTS.hsl[range.key];
        const initialSelection = INITIAL_ADJUSTMENTS.selectiveColorRangeControls[range.key];
        return {
          ...range,
          edited:
            hsl.hue !== initialHsl.hue ||
            hsl.saturation !== initialHsl.saturation ||
            hsl.luminance !== initialHsl.luminance ||
            selection.centerHueDegrees !== initialSelection.centerHueDegrees ||
            selection.widthDegrees !== initialSelection.widthDegrees ||
            selection.falloffSmoothness !== initialSelection.falloffSmoothness,
          hsl,
          label: t(range.labelKey),
          selection,
        };
      }),
    [adjustments.hsl, adjustments.selectiveColorRangeControls, t],
  );
  const activeRange = getSelectiveColorRange(activeColor);
  const currentHsl = adjustments.hsl[activeColor];
  const activeRangeControls = adjustments.selectiveColorRangeControls[activeColor];
  const initialHsl = INITIAL_ADJUSTMENTS.hsl[activeColor];
  const initialRangeControls = INITIAL_ADJUSTMENTS.selectiveColorRangeControls[activeColor];
  const hasActiveHslChanges =
    currentHsl.hue !== initialHsl.hue ||
    currentHsl.saturation !== initialHsl.saturation ||
    currentHsl.luminance !== initialHsl.luminance;
  const hasActiveLocalRangeChanges =
    activeRangeControls.centerHueDegrees !== initialRangeControls.centerHueDegrees ||
    activeRangeControls.widthDegrees !== initialRangeControls.widthDegrees ||
    activeRangeControls.falloffSmoothness !== initialRangeControls.falloffSmoothness;
  const hasMixerChanges = ranges.some((range) => range.edited);
  const hslSummary = [
    `H ${formatSignedInteger(currentHsl.hue)}`,
    `S ${formatSignedInteger(currentHsl.saturation)}`,
    `L ${formatSignedInteger(currentHsl.luminance)}`,
  ].join(' / ');
  const modifiedLabel = t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' });
  const hueBandSegments = getHueBandSegments(activeRangeControls.centerHueDegrees, activeRangeControls.widthDegrees);

  const handleHslChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((previous) => ({
      ...previous,
      hsl: { ...previous.hsl, [activeColor]: { ...previous.hsl[activeColor], [key]: value } },
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
        [activeColor]: { ...previous.selectiveColorRangeControls[activeColor], [key]: value },
      },
    }));
  };

  const resetActiveHsl = () => {
    setAdjustments((previous) => ({
      ...previous,
      hsl: { ...previous.hsl, [activeColor]: { ...INITIAL_ADJUSTMENTS.hsl[activeColor] } },
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

  const resetMixer = () => {
    setAdjustments((previous) => ({
      ...previous,
      hsl: structuredClone(INITIAL_ADJUSTMENTS.hsl),
      selectiveColorRangeControls: structuredClone(INITIAL_ADJUSTMENTS.selectiveColorRangeControls),
    }));
  };

  const handleRangeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextRange = getNextSelectiveColorRange(activeColor, event.key);
    if (nextRange === activeColor && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setActiveColor(nextRange);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-testid="selective-color-range-${nextRange}"]`)?.focus();
    });
  };

  return (
    <div data-testid="color-mixer-controls">
      <section
        className="border-b border-editor-border pb-2"
        data-active-range={activeColor}
        data-dirty={String(hasActiveHslChanges)}
        data-testid="selective-color-range-controls"
      >
        <CompactInspectorSectionHeader
          actions={
            <button
              aria-label={t('adjustments.basic.reset')}
              className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
              data-testid="selective-color-reset-mixer"
              disabled={!hasMixerChanges}
              onClick={resetMixer}
              title={t('adjustments.basic.reset')}
              type="button"
            >
              <RotateCcw size={13} />
            </button>
          }
          modified={hasMixerChanges}
          modifiedLabel={modifiedLabel}
          summary={hslSummary}
          title={t('adjustments.color.colorMixer')}
        />

        <div
          aria-label={t('adjustments.color.colorMixer')}
          className="mb-1 grid min-h-7 w-full grid-cols-2 gap-px rounded-sm border border-editor-border bg-editor-panel-well p-px"
          role="radiogroup"
        >
          {(['color', 'hsl'] as const).map((mode) => (
            <button
              aria-checked={mixerMode === mode}
              className="min-w-0 rounded-sm px-1 text-[11px] font-medium leading-4 text-text-secondary transition-colors hover:bg-editor-hover hover:text-text-primary focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring aria-checked:bg-editor-selected-quiet aria-checked:text-editor-selected-quiet-text"
              key={mode}
              onClick={() => setMixerMode(mode)}
              role="radio"
              type="button"
            >
              {mode === 'color' ? 'Color' : 'HSL'}
            </button>
          ))}
        </div>

        <div aria-label={t('adjustments.color.colorMixer')} className="grid grid-cols-8 gap-px" role="tablist">
          {ranges.map((range) => (
            <button
              aria-label={t('adjustments.color.ariaSelectColor', { name: range.label })}
              aria-selected={activeColor === range.key}
              className={cx(
                'relative flex h-9 min-w-0 flex-col items-center justify-center gap-0.5 border-b-2 px-px text-[9px] font-medium leading-3 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                activeColor === range.key
                  ? 'border-editor-primary-active bg-editor-selected-quiet text-text-primary'
                  : 'border-transparent text-text-tertiary hover:bg-editor-panel-raised hover:text-text-primary',
              )}
              data-edited={String(range.edited)}
              data-testid={`selective-color-range-${range.key}`}
              key={range.key}
              onClick={() => setActiveColor(range.key)}
              onKeyDown={handleRangeKeyDown}
              role="tab"
              tabIndex={activeColor === range.key ? 0 : -1}
              title={`${range.label}${range.edited ? `, ${modifiedLabel}` : ''}`}
              type="button"
            >
              <span className="h-3 w-3 rounded-full border border-black/25" style={{ backgroundColor: range.color }} />
              <span className="max-w-full truncate">{range.label.slice(0, 2)}</span>
              {range.edited && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-editor-info" />
              )}
            </button>
          ))}
        </div>

        <div className="my-1.5 flex min-h-10 items-center gap-2 border-y border-editor-border bg-editor-panel-well px-2 py-1">
          <span
            className="h-7 w-7 shrink-0 rounded-sm border border-black/25"
            style={{ backgroundColor: activeRange.color }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <strong
                className="truncate text-[12px] leading-4 text-text-primary"
                data-testid="selective-color-active-range-chip"
              >
                {t(activeRange.labelKey)}
              </strong>
              {(hasActiveHslChanges || hasActiveLocalRangeChanges) && (
                <span className="text-[10px] text-editor-info">{modifiedLabel}</span>
              )}
            </div>
            <div className="font-mono text-[10px] leading-4 tabular-nums text-text-secondary">{hslSummary}</div>
          </div>
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

        <div className="grid gap-1">
          {(
            [
              [ColorAdjustment.Hue, t('adjustments.color.hue'), currentHsl.hue, `hue-slider-${activeColor}`],
              [
                ColorAdjustment.Saturation,
                t('adjustments.color.saturation'),
                currentHsl.saturation,
                `sat-slider-${activeColor}`,
              ],
              [ColorAdjustment.Luminance, t('adjustments.color.luminance'), currentHsl.luminance, undefined],
            ] as const
          ).map(([key, label, value, trackClassName]) => (
            <AdjustmentSlider
              defaultValue={INITIAL_ADJUSTMENTS.hsl[activeColor][key]}
              density="compact"
              key={key}
              label={label}
              max={100}
              min={-100}
              onDragStateChange={onDragStateChange}
              onValueChange={(nextValue) => handleHslChange(key, nextValue)}
              step={1}
              {...(trackClassName ? { trackClassName } : {})}
              value={value}
            />
          ))}
        </div>
      </section>

      {!isForMask && (
        <details
          className="group border-b border-editor-border"
          data-scope="local-adjustment"
          data-testid="local-color-range-adjustment-disclosure"
        >
          <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <CompactInspectorSectionHeader
              actions={
                <ChevronDown
                  aria-hidden="true"
                  className="text-text-secondary transition-transform group-open:rotate-180"
                  size={14}
                />
              }
              modified={hasActiveLocalRangeChanges}
              modifiedLabel={modifiedLabel}
              summary={`${Math.round(activeRangeControls.centerHueDegrees)}° / ${Math.round(activeRangeControls.widthDegrees)}°`}
              title="Range"
            />
          </summary>
          <div
            className="grid gap-1 border-t border-editor-border pb-1.5 pt-1"
            data-scope="local-adjustment"
            data-testid="local-color-range-adjustment-controls"
          >
            <div
              aria-label={t('adjustments.color.rangeCenter')}
              className="relative mb-1 h-4 overflow-hidden rounded-sm border border-editor-border hue-range-track"
              data-testid="selective-color-hue-band"
            >
              <div className="absolute inset-0 bg-black/45" />
              {hueBandSegments.map((segment, index) => (
                <span
                  className="absolute inset-y-0 border-x border-white/80 bg-white/15"
                  key={`${segment.leftPercent}-${index}`}
                  style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` } as CSSProperties}
                />
              ))}
            </div>
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.color.rangeCenter')}
              max={359}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => handleRangeControlChange('centerHueDegrees', value)}
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
              onValueChange={(value) => handleRangeControlChange('widthDegrees', value)}
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
              onValueChange={(value) => handleRangeControlChange('falloffSmoothness', value / 10)}
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
                title={
                  !canCreateLocalAdjustmentFromActiveRange ? 'Select an image to create a local adjustment' : undefined
                }
                type="button"
              >
                <Layers size={13} />
                <span>{t('adjustments.color.createLocalAdjustmentFromRange')}</span>
              </button>
            </div>
          </div>
        </details>
      )}

      {!isForMask && (
        <AdvancedMixerControls
          activeChannelMixerOutput={activeChannelMixerOutput}
          activeColor={activeColor}
          activeColorBalanceRange={activeColorBalanceRange}
          adjustmentVisibility={adjustmentVisibility}
          adjustments={adjustments}
          onDragStateChange={onDragStateChange}
          setActiveChannelMixerOutput={setActiveChannelMixerOutput}
          setActiveColor={setActiveColor}
          setActiveColorBalanceRange={setActiveColorBalanceRange}
          setAdjustments={setAdjustments}
        />
      )}
    </div>
  );
};

type AdvancedMixerControlsProps = Pick<
  ColorMixerControlsProps,
  | 'activeChannelMixerOutput'
  | 'activeColor'
  | 'activeColorBalanceRange'
  | 'adjustmentVisibility'
  | 'setActiveChannelMixerOutput'
  | 'setActiveColor'
  | 'setActiveColorBalanceRange'
> &
  Omit<ColorPanelGroupProps, 'appSettings'>;

const AdvancedMixerControls = ({
  activeChannelMixerOutput,
  activeColor,
  activeColorBalanceRange,
  adjustmentVisibility,
  adjustments,
  onDragStateChange,
  setActiveChannelMixerOutput,
  setActiveColor,
  setActiveColorBalanceRange,
  setAdjustments,
}: AdvancedMixerControlsProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const modifiedLabel = t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' });
  const offLabel = t('adjustments.color.colorBalanceRgb.disabled');
  const blackWhite = adjustments.blackWhiteMixer;
  const colorBalance = adjustments.colorBalanceRgb;
  const channelMixer = adjustments.channelMixer;
  const activeBalance = colorBalance[activeColorBalanceRange];
  const activeOutput = channelMixer[activeChannelMixerOutput];
  const activeRange = getSelectiveColorRange(activeColor);
  const blackWhiteModified = isBlackWhiteMixerModified(blackWhite);
  const colorBalanceModified = isColorBalanceRgbModified(colorBalance);
  const channelMixerModified = isChannelMixerModified(channelMixer);

  const resetBlackWhite = () => {
    setAdjustments((previous) => ({
      ...previous,
      blackWhiteMixer: structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
    }));
  };
  const resetBlackWhiteChannel = () => {
    setAdjustments((previous) => ({
      ...previous,
      blackWhiteMixer: {
        ...previous.blackWhiteMixer,
        weights: {
          ...previous.blackWhiteMixer.weights,
          [activeColor]: INITIAL_ADJUSTMENTS.blackWhiteMixer.weights[activeColor],
        },
      },
    }));
  };
  const resetColorBalance = () => {
    setAdjustments((previous) => ({
      ...previous,
      colorBalanceRgb: structuredClone(INITIAL_ADJUSTMENTS.colorBalanceRgb),
    }));
  };
  const resetActiveBalance = () => {
    setAdjustments((previous) => ({
      ...previous,
      colorBalanceRgb: resetColorBalanceRange(previous.colorBalanceRgb, activeColorBalanceRange),
    }));
  };
  const resetChannelMixer = () => {
    setAdjustments((previous) => ({
      ...previous,
      channelMixer: structuredClone(INITIAL_ADJUSTMENTS.channelMixer),
    }));
  };
  const resetActiveOutput = () => {
    setAdjustments((previous) => ({
      ...previous,
      channelMixer: resetChannelMixerOutput(previous.channelMixer, activeChannelMixerOutput),
    }));
  };

  const handleSelectorKeyDown = <T extends string>(
    event: KeyboardEvent<HTMLButtonElement>,
    items: Array<T>,
    active: T,
    select: (item: T) => void,
    testIdPrefix: string,
  ) => {
    const next = getNextAdvancedMixerSelection(items, active, event.key);
    if (next === active && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    select(next);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-testid="${testIdPrefix}-${next}"]`)?.focus(),
    );
  };

  const resetButton = (
    label: string,
    disabled: boolean,
    onClick: () => void,
    testId: string,
    insideSummary = false,
  ) => (
    <button
      aria-label={label}
      className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
      data-testid={testId}
      disabled={disabled}
      onClick={(event) => {
        if (insideSummary) {
          event.preventDefault();
          event.stopPropagation();
        }
        onClick();
      }}
      title={label}
      type="button"
    >
      <RotateCcw aria-hidden="true" size={13} />
    </button>
  );

  return (
    <div data-testid="advanced-mixer-controls">
      {adjustmentVisibility[ColorAdjustment.BlackWhiteMixer] !== false && (
        <details className="group border-b border-editor-border" data-testid="black-white-mixer-disclosure">
          <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <CompactInspectorSectionHeader
              actions={
                <>
                  {resetButton(
                    t('adjustments.basic.reset'),
                    !blackWhiteModified,
                    resetBlackWhite,
                    'black-white-mixer-reset',
                    true,
                  )}
                  <HeaderToggle
                    checked={blackWhite.enabled}
                    label={t('adjustments.color.blackWhiteMixer.title')}
                    onChange={() =>
                      setAdjustments((previous) => ({
                        ...previous,
                        blackWhiteMixer: previous.blackWhiteMixer.enabled
                          ? { ...previous.blackWhiteMixer, enabled: false }
                          : enableBlackWhiteMixer(previous.blackWhiteMixer, activeColor),
                      }))
                    }
                    testId="black-white-mixer-toggle"
                  />
                  <ChevronDown aria-hidden="true" className="text-text-secondary group-open:rotate-180" size={14} />
                </>
              }
              modified={blackWhiteModified}
              modifiedLabel={modifiedLabel}
              summary={
                blackWhite.enabled
                  ? `${t(activeRange.labelKey)} ${formatSignedInteger(blackWhite.weights[activeColor])}`
                  : offLabel
              }
              title={t('adjustments.color.blackWhiteMixer.title')}
            />
          </summary>
          <div
            className="grid gap-1 border-t border-editor-border pb-1.5 pt-1"
            data-enabled={String(blackWhite.enabled)}
            data-testid="black-white-mixer-controls"
          >
            <div
              aria-label={t('adjustments.color.blackWhiteMixer.title')}
              className="grid grid-cols-8 gap-px"
              role="tablist"
            >
              {SELECTIVE_COLOR_RANGES.map((range) => (
                <button
                  aria-label={t('adjustments.color.blackWhiteMixer.ariaSelectChannel', { name: t(range.labelKey) })}
                  aria-selected={activeColor === range.key}
                  className={cx(
                    'relative h-7 min-w-0 border-b-2 text-[9px] font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                    activeColor === range.key
                      ? 'border-editor-primary-active bg-editor-selected-quiet text-text-primary'
                      : 'border-transparent text-text-tertiary hover:bg-editor-panel-raised',
                  )}
                  data-edited={String(
                    blackWhite.weights[range.key] !== INITIAL_ADJUSTMENTS.blackWhiteMixer.weights[range.key],
                  )}
                  data-testid={`black-white-mixer-channel-${range.key}`}
                  key={range.key}
                  onClick={() => setActiveColor(range.key)}
                  onKeyDown={(event) =>
                    handleSelectorKeyDown(
                      event,
                      SELECTIVE_COLOR_RANGES.map((item) => item.key),
                      activeColor,
                      setActiveColor,
                      'black-white-mixer-channel',
                    )
                  }
                  role="tab"
                  tabIndex={activeColor === range.key ? 0 : -1}
                  title={t(range.labelKey)}
                  type="button"
                >
                  {t(range.labelKey).slice(0, 2)}
                </button>
              ))}
            </div>
            <div
              className={cx('grid gap-1', !blackWhite.enabled && 'opacity-60')}
              data-inactive={String(!blackWhite.enabled)}
            >
              <AdjustmentSlider
                defaultValue={INITIAL_ADJUSTMENTS.blackWhiteMixer.weights[activeColor]}
                density="compact"
                label={t('adjustments.color.blackWhiteMixer.contribution', { name: t(activeRange.labelKey) })}
                max={100}
                min={-100}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) =>
                  setAdjustments((previous) => ({
                    ...previous,
                    blackWhiteMixer: {
                      ...previous.blackWhiteMixer,
                      weights: { ...previous.blackWhiteMixer.weights, [activeColor]: value },
                    },
                  }))
                }
                step={1}
                value={blackWhite.weights[activeColor]}
              />
              <div className="flex justify-end">
                {resetButton(
                  t('adjustments.color.resetActiveRange'),
                  blackWhite.weights[activeColor] === INITIAL_ADJUSTMENTS.blackWhiteMixer.weights[activeColor],
                  resetBlackWhiteChannel,
                  'black-white-mixer-reset-channel',
                )}
              </div>
            </div>
          </div>
        </details>
      )}

      {adjustmentVisibility[ColorAdjustment.ColorBalanceRgb] !== false && (
        <details className="group border-b border-editor-border" data-testid="color-balance-disclosure">
          <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <CompactInspectorSectionHeader
              actions={
                <>
                  {resetButton(
                    t('adjustments.basic.reset'),
                    !colorBalanceModified,
                    resetColorBalance,
                    'color-balance-reset',
                    true,
                  )}
                  <HeaderToggle
                    checked={colorBalance.enabled}
                    label={t('adjustments.color.colorBalanceRgb.title')}
                    onChange={() =>
                      setAdjustments((previous) => ({
                        ...previous,
                        colorBalanceRgb: { ...previous.colorBalanceRgb, enabled: !previous.colorBalanceRgb.enabled },
                      }))
                    }
                    testId="color-balance-toggle"
                  />
                  <ChevronDown aria-hidden="true" className="text-text-secondary group-open:rotate-180" size={14} />
                </>
              }
              modified={colorBalanceModified}
              modifiedLabel={modifiedLabel}
              summary={colorBalance.enabled ? formatRgbSummary(activeBalance) : offLabel}
              title={t('adjustments.color.colorBalanceRgb.title')}
            />
          </summary>
          <div
            className="grid gap-1 border-t border-editor-border pb-1.5 pt-1"
            data-enabled={String(colorBalance.enabled)}
            data-testid="color-balance-controls"
          >
            <div
              className="grid grid-cols-3 gap-px rounded-sm border border-editor-border bg-editor-panel-well p-px"
              role="tablist"
            >
              {colorBalanceRanges.map((range) => (
                <button
                  aria-selected={activeColorBalanceRange === range}
                  className={cx(
                    density.actionButton.base,
                    'w-full',
                    activeColorBalanceRange === range
                      ? density.actionButton.selectedQuiet
                      : density.actionButton.inactive,
                  )}
                  key={range}
                  onClick={() => setActiveColorBalanceRange(range)}
                  onKeyDown={(event) =>
                    handleSelectorKeyDown(
                      event,
                      colorBalanceRanges,
                      activeColorBalanceRange,
                      setActiveColorBalanceRange,
                      'color-balance-range',
                    )
                  }
                  role="tab"
                  tabIndex={activeColorBalanceRange === range ? 0 : -1}
                  data-testid={`color-balance-range-${range}`}
                  type="button"
                >
                  {t(`adjustments.color.colorBalanceRgb.ranges.${range}`)}
                </button>
              ))}
            </div>
            <div
              className={cx('grid gap-1', !colorBalance.enabled && 'opacity-60')}
              data-inactive={String(!colorBalance.enabled)}
            >
              {colorBalanceChannels.map((channel) => (
                <AdjustmentSlider
                  defaultValue={INITIAL_ADJUSTMENTS.colorBalanceRgb[activeColorBalanceRange][channel]}
                  density="compact"
                  key={channel}
                  label={t(`adjustments.color.colorBalanceRgb.channels.${channel}`)}
                  max={100}
                  min={-100}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(value) =>
                    setAdjustments((previous) => ({
                      ...previous,
                      colorBalanceRgb: {
                        ...previous.colorBalanceRgb,
                        [activeColorBalanceRange]: {
                          ...previous.colorBalanceRgb[activeColorBalanceRange],
                          [channel]: value,
                        },
                      },
                    }))
                  }
                  step={1}
                  value={activeBalance[channel]}
                />
              ))}
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary">
                  <input
                    checked={colorBalance.preserveLuminance}
                    className="accent-editor-primary-active"
                    onChange={() =>
                      setAdjustments((previous) => ({
                        ...previous,
                        colorBalanceRgb: {
                          ...previous.colorBalanceRgb,
                          preserveLuminance: !previous.colorBalanceRgb.preserveLuminance,
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {t('adjustments.color.colorBalanceRgb.preserveLuminance')}
                </label>
                {resetButton(
                  t('adjustments.color.resetActiveRange'),
                  colorBalanceChannels.every(
                    (channel) =>
                      activeBalance[channel] === INITIAL_ADJUSTMENTS.colorBalanceRgb[activeColorBalanceRange][channel],
                  ),
                  resetActiveBalance,
                  'color-balance-reset-range',
                )}
              </div>
            </div>
          </div>
        </details>
      )}

      {adjustmentVisibility[ColorAdjustment.ChannelMixer] !== false && (
        <details className="group border-b border-editor-border" data-testid="channel-mixer-disclosure">
          <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring [&::-webkit-details-marker]:hidden">
            <CompactInspectorSectionHeader
              actions={
                <>
                  {resetButton(
                    t('adjustments.basic.reset'),
                    !channelMixerModified,
                    resetChannelMixer,
                    'channel-mixer-reset',
                    true,
                  )}
                  <HeaderToggle
                    checked={channelMixer.enabled}
                    label={t('adjustments.color.channelMixer.title')}
                    onChange={() =>
                      setAdjustments((previous) => ({
                        ...previous,
                        channelMixer: { ...previous.channelMixer, enabled: !previous.channelMixer.enabled },
                      }))
                    }
                    testId="channel-mixer-toggle"
                  />
                  <ChevronDown aria-hidden="true" className="text-text-secondary group-open:rotate-180" size={14} />
                </>
              }
              modified={channelMixerModified}
              modifiedLabel={modifiedLabel}
              summary={channelMixer.enabled ? formatRgbSummary(activeOutput) : offLabel}
              title={t('adjustments.color.channelMixer.title')}
            />
          </summary>
          <div
            className="grid gap-1 border-t border-editor-border pb-1.5 pt-1"
            data-enabled={String(channelMixer.enabled)}
            data-testid="channel-mixer-controls"
          >
            <div
              className="grid grid-cols-3 gap-px rounded-sm border border-editor-border bg-editor-panel-well p-px"
              role="tablist"
            >
              {channelMixerOutputs.map((output) => (
                <button
                  aria-selected={activeChannelMixerOutput === output}
                  className={cx(
                    density.actionButton.base,
                    'w-full',
                    activeChannelMixerOutput === output
                      ? density.actionButton.selectedQuiet
                      : density.actionButton.inactive,
                  )}
                  key={output}
                  onClick={() => setActiveChannelMixerOutput(output)}
                  onKeyDown={(event) =>
                    handleSelectorKeyDown(
                      event,
                      channelMixerOutputs,
                      activeChannelMixerOutput,
                      setActiveChannelMixerOutput,
                      'channel-mixer-output',
                    )
                  }
                  role="tab"
                  tabIndex={activeChannelMixerOutput === output ? 0 : -1}
                  data-testid={`channel-mixer-output-${output}`}
                  type="button"
                >
                  {t(`adjustments.color.channelMixer.outputs.${output}`)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-px font-mono text-[9px] tabular-nums text-text-tertiary">
              {channelMixerOutputs.map((output) => (
                <span
                  className={cx('truncate px-1', output === activeChannelMixerOutput && 'text-text-primary')}
                  data-edited={String(
                    channelMixerSources.some(
                      (source) => channelMixer[output][source] !== INITIAL_ADJUSTMENTS.channelMixer[output][source],
                    ),
                  )}
                  key={output}
                >
                  {formatRgbSummary(channelMixer[output])}
                </span>
              ))}
            </div>
            <div
              className={cx('grid gap-1', !channelMixer.enabled && 'opacity-60')}
              data-inactive={String(!channelMixer.enabled)}
            >
              {channelMixerSources.map((source) => (
                <AdjustmentSlider
                  defaultValue={INITIAL_ADJUSTMENTS.channelMixer[activeChannelMixerOutput][source]}
                  density="compact"
                  key={source}
                  label={t(`adjustments.color.channelMixer.sources.${source}`)}
                  max={source === 'constant' ? 100 : 200}
                  min={source === 'constant' ? -100 : -200}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(value) =>
                    setAdjustments((previous) => ({
                      ...previous,
                      channelMixer: {
                        ...previous.channelMixer,
                        [activeChannelMixerOutput]: {
                          ...previous.channelMixer[activeChannelMixerOutput],
                          [source]: value,
                        },
                      },
                    }))
                  }
                  step={1}
                  value={activeOutput[source]}
                />
              ))}
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary">
                  <input
                    checked={channelMixer.preserveLuminance}
                    className="accent-editor-primary-active"
                    onChange={() =>
                      setAdjustments((previous) => ({
                        ...previous,
                        channelMixer: {
                          ...previous.channelMixer,
                          preserveLuminance: !previous.channelMixer.preserveLuminance,
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  {t('adjustments.color.channelMixer.preserveLuminance')}
                </label>
                {resetButton(
                  t('adjustments.color.resetActiveRange'),
                  channelMixerSources.every(
                    (source) =>
                      activeOutput[source] === INITIAL_ADJUSTMENTS.channelMixer[activeChannelMixerOutput][source],
                  ),
                  resetActiveOutput,
                  'channel-mixer-reset-output',
                )}
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
};
