import { motion, AnimatePresence } from 'framer-motion';
import { Pipette, Sliders } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AdjustmentSlider from './AdjustmentSlider';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import {
  type Adjustments,
  ColorAdjustment,
  type ColorCalibration,
  ColorGrading,
  DEFAULT_PARAMETRIC_CURVE,
  type HueSatLum,
  INITIAL_ADJUSTMENTS,
} from '../../utils/adjustments';
import { COLOR_GRADING_PRESETS } from '../../utils/colorGradingPresets';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../utils/profileTonePresets';
import { getSelectiveColorRange, SELECTIVE_COLOR_RANGES } from '../../utils/selectiveColorRanges';
import ColorWheel from '../ui/ColorWheel';
import UiText from '../ui/Text';

import type { BlackWhiteMixerChannel } from '../../schemas/blackWhiteMixerSchemas';
import type { ChannelMixerOutput, ChannelMixerSource } from '../../schemas/channelMixerSchemas';
import type { ColorBalanceRgbChannel, ColorBalanceRgbRange } from '../../schemas/colorBalanceRgbSchemas';
import type { CameraProfileId, ToneCurveId } from '../../schemas/profileToneSchemas';
import type { AppSettings } from '../ui/AppProperties';

interface ColorProps {
  color: string;
  name: BlackWhiteMixerChannel;
  label: string;
}

interface ColorPanelProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  isWbPickerActive?: boolean;
  toggleWbPicker?: () => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);
type LevelsNumericKey = Exclude<keyof Adjustments['levels'], 'enabled'>;

const colorGradingSwatchKeys = ['shadows', 'midtones', 'highlights', 'global'] as const;
type ColorGradingPreset = (typeof COLOR_GRADING_PRESETS)[number];

const getColorGradingSwatchColor = (value: HueSatLum) => {
  const saturation = Math.round(Math.min(88, Math.max(8, 30 + value.saturation * 0.55)));
  const lightness = Math.round(Math.min(78, Math.max(16, 46 + value.luminance * 0.35)));

  return `hsl(${Math.round(value.hue)} ${saturation}% ${lightness}%)`;
};

const areColorGradingWheelValuesEqual = (left: HueSatLum, right: HueSatLum) =>
  left.hue === right.hue && left.saturation === right.saturation && left.luminance === right.luminance;

const isColorGradingPresetApplied = (colorGrading: Adjustments['colorGrading'], preset: ColorGradingPreset): boolean =>
  colorGrading.balance === preset.balance &&
  colorGrading.blending === preset.blending &&
  colorGradingSwatchKeys.every((key) => areColorGradingWheelValuesEqual(colorGrading[key], preset[key]));

const colorRuntimeStatusItems = [
  ['gpuLabel', 'previewExport'],
  ['apiLabel', 'typed'],
  ['uiLabel', 'proofed'],
] as const;
type RuntimeStatusKey = (typeof colorRuntimeStatusItems)[number][number] | 'ariaLabel';
const runtimeStatusKey = (key: RuntimeStatusKey) => `adjustments.color.runtimeStatus.${key}` as const;

const ColorRuntimeStatusRail = () => {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t(runtimeStatusKey('ariaLabel'))}
      className="grid grid-cols-3 gap-1 rounded-md border border-border bg-bg-tertiary p-1"
      data-testid="color-runtime-status-rail"
    >
      {colorRuntimeStatusItems.map(([labelKey, stateKey]) => {
        const state = t(runtimeStatusKey(stateKey));

        return (
          <div className="min-w-0 rounded bg-bg-secondary px-2 py-1" key={labelKey}>
            <div className="truncate text-[10px] font-semibold uppercase tracking-normal text-text-secondary">
              {t(runtimeStatusKey(labelKey))}
            </div>
            <div className="truncate text-xs font-medium text-text-primary">{state}</div>
          </div>
        );
      })}
    </div>
  );
};

const formatPercent = (value: number) => `${String(value)}%`;
const CAMERA_PROFILE_IDS = [
  'camera_standard',
  'camera_neutral',
  'camera_portrait',
  'camera_landscape',
  'linear_raw',
] satisfies Array<CameraProfileId>;
const TONE_CURVE_IDS = [
  'auto_filmic',
  'linear',
  'soft_contrast',
  'high_contrast',
  'shadow_lift',
] satisfies Array<ToneCurveId>;

