import cx from 'clsx';
import { Check, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../../types/typography';
import { ColorGrading, type HueSatLum, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import { perceptualGradingFromWheelSurface } from '../../../utils/color/perceptualGrading';
import { COLOR_GRADING_PRESETS } from '../../../utils/colorGradingPresets';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import ColorWheel from '../ColorWheel';
import type { ColorPanelGroupProps } from './types';

const colorGradingRangeKeys = ['shadows', 'midtones', 'highlights', 'global'] as const;
const threeWayRangeKeys = ['shadows', 'midtones', 'highlights'] as const;
const colorGradingViews = ['3way', ...colorGradingRangeKeys] as const;

type ColorGradingPreset = (typeof COLOR_GRADING_PRESETS)[number];
type ColorGradingRange = (typeof colorGradingRangeKeys)[number];
type ColorGradingView = (typeof colorGradingViews)[number];
type ThreeWayRange = (typeof threeWayRangeKeys)[number];

const areColorGradingWheelValuesEqual = (left: HueSatLum, right: HueSatLum) =>
  left.hue === right.hue && left.saturation === right.saturation && left.luminance === right.luminance;

const isColorGradingPresetApplied = (
  colorGrading: ColorPanelGroupProps['adjustments']['colorGrading'],
  preset: ColorGradingPreset,
): boolean =>
  colorGrading.balance === preset.balance &&
  colorGrading.blending === preset.blending &&
  colorGradingRangeKeys.every((key) => areColorGradingWheelValuesEqual(colorGrading[key], preset[key]));

const isColorGradingRangeModified = (range: ColorGradingRange, value: HueSatLum): boolean =>
  !areColorGradingWheelValuesEqual(value, INITIAL_ADJUSTMENTS.colorGrading[range]);

const getColorGradingSwatchColor = (value: HueSatLum) => {
  const lightness = Math.round(Math.min(75, Math.max(25, 50 + value.luminance * 0.25)));
  return `hsl(${Math.round(value.hue)} ${Math.round(value.saturation)}% ${lightness}%)`;
};

const getColorGradingRangeEnum = (range: ColorGradingRange): ColorGrading => {
  switch (range) {
    case 'shadows':
      return ColorGrading.Shadows;
    case 'midtones':
      return ColorGrading.Midtones;
    case 'highlights':
      return ColorGrading.Highlights;
    case 'global':
      return ColorGrading.Global;
  }
};

export const ColorGradingControls = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelGroupProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const [activeView, setActiveView] = useState<ColorGradingView>('3way');
  const [activeThreeWayRange, setActiveThreeWayRange] = useState<ThreeWayRange>('midtones');
  const [isExpanded, setIsExpanded] = useState(true);
  const [isPresetMenuOpen, setIsPresetMenuOpen] = useState(false);
  const presetMenuId = useId();
  const presetMenuRef = useRef<HTMLDivElement>(null);
  const presetTriggerRef = useRef<HTMLButtonElement>(null);
  const colorGrading = adjustments.colorGrading;
  const activeRange: ColorGradingRange = activeView === '3way' ? activeThreeWayRange : activeView;
  const activeValue = colorGrading[activeRange];
  const activeDefaultValue = INITIAL_ADJUSTMENTS.colorGrading[activeRange];
  const activePresetId = useMemo(
    () => COLOR_GRADING_PRESETS.find((preset) => isColorGradingPresetApplied(colorGrading, preset))?.id ?? null,
    [colorGrading],
  );
  const activePreset = useMemo(
    () => COLOR_GRADING_PRESETS.find((preset) => preset.id === activePresetId) ?? null,
    [activePresetId],
  );
  const isToolModified =
    colorGrading.balance !== INITIAL_ADJUSTMENTS.colorGrading.balance ||
    colorGrading.blending !== INITIAL_ADJUSTMENTS.colorGrading.blending ||
    colorGradingRangeKeys.some((range) => isColorGradingRangeModified(range, colorGrading[range]));

  useEffect(() => {
    if (!isPresetMenuOpen) return;
    const activeOption = presetMenuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    const firstOption = presetMenuRef.current?.querySelector<HTMLButtonElement>('[role="option"]');
    (activeOption ?? firstOption)?.focus();
  }, [isPresetMenuOpen]);

  const getRangeLabel = (range: ColorGradingRange) => t(`adjustments.color.grading.${range}`);

  const handleApplyPreset = (preset: ColorGradingPreset) => {
    setAdjustments((prev) => {
      const colorGrading = {
        balance: preset.balance,
        blending: preset.blending,
        global: preset.global,
        highlights: preset.highlights,
        midtones: preset.midtones,
        shadows: preset.shadows,
      };
      return {
        ...prev,
        colorGrading,
        perceptualGradingV1: perceptualGradingFromWheelSurface(colorGrading),
        rawEngineEditGraphVersion: 2,
      };
    });
    setIsPresetMenuOpen(false);
    presetTriggerRef.current?.focus();
  };

  const handleRangeChange = (range: ColorGradingRange, newValue: HueSatLum) => {
    setAdjustments((prev) => {
      const colorGrading = {
        ...prev.colorGrading,
        [getColorGradingRangeEnum(range)]: newValue,
      };
      return {
        ...prev,
        colorGrading,
        perceptualGradingV1: perceptualGradingFromWheelSurface(colorGrading),
        rawEngineEditGraphVersion: 2,
      };
    });
  };

  const handleGlobalChange = (grading: ColorGrading, value: number) => {
    setAdjustments((prev) => {
      const colorGrading = {
        ...prev.colorGrading,
        [grading]: value,
      };
      return {
        ...prev,
        colorGrading,
        perceptualGradingV1: perceptualGradingFromWheelSurface(colorGrading),
        rawEngineEditGraphVersion: 2,
      };
    });
  };

  const handleResetAll = () => {
    setAdjustments((prev) => {
      const colorGrading = {
        balance: INITIAL_ADJUSTMENTS.colorGrading.balance,
        blending: INITIAL_ADJUSTMENTS.colorGrading.blending,
        global: { ...INITIAL_ADJUSTMENTS.colorGrading.global },
        highlights: { ...INITIAL_ADJUSTMENTS.colorGrading.highlights },
        midtones: { ...INITIAL_ADJUSTMENTS.colorGrading.midtones },
        shadows: { ...INITIAL_ADJUSTMENTS.colorGrading.shadows },
      };
      return {
        ...prev,
        colorGrading,
        perceptualGradingV1: perceptualGradingFromWheelSurface(colorGrading),
        rawEngineEditGraphVersion: 2,
      };
    });
  };

  const handlePresetMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(presetMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (options.length === 0) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsPresetMenuOpen(false);
      presetTriggerRef.current?.focus();
      return;
    }

    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < options.length - 1 ? currentIndex + 1 : 0;
    if (event.key === 'ArrowUp') nextIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      options[nextIndex]?.focus();
    }
  };

  return (
    <div className={density.card.panel} data-testid="color-grading-controls">
      <div className={cx(density.sectionHeader.root, 'mb-1')}>
        <UiText variant={TextVariants.heading} className={cx(density.sectionHeader.title, 'block')}>
          {t('adjustments.color.colorGrading')}
        </UiText>
        <div className={density.sectionHeader.compactActions}>
          <button
            aria-label={`${t('ui.colorWheel.reset')} ${t('adjustments.color.colorGrading')}`}
            className={cx(density.actionButton.base, density.actionButton.icon, density.actionButton.quiet)}
            data-tooltip={`${t('ui.colorWheel.reset')} ${t('adjustments.color.colorGrading')}`}
            disabled={!isToolModified}
            onClick={handleResetAll}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} />
          </button>
          <button
            aria-label={t('adjustments.color.toggleSliders')}
            aria-pressed={isExpanded}
            className={cx(
              density.actionButton.base,
              density.actionButton.icon,
              isExpanded ? density.actionButton.selectedQuiet : density.actionButton.quiet,
            )}
            data-state={isExpanded ? 'active' : 'idle'}
            data-tooltip={t('adjustments.color.toggleSliders')}
            onClick={() => {
              setIsExpanded((expanded) => !expanded);
            }}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" size={13} />
          </button>
        </div>
      </div>

      <div
        aria-label={t('adjustments.color.colorGrading')}
        className="grid min-h-7 grid-cols-[1.35fr_repeat(4,minmax(0,1fr))] gap-px rounded-sm border border-editor-border bg-editor-panel p-px"
        role="tablist"
      >
        {colorGradingViews.map((view) => {
          const isActive = activeView === view;
          const isModified =
            view === '3way'
              ? threeWayRangeKeys.some((range) => isColorGradingRangeModified(range, colorGrading[range]))
              : isColorGradingRangeModified(view, colorGrading[view]);
          const label = view === '3way' ? t('adjustments.color.grading.threeWayTab') : getRangeLabel(view);
          const shortLabel = view === '3way' ? '3-Way' : label.slice(0, 1);

          return (
            <button
              aria-label={label}
              aria-selected={isActive}
              className={cx(
                'relative min-w-0 rounded-sm px-1 text-[10px] font-semibold leading-6 text-text-secondary transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                isActive
                  ? 'bg-editor-selected-quiet text-editor-selected-quiet-text'
                  : 'hover:bg-editor-hover hover:text-text-primary',
              )}
              data-modified={isModified ? 'true' : 'false'}
              data-testid={`color-grading-view-${view}`}
              key={view}
              onClick={() => {
                setActiveView(view);
              }}
              role="tab"
              title={label}
              type="button"
            >
              <span className="block truncate">{shortLabel}</span>
              {isModified && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-editor-info"
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="relative mt-1">
        <button
          aria-controls={presetMenuId}
          aria-expanded={isPresetMenuOpen}
          aria-haspopup="listbox"
          className="flex h-7 w-full items-center justify-between gap-2 rounded-sm border border-editor-border bg-editor-matte px-2 text-left text-[11px] text-text-secondary transition-colors hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
          onClick={() => {
            setIsPresetMenuOpen((isOpen) => !isOpen);
          }}
          ref={presetTriggerRef}
          type="button"
        >
          <span className="min-w-0 truncate font-medium">{activePreset?.name ?? t('editor.presets.title')}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-text-tertiary">
            <span>{COLOR_GRADING_PRESETS.length}</span>
            <ChevronDown
              aria-hidden="true"
              className={cx('transition-transform motion-reduce:transition-none', isPresetMenuOpen && 'rotate-180')}
              size={13}
            />
          </span>
        </button>

        {isPresetMenuOpen && (
          <div
            aria-label={t('editor.presets.title')}
            className="absolute inset-x-0 top-8 z-20 max-h-56 overflow-y-auto rounded-sm border border-editor-border bg-editor-panel-raised p-1 shadow-lg"
            id={presetMenuId}
            onKeyDown={handlePresetMenuKeyDown}
            ref={presetMenuRef}
            role="listbox"
          >
            {COLOR_GRADING_PRESETS.map((preset) => {
              const categoryLabel = t(`adjustments.color.grading.presetCategories.${preset.category}`);
              const isActivePreset = activePresetId === preset.id;

              return (
                <button
                  aria-label={t('adjustments.color.grading.applyPreset', {
                    balance: preset.balance,
                    blending: preset.blending,
                    category: categoryLabel,
                    name: preset.name,
                  })}
                  aria-pressed={isActivePreset}
                  aria-selected={isActivePreset}
                  className={cx(
                    'grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-sm px-1.5 py-1 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                    isActivePreset
                      ? 'bg-editor-selected-quiet text-editor-selected-quiet-text'
                      : 'text-text-secondary hover:bg-editor-hover hover:text-text-primary',
                  )}
                  data-active={isActivePreset ? 'true' : 'false'}
                  data-testid="color-grading-preset-card"
                  key={preset.id}
                  onClick={() => {
                    handleApplyPreset(preset);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium text-text-primary">{preset.name}</span>
                    {isActivePreset && <Check aria-hidden="true" className="shrink-0 text-editor-info" size={12} />}
                  </span>
                  <span className="text-[9px] uppercase leading-3 text-text-tertiary">{categoryLabel}</span>
                  <span aria-hidden="true" className="mt-0.5 grid grid-cols-4 gap-0.5">
                    {colorGradingRangeKeys.map((key) => (
                      <span
                        className="h-1.5 rounded-sm border border-black/20"
                        data-testid={`color-grading-preset-swatch-${key}`}
                        key={key}
                        style={{ backgroundColor: getColorGradingSwatchColor(preset[key]) }}
                      />
                    ))}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] tabular-nums text-text-tertiary">
                    <span>{t('adjustments.color.grading.blendingValue', { value: preset.blending })}</span>
                    <span aria-hidden="true">/</span>
                    <span>{t('adjustments.color.grading.balanceValue', { value: preset.balance })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {activeView === '3way' && (
        <div className="mt-1 grid grid-cols-3 gap-1" data-testid="color-grading-three-way-summary">
          {threeWayRangeKeys.map((range) => {
            const value = colorGrading[range];
            const isActive = activeThreeWayRange === range;
            const isModified = isColorGradingRangeModified(range, value);

            return (
              <button
                aria-label={getRangeLabel(range)}
                aria-pressed={isActive}
                className={cx(
                  'min-w-0 rounded-sm border px-1 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                  isActive
                    ? 'border-editor-focus-ring bg-editor-selected-quiet'
                    : 'border-editor-border bg-editor-panel hover:bg-editor-hover',
                )}
                data-modified={isModified ? 'true' : 'false'}
                data-testid={`color-grading-summary-${range}`}
                key={range}
                onClick={() => {
                  setActiveThreeWayRange(range);
                }}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span
                    aria-hidden="true"
                    className={cx(
                      'h-2.5 w-2.5 shrink-0 rounded-full border',
                      isModified ? 'border-white/70 ring-1 ring-black/30' : 'border-editor-divider',
                    )}
                    style={{ backgroundColor: getColorGradingSwatchColor(value) }}
                  />
                  <span className="min-w-0 truncate text-[9px] font-semibold leading-3 text-text-secondary">
                    {getRangeLabel(range)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[8px] leading-3 tabular-nums text-text-tertiary">
                  H{Math.round(value.hue)} S{Math.round(value.saturation)} L{Math.round(value.luminance)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mx-auto mt-1.5 w-full max-w-[13rem]" data-active-range={activeRange}>
        <ColorWheel
          defaultValue={activeDefaultValue}
          isExpanded={isExpanded}
          label={getRangeLabel(activeRange)}
          onChange={(value) => {
            handleRangeChange(activeRange, value);
          }}
          onDragStateChange={onDragStateChange}
          value={activeValue}
        />
      </div>

      <div className="mt-1 border-t border-editor-border pt-1">
        <AdjustmentSlider
          defaultValue={INITIAL_ADJUSTMENTS.colorGrading.blending}
          density="compact"
          label={t('adjustments.color.grading.blending')}
          max={100}
          min={0}
          onDragStateChange={onDragStateChange}
          onValueChange={(value) => {
            handleGlobalChange(ColorGrading.Blending, value);
          }}
          step={1}
          testId="color-grading-blending"
          value={colorGrading.blending}
        />
        <AdjustmentSlider
          defaultValue={INITIAL_ADJUSTMENTS.colorGrading.balance}
          density="compact"
          label={t('adjustments.color.grading.balance')}
          max={100}
          min={-100}
          onDragStateChange={onDragStateChange}
          onValueChange={(value) => {
            handleGlobalChange(ColorGrading.Balance, value);
          }}
          step={1}
          testId="color-grading-balance"
          value={colorGrading.balance}
        />
      </div>
    </div>
  );
};
