import cx from 'clsx';
import { ChevronDown, Layers, RotateCcw } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackWhiteMixerChannel } from '../../../schemas/color/blackWhiteMixerSchemas';
import type { ChannelMixerOutput } from '../../../schemas/color/channelMixerSchemas';
import type { ColorBalanceRgbRange } from '../../../schemas/color/colorBalanceRgbSchemas';
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

export const ColorMixerControls = ({
  activeColor,
  adjustments,
  canCreateLocalAdjustmentFromActiveRange = false,
  isForMask,
  onCreateLocalAdjustmentFromActiveRange,
  onDragStateChange,
  setActiveColor,
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
    </div>
  );
};