const parseCameraProfileId = (value: string): CameraProfileId =>
  CAMERA_PROFILE_IDS.find((cameraProfile) => cameraProfile === value) ?? 'camera_standard';

const parseToneCurveId = (value: string): ToneCurveId =>
  TONE_CURVE_IDS.find((toneCurve) => toneCurve === value) ?? 'auto_filmic';

interface ColorSwatchProps<T extends string> {
  color: string;
  isActive: boolean;
  name: T;
  ariaLabel: string;
  testId?: string;
  onClick: (name: T) => void;
}

const ColorSwatch = <T extends string>({ color, name, isActive, ariaLabel, testId, onClick }: ColorSwatchProps<T>) => {
  const [isPressed, setIsPressed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseDown = () => {
    setIsPressed(true);
  };

  const handleMouseUp = () => {
    setIsPressed(false);
  };

  const handleMouseLeave = () => {
    setIsPressed(false);
    setIsHovered(false);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleClick = () => {
    onClick(name);
  };

  const getTransform = () => {
    if (isPressed) return 'scale(0.95)';
    if (isActive) return 'scale(1.1)';
    if (isHovered) return 'scale(1.08)';
    return 'scale(1)';
  };

  return (
    <button
      aria-label={ariaLabel}
      className="relative w-6 h-6 focus:outline-hidden group"
      data-testid={testId}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
    >
      <div
        className={`absolute inset-0 rounded-full border-2 transition-all duration-200 ease-out ${
          isActive ? 'border-white opacity-100' : 'scale-100 border-transparent opacity-0'
        }`}
        style={{
          transform: isActive ? (isPressed ? 'scale(1.1)' : 'scale(1.25)') : undefined,
          transition: isPressed
            ? 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease-out'
            : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease-out',
        }}
      />

      <div
        className={`absolute inset-0 rounded-full transition-all duration-150 ease-out ${
          isActive ? 'shadow-lg' : 'shadow-md'
        }`}
        style={{
          backgroundColor: color,
          transform: getTransform(),
          transition: isPressed
            ? 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)'
            : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </button>
  );
};

const ColorGradingPanel = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'3way' | 'global'>('3way');
  const [isExpanded, setIsExpanded] = useState(false);
  const colorGrading = adjustments.colorGrading;
  const activePresetId = useMemo(
    () => COLOR_GRADING_PRESETS.find((preset) => isColorGradingPresetApplied(colorGrading, preset))?.id ?? null,
    [colorGrading],
  );

  const handleApplyPreset = (preset: (typeof COLOR_GRADING_PRESETS)[number]) => {
    setAdjustments((prev: Adjustments) => ({
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
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      colorGrading: {
        ...prev.colorGrading,
        [grading]: newValue,
      },
    }));
  };

  const handleGlobalChange = (grading: ColorGrading, value: number) => {
    setAdjustments((prev: Adjustments) => ({
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
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
    <div>
      <div className="flex items-center justify-start gap-2 mb-4 mt-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as '3way' | 'global');
              }}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all focus:outline-none
                ${
                  isActive
                    ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent text-text-primary'
                    : 'bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary/80'
                }`}
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
        >
          <Sliders size={14} />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2">
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
              className={`rounded-md border px-2.5 py-2 text-left text-xs transition-colors hover:border-accent hover:text-text-primary ${
                isActivePreset
                  ? 'border-accent bg-accent/10 text-text-primary ring-1 ring-accent/40'
                  : 'border-border bg-bg-secondary text-text-secondary hover:bg-surface'
              }`}
              data-active={isActivePreset ? 'true' : 'false'}
              data-testid="color-grading-preset-card"
              key={preset.id}
              onClick={() => {
                handleApplyPreset(preset);
              }}
              type="button"
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate font-semibold text-text-primary">{preset.name}</span>
                <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal">
                  {categoryLabel}
                </span>
              </span>
              <span aria-hidden="true" className="mt-2 grid grid-cols-4 gap-1">
                {colorGradingSwatchKeys.map((key) => (
                  <span
                    className="h-2 rounded-full border border-black/10"
                    data-testid={`color-grading-preset-swatch-${key}`}
                    key={key}
                    style={{ backgroundColor: getColorGradingSwatchColor(preset[key]) }}
                  />
                ))}
              </span>
              <span className="mt-2 flex items-center gap-2 text-[10px] font-medium text-text-secondary">
                <span>{t('adjustments.color.grading.blendingValue', { value: preset.blending })}</span>
                <span className="h-1 w-1 rounded-full bg-text-secondary/40" aria-hidden="true" />
                <span>{t('adjustments.color.grading.balanceValue', { value: preset.balance })}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative w-full mb-4">
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
              <div className="flex justify-center mb-4">
                <div className="w-[calc(50%-0.5rem)]">
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
              <div className="flex justify-between mb-2 gap-4">
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
              className="w-full flex justify-center pb-2"
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
  );
};

const ColorCalibrationPanel = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelProps) => {
  const { t } = useTranslation();
  const [activePrimary, setActivePrimary] = useState('red');
  const colorCalibration = adjustments.colorCalibration;

  const PRIMARY_COLORS = useMemo(
    () => [
      { name: 'red', color: '#f87171', label: t('adjustments.color.calibration.colors.red') },
      { name: 'green', color: '#4ade80', label: t('adjustments.color.calibration.colors.green') },
      { name: 'blue', color: '#60a5fa', label: t('adjustments.color.calibration.colors.blue') },
    ],
    [t],
  );

  const handleShadowsChange = (value: number) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      colorCalibration: {
        ...prev.colorCalibration,
        shadowsTint: value,
      },
    }));
  };

  const handlePrimaryChange = (key: 'Hue' | 'Saturation', value: number) => {
    const fullKey = `${activePrimary}${key}` as keyof ColorCalibration;
    setAdjustments((prev: Adjustments) => ({
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
          {PRIMARY_COLORS.map(({ name, color, label }) => (
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

export default function ColorPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  isWbPickerActive = false,
  toggleWbPicker,
  onDragStateChange,
}: ColorPanelProps) {
  const { t } = useTranslation();
  const [activeColor, setActiveColor] = useState<BlackWhiteMixerChannel>('reds');
  const [activeColorBalanceRange, setActiveColorBalanceRange] = useState<ColorBalanceRgbRange>('midtones');
  const [activeChannelMixerOutput, setActiveChannelMixerOutput] = useState<ChannelMixerOutput>('red');
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;

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
  const cameraProfileOptions = useMemo(
    () =>
      [
        { key: 'camera_standard', label: t('adjustments.color.profileTone.cameraProfiles.camera_standard') },
        { key: 'camera_neutral', label: t('adjustments.color.profileTone.cameraProfiles.camera_neutral') },
        { key: 'camera_portrait', label: t('adjustments.color.profileTone.cameraProfiles.camera_portrait') },
        { key: 'camera_landscape', label: t('adjustments.color.profileTone.cameraProfiles.camera_landscape') },
        { key: 'linear_raw', label: t('adjustments.color.profileTone.cameraProfiles.linear_raw') },
      ] satisfies Array<{ key: CameraProfileId; label: string }>,
    [t],
  );
  const toneCurveOptions = useMemo(
    () =>
      [
        { key: 'auto_filmic', label: t('adjustments.color.profileTone.toneCurves.auto_filmic') },
        { key: 'linear', label: t('adjustments.color.profileTone.toneCurves.linear') },
        { key: 'soft_contrast', label: t('adjustments.color.profileTone.toneCurves.soft_contrast') },
        { key: 'high_contrast', label: t('adjustments.color.profileTone.toneCurves.high_contrast') },
        { key: 'shadow_lift', label: t('adjustments.color.profileTone.toneCurves.shadow_lift') },
      ] satisfies Array<{ key: ToneCurveId; label: string }>,
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
  const baseHue = activeSelectiveColorRange.centerHueDegrees;
  const activeSelectiveColorRangeLabel = t(activeSelectiveColorRange.labelKey);
  const activeSelectiveColorRangeCenter = `${Math.round(activeSelectiveColorRange.centerHueDegrees)}°`;
  const activeSelectiveColorRangeWidth = `${Math.round(activeSelectiveColorRange.widthDegrees)}°`;
  const effectiveHue = baseHue + (currentHsl.hue || 0);
  const levels = adjustments.levels;
  const inputBlackMax = Math.max(0, Math.min(99, Math.round(levels.inputWhite * 100) - 1));
  const inputWhiteMin = Math.min(100, Math.max(1, Math.round(levels.inputBlack * 100) + 1));
  const outputBlackMax = Math.max(0, Math.min(99, Math.round(levels.outputWhite * 100) - 1));
  const outputWhiteMin = Math.min(100, Math.max(1, Math.round(levels.outputBlack * 100) + 1));
  const levelsClippingWarnings = [
    levels.inputBlack > 0 ? t('adjustments.color.levels.warnings.shadowClipping') : null,
    levels.inputWhite < 1 ? t('adjustments.color.levels.warnings.highlightClipping') : null,
    levels.outputBlack > 0 || levels.outputWhite < 1 ? t('adjustments.color.levels.warnings.outputCompression') : null,
  ].filter((warning): warning is string => warning !== null);

  useEffect(() => {
    const normalizedHue = ((effectiveHue % 360) + 360) % 360;
    const effectiveSaturation = (currentHsl.saturation + 100) / 2;

    document.documentElement.style.setProperty(`--hsl-mixer-hue-${activeColor}`, normalizedHue.toString());
    document.documentElement.style.setProperty(`--hsl-mixer-sat-${activeColor}`, formatPercent(effectiveSaturation));
  }, [effectiveHue, currentHsl.saturation, activeColor]);

  const handleGlobalChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: value }));
  };

  const handleHslChange = (key: ColorAdjustment, value: number) => {
    setAdjustments((prev: Adjustments) => ({
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

  const handleBlackWhiteToggle = () => {
    setAdjustments((prev: Adjustments) => {
      const current = prev.blackWhiteMixer;

      return {
        ...prev,
        blackWhiteMixer: {
          ...current,
          enabled: !current.enabled,
        },
      };
    });
  };

  const handleBlackWhiteWeightChange = (value: number) => {
    setAdjustments((prev: Adjustments) => {
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
    setAdjustments((prev: Adjustments) => {
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
    setAdjustments((prev: Adjustments) => {
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
    setAdjustments((prev: Adjustments) => {
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
    setAdjustments((prev: Adjustments) => {
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
    setAdjustments((prev: Adjustments) => {
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
    setAdjustments((prev: Adjustments) => {
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

  const handleCameraProfileChange = (cameraProfile: CameraProfileId) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      cameraProfile,
    }));
  };

  const handleToneCurveChange = (toneCurve: ToneCurveId) => {
    setAdjustments((prev: Adjustments) => {
      const currentParametricCurve =
        prev.parametricCurve || INITIAL_ADJUSTMENTS.parametricCurve || DEFAULT_PARAMETRIC_CURVE;

      return {
        ...prev,
        curveMode: 'parametric',
        parametricCurve: {
          ...currentParametricCurve,
          luma: { ...TONE_CURVE_PARAMETRIC_PRESETS[toneCurve] },
        },
        toneCurve,
      };
    });
  };

  const handleLevelsToggle = () => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      levels: {
        ...prev.levels,
        enabled: !prev.levels.enabled,
      },
    }));
  };

  const handleLevelsChange = (key: LevelsNumericKey, value: number) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      levels: {
        ...prev.levels,
        [key]: value,
      },
    }));
  };

  const hue_slider = `hue-slider-${activeColor}`;
  const saturation_slider = `sat-slider-${activeColor}`;
  const luminance_slider = `lum-slider-${activeColor}`;

  return (
    <div className="space-y-4">
      {!isForMask && <ColorRuntimeStatusRail />}
      {!isForMask &&
        (adjustmentVisibility[ColorAdjustment.CameraProfile] !== false ||
          adjustmentVisibility[ColorAdjustment.ToneCurve] !== false) && (
          <div className="p-2 bg-bg-tertiary rounded-md">
            <UiText variant={TextVariants.heading} className="mb-3">
              {t('adjustments.color.profileTone.title')}
            </UiText>
            {adjustmentVisibility[ColorAdjustment.CameraProfile] !== false && (
              <div className="mb-3">
                <UiText variant={TextVariants.label} color={TextColors.secondary} className="mb-2 block">
                  {t('adjustments.color.profileTone.cameraProfile')}
                </UiText>
                <select
                  className="w-full rounded bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                  onChange={(event) => {
                    handleCameraProfileChange(parseCameraProfileId(event.target.value));
                  }}
                  value={adjustments.cameraProfile}
                >
                  {cameraProfileOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {adjustmentVisibility[ColorAdjustment.ToneCurve] !== false && (
              <div>
                <UiText variant={TextVariants.label} color={TextColors.secondary} className="mb-2 block">
                  {t('adjustments.color.profileTone.toneCurve')}
                </UiText>
                <select
                  className="w-full rounded bg-bg-secondary px-2 py-1 text-xs text-text-primary"
                  onChange={(event) => {
                    handleToneCurveChange(parseToneCurveId(event.target.value));
                  }}
                  value={adjustments.toneCurve}
                >
                  {toneCurveOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

      {!isForMask && adjustmentVisibility[ColorAdjustment.Levels] !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <div className="flex items-center justify-between gap-2 mb-3">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.levels.title')}</UiText>
            <button
              className={`px-2 py-1 rounded text-xs transition-colors ${
                levels.enabled ? 'bg-accent text-button-text' : 'bg-bg-secondary text-text-secondary hover:bg-surface'
              }`}
              onClick={handleLevelsToggle}
              type="button"
            >
              {levels.enabled ? t('adjustments.color.levels.enabled') : t('adjustments.color.levels.disabled')}
            </button>
          </div>
          <AdjustmentSlider
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

      <div className="p-2 bg-bg-tertiary rounded-md">
        <div className="flex justify-between items-center mb-2">
          <UiText variant={TextVariants.heading}>{t('adjustments.color.whiteBalance')}</UiText>
          {!isForMask && toggleWbPicker && (
            <button
              onClick={toggleWbPicker}
              disabled={isWgpuEnabled}
              className={`p-1.5 rounded-md transition-colors ${
                isWgpuEnabled
                  ? 'cursor-not-allowed text-text-secondary hover:bg-transparent'
                  : isWbPickerActive
                    ? 'bg-accent text-button-text'
                    : 'hover:bg-bg-secondary text-text-secondary'
              }`}
              data-tooltip={
                isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
              }
            >
              <Pipette size={16} />
            </button>
          )}
        </div>
        <AdjustmentSlider
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
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <UiText variant={TextVariants.heading} className="mb-2">
          {t('adjustments.color.presence')}
        </UiText>
        <AdjustmentSlider
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
      </div>

      {!isForMask && adjustmentVisibility[ColorAdjustment.BlackWhiteMixer] !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <div className="mb-3 flex items-center justify-between gap-3">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.blackWhiteMixer.title')}</UiText>
            <button
              aria-pressed={blackWhiteMixer.enabled}
              className={`rounded px-2 py-1 text-xs font-medium ${
                blackWhiteMixer.enabled ? 'bg-accent text-button-text' : 'bg-bg-secondary text-text-secondary'
              }`}
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

      <div className="p-2 bg-bg-tertiary rounded-md">
        <UiText variant={TextVariants.heading} className="mb-3">
          {t('adjustments.color.colorGrading')}
        </UiText>
        <ColorGradingPanel
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          appSettings={appSettings}
          onDragStateChange={onDragStateChange}
        />
      </div>

      <div
        className="p-2 bg-bg-tertiary rounded-md"
        data-active-range={activeColor}
        data-command-type="toneColor.adjustHsl"
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

      {!isForMask && adjustmentVisibility['colorCalibration'] !== false && (
        <ColorCalibrationPanel
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          appSettings={appSettings}
          onDragStateChange={onDragStateChange}
        />
      )}
    </div>
  );
}
