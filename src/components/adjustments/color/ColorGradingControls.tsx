import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Sliders } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../../types/typography';
import { ColorGrading, type HueSatLum, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import { COLOR_GRADING_PRESETS } from '../../../utils/colorGradingPresets';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import ColorWheel from '../ColorWheel';
import type { ColorPanelGroupProps } from './types';

const colorGradingSwatchKeys = ['shadows', 'midtones', 'highlights', 'global'] as const;
type ColorGradingPreset = (typeof COLOR_GRADING_PRESETS)[number];

const getColorGradingSwatchColor = (value: HueSatLum) => {
  const saturation = Math.round(Math.min(88, Math.max(8, 30 + value.saturation * 0.55)));
  const lightness = Math.round(Math.min(78, Math.max(16, 46 + value.luminance * 0.35)));

  return `hsl(${Math.round(value.hue)} ${saturation}% ${lightness}%)`;
};

const areColorGradingWheelValuesEqual = (left: HueSatLum, right: HueSatLum) =>
  left.hue === right.hue && left.saturation === right.saturation && left.luminance === right.luminance;

const isColorGradingPresetApplied = (
  colorGrading: ColorPanelGroupProps['adjustments']['colorGrading'],
  preset: ColorGradingPreset,
): boolean =>
  colorGrading.balance === preset.balance &&
  colorGrading.blending === preset.blending &&
  colorGradingSwatchKeys.every((key) => areColorGradingWheelValuesEqual(colorGrading[key], preset[key]));

export const ColorGradingControls = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelGroupProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'3way' | 'global'>('3way');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPresetDrawerOpen, setIsPresetDrawerOpen] = useState(false);
  const colorGrading = adjustments.colorGrading;
  const activePresetId = useMemo(
    () => COLOR_GRADING_PRESETS.find((preset) => isColorGradingPresetApplied(colorGrading, preset))?.id ?? null,
    [colorGrading],
  );
  const activePreset = useMemo(
    () => COLOR_GRADING_PRESETS.find((preset) => preset.id === activePresetId) ?? null,
    [activePresetId],
  );

  const handleApplyPreset = (preset: (typeof COLOR_GRADING_PRESETS)[number]) => {
    setAdjustments((prev) => ({
      ...prev,
      colorGrading: {
        balance: preset.balance,
        blending: preset.blending,
        global: preset.global,
        highlights: preset.highlights,
        midtones: preset.midtones,
        shadows: preset.shadows,
      },
    }));
  };

  const handleChange = (grading: ColorGrading, newValue: HueSatLum) => {
    setAdjustments((prev) => ({
      ...prev,
      colorGrading: {
        ...prev.colorGrading,
        [grading]: newValue,
      },
    }));
  };

  const handleGlobalChange = (grading: ColorGrading, value: number) => {
    setAdjustments((prev) => ({
      ...prev,
      colorGrading: {
        ...prev.colorGrading,
        [grading]: value,
      },
    }));
  };

  const tabs = useMemo(
    () => [
      {
        id: '3way',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="6" r="4.5" />
            <circle cx="5" cy="18" r="4.5" />
            <circle cx="19" cy="18" r="4.5" />
          </svg>
        ),
      },
      {
        id: 'global',
        icon: (
          <div className="w-3.5 h-3.5 rounded-full" style={{ background: 'linear-gradient(to top, #666, #fff)' }} />
        ),
      },
    ],
    [],
  );

  return (
    <div className="p-2 bg-bg-tertiary rounded-md">
      <UiText variant={TextVariants.heading} className="mb-3">
        {t('adjustments.color.colorGrading')}
      </UiText>
      <div>
        <div className="flex items-center justify-start gap-2 mb-2 mt-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                aria-label={
                  tab.id === '3way'
                    ? t('adjustments.color.grading.threeWayTab')
                    : t('adjustments.color.grading.globalTab')
                }
                onClick={() => {
                  setActiveTab(tab.id as '3way' | 'global');
                }}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all focus:outline-none
                  ${
                    isActive
                      ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent text-text-primary'
                      : 'bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary/80'
                  }`}
                type="button"
              >
                {tab.icon}
              </button>
            );
          })}

          <div className="w-px h-5 bg-text-secondary/20 mx-1" />

          <button
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all focus:outline-none
              ${
                isExpanded
                  ? 'bg-accent text-button-text'
                  : 'bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary/80'
              }`}
            data-tooltip={t('adjustments.color.toggleSliders')}
            type="button"
          >
            <Sliders size={14} />
          </button>
        </div>

        <div className="mb-3 rounded-md border border-surface bg-bg-primary text-xs">
          <button
            aria-expanded={isPresetDrawerOpen}
            className="flex h-8 w-full items-center justify-between gap-2 px-2 text-left text-text-secondary transition-colors hover:text-text-primary"
            onClick={() => {
              setIsPresetDrawerOpen((isOpen) => !isOpen);
            }}
            type="button"
          >
            <span className="min-w-0 truncate font-medium">{activePreset?.name ?? t('editor.presets.title')}</span>
            <span className="flex shrink-0 items-center gap-2 text-[10px] text-text-tertiary">
              <span>{COLOR_GRADING_PRESETS.length}</span>
              <ChevronDown
                aria-hidden="true"
                className={`transition-all ${isPresetDrawerOpen ? 'rotate-180' : ''}`}
                size={14}
              />
            </span>
          </button>
          <AnimatePresence initial={false}>
            {isPresetDrawerOpen && (
              <motion.div
                animate={{ height: 'auto', opacity: 1 }}
                className="grid gap-1 border-t border-surface p-2"
                exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
                initial={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
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
                      className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded border px-2 py-1 text-left text-xs transition-colors hover:border-accent hover:text-text-primary ${
                        isActivePreset
                          ? 'border-accent bg-accent/10 text-text-primary ring-1 ring-accent/40'
                          : 'border-border bg-bg-secondary text-text-secondary hover:bg-surface'
                      }`}
                      data-active={isActivePreset ? 'true' : 'false'}
                      data-testid="color-grading-preset-card"
                      key={preset.id}
                      onClick={() => {
                        handleApplyPreset(preset);
                        setIsPresetDrawerOpen(false);
                      }}
                      type="button"
                    >
                      <span className="min-w-0 truncate font-semibold text-text-primary">{preset.name}</span>
                      <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal">
                        {categoryLabel}
                      </span>
                      <span aria-hidden="true" className="mt-1 grid grid-cols-4 gap-1">
                        {colorGradingSwatchKeys.map((key) => (
                          <span
                            className="h-2 rounded-full border border-black/10"
                            data-testid={`color-grading-preset-swatch-${key}`}
                            key={key}
                            style={{ backgroundColor: getColorGradingSwatchColor(preset[key]) }}
                          />
                        ))}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[10px] font-medium text-text-secondary">
                        <span>{t('adjustments.color.grading.blendingValue', { value: preset.blending })}</span>
                        <span className="h-1 w-1 rounded-full bg-text-secondary/40" aria-hidden="true" />
                        <span>{t('adjustments.color.grading.balanceValue', { value: preset.balance })}</span>
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative w-full mb-3">
          <AnimatePresence mode="wait">
            {activeTab === '3way' ? (
              <motion.div
                key="3way"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                <div className="flex justify-center mb-3">
                  <div className="w-[calc(50%-0.5rem)] min-w-0">
                    <ColorWheel
                      defaultValue={INITIAL_ADJUSTMENTS.colorGrading.midtones}
                      label={t('adjustments.color.grading.midtones')}
                      onChange={(val: HueSatLum) => {
                        handleChange(ColorGrading.Midtones, val);
                      }}
                      value={colorGrading.midtones}
                      onDragStateChange={onDragStateChange}
                      isExpanded={isExpanded}
                    />
                  </div>
                </div>
                <div className="flex justify-between mb-1 gap-3">
                  <div className="w-full flex-1 min-w-0">
                    <ColorWheel
                      defaultValue={INITIAL_ADJUSTMENTS.colorGrading.shadows}
                      label={t('adjustments.color.grading.shadows')}
                      onChange={(val: HueSatLum) => {
                        handleChange(ColorGrading.Shadows, val);
                      }}
                      value={colorGrading.shadows}
                      onDragStateChange={onDragStateChange}
                      isExpanded={isExpanded}
                    />
                  </div>
                  <div className="w-full flex-1 min-w-0">
                    <ColorWheel
                      defaultValue={INITIAL_ADJUSTMENTS.colorGrading.highlights}
                      label={t('adjustments.color.grading.highlights')}
                      onChange={(val: HueSatLum) => {
                        handleChange(ColorGrading.Highlights, val);
                      }}
                      value={colorGrading.highlights}
                      onDragStateChange={onDragStateChange}
                      isExpanded={isExpanded}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="global"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                transition={{ duration: 0.2 }}
                className="w-full flex justify-center pb-1"
              >
                <div className="w-full max-w-70">
                  <ColorWheel
                    defaultValue={INITIAL_ADJUSTMENTS.colorGrading.global}
                    label={t('adjustments.color.grading.global')}
                    onChange={(val: HueSatLum) => {
                      handleChange(ColorGrading.Global, val);
                    }}
                    value={colorGrading.global}
                    onDragStateChange={onDragStateChange}
                    isExpanded={isExpanded}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <AdjustmentSlider
            defaultValue={50}
            label={t('adjustments.color.grading.blending')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleGlobalChange(ColorGrading.Blending, value);
            }}
            step={1}
            value={colorGrading.blending}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            defaultValue={0}
            label={t('adjustments.color.grading.balance')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleGlobalChange(ColorGrading.Balance, value);
            }}
            step={1}
            value={colorGrading.balance}
            onDragStateChange={onDragStateChange}
          />
        </div>
      </div>
    </div>
  );
};
