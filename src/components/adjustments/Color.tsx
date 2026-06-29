import { motion, AnimatePresence } from 'framer-motion';
import { Pipette, RotateCcw, Sliders } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AdjustmentSlider from './AdjustmentSlider';
import { useEditorStore } from '../../store/useEditorStore';
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
import { formatGamutWarningCoverage } from '../../utils/gamutWarningDisplay';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../utils/profileTonePresets';
import { getSelectiveColorRange, SELECTIVE_COLOR_RANGES } from '../../utils/selectiveColorRanges';
import {
  applySelectiveColorToRgbPixel,
  renderSelectiveColorMaskPreviewPixel,
  type RgbPixel,
} from '../../utils/selectiveColorRuntime';
import { applySkinToneUniformity, type SkinToneUniformityInput } from '../../utils/skinToneUniformity';
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
type SelectiveColorPreviewMode = 'adjusted' | 'mask';

const getColorGradingSwatchColor = (value: HueSatLum) => {
  const saturation = Math.round(Math.min(88, Math.max(8, 30 + value.saturation * 0.55)));
  const lightness = Math.round(Math.min(78, Math.max(16, 46 + value.luminance * 0.35)));

  return `hsl(${Math.round(value.hue)} ${saturation}% ${lightness}%)`;
};

const areColorGradingWheelValuesEqual = (left: HueSatLum, right: HueSatLum) =>
  left.hue === right.hue && left.saturation === right.saturation && left.luminance === right.luminance;

const hexColorToRgbPixel = (hexColor: string): RgbPixel => ({
  blue: Number.parseInt(hexColor.slice(5, 7), 16) / 255,
  green: Number.parseInt(hexColor.slice(3, 5), 16) / 255,
  red: Number.parseInt(hexColor.slice(1, 3), 16) / 255,
});

const rgbPixelToCssColor = ({ blue, green, red }: RgbPixel): string =>
  `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;

const formatSelectiveColorProofRgb = (pixel: RgbPixel): string =>
  [pixel.red, pixel.green, pixel.blue].map((channel) => channel.toFixed(3)).join(',');

const skinToneInspectorSample: SkinToneUniformityInput = {
  hueDegrees: 18,
  luminance: 0.5,
  saturation: 0.45,
};

const skinToneTargetDistance = (
  input: SkinToneUniformityInput,
  settings: Pick<Adjustments['skinToneUniformity'], 'targetHueDegrees' | 'targetLuminance' | 'targetSaturation'>,
): number => {
  const hueDelta = Math.abs((((settings.targetHueDegrees - input.hueDegrees + 540) % 360) - 180) / 180);
  return (
    hueDelta +
    Math.abs(settings.targetLuminance - input.luminance) +
    Math.abs(settings.targetSaturation - input.saturation)
  );
};

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
type ProfessionalColorRecipeLabelKey =
  | 'adjustments.color.workflowRecipes.cleanPortrait'
  | 'adjustments.color.workflowRecipes.landscapeDepth'
  | 'adjustments.color.workflowRecipes.neutralProduct';
type ProfessionalColorRecipeDescriptionKey =
  | 'adjustments.color.workflowRecipes.cleanPortraitDescription'
  | 'adjustments.color.workflowRecipes.landscapeDepthDescription'
  | 'adjustments.color.workflowRecipes.neutralProductDescription';

interface ProfessionalColorRecipe {
  activeColorRange: BlackWhiteMixerChannel;
  cameraProfile: CameraProfileId;
  channelMixer: Adjustments['channelMixer'];
  colorBalanceRgb: Adjustments['colorBalanceRgb'];
  colorGrading: Adjustments['colorGrading'];
  descriptionKey: ProfessionalColorRecipeDescriptionKey;
  hsl: Partial<Record<BlackWhiteMixerChannel, HueSatLum>>;
  id: 'cleanPortrait' | 'landscapeDepth' | 'neutralProduct';
  labelKey: ProfessionalColorRecipeLabelKey;
  levels: Adjustments['levels'];
  saturation: number;
  temperature: number;
  tint: number;
  toneCurve: ToneCurveId;
  vibrance: number;
}

const professionalColorRecipes = [
  {
    activeColorRange: 'oranges',
    cameraProfile: 'camera_portrait',
    channelMixer: {
      blue: { blue: 96, constant: 0, green: 4, red: 0 },
      enabled: true,
      green: { blue: 0, constant: 0, green: 102, red: -2 },
      preserveLuminance: true,
      red: { blue: 0, constant: 0, green: -2, red: 102 },
    },
    colorBalanceRgb: {
      enabled: true,
      highlights: { blue: -5, green: 1, red: 4 },
      midtones: { blue: -3, green: 0, red: 3 },
      preserveLuminance: true,
      shadows: { blue: 2, green: 0, red: -1 },
    },
    colorGrading: {
      balance: 18,
      blending: 62,
      global: { hue: 35, saturation: 2, luminance: 0 },
      highlights: { hue: 45, saturation: 5, luminance: 0 },
      midtones: { hue: 32, saturation: 7, luminance: 1 },
      shadows: { hue: 225, saturation: 2, luminance: 0 },
    },
    descriptionKey: 'adjustments.color.workflowRecipes.cleanPortraitDescription',
    hsl: {
      oranges: { hue: -2, luminance: 4, saturation: 8 },
      reds: { hue: 0, luminance: 2, saturation: -4 },
      yellows: { hue: -4, luminance: 1, saturation: -5 },
    },
    id: 'cleanPortrait',
    labelKey: 'adjustments.color.workflowRecipes.cleanPortrait',
    levels: { enabled: true, gamma: 1.02, inputBlack: 0.005, inputWhite: 0.995, outputBlack: 0, outputWhite: 1 },
    saturation: -2,
    temperature: 6,
    tint: 3,
    toneCurve: 'soft_contrast',
    vibrance: 12,
  },
  {
    activeColorRange: 'blues',
    cameraProfile: 'camera_landscape',
    channelMixer: {
      blue: { blue: 103, constant: 0, green: 3, red: 0 },
      enabled: true,
      green: { blue: 0, constant: 0, green: 100, red: 0 },
      preserveLuminance: true,
      red: { blue: 0, constant: 0, green: -3, red: 105 },
    },
    colorBalanceRgb: {
      enabled: true,
      highlights: { blue: -2, green: 1, red: 2 },
      midtones: { blue: 0, green: 0, red: 0 },
      preserveLuminance: true,
      shadows: { blue: 6, green: 0, red: -3 },
    },
    colorGrading: {
      balance: -12,
      blending: 48,
      global: { hue: 210, saturation: 1, luminance: 0 },
      highlights: { hue: 55, saturation: 4, luminance: 1 },
      midtones: { hue: 185, saturation: 3, luminance: 0 },
      shadows: { hue: 218, saturation: 8, luminance: -3 },
    },
    descriptionKey: 'adjustments.color.workflowRecipes.landscapeDepthDescription',
    hsl: {
      aquas: { hue: -4, luminance: 0, saturation: 10 },
      blues: { hue: -2, luminance: -3, saturation: 12 },
      greens: { hue: 3, luminance: -2, saturation: 8 },
    },
    id: 'landscapeDepth',
    labelKey: 'adjustments.color.workflowRecipes.landscapeDepth',
    levels: { enabled: true, gamma: 0.95, inputBlack: 0.01, inputWhite: 0.99, outputBlack: 0, outputWhite: 1 },
    saturation: 4,
    temperature: -2,
    tint: -1,
    toneCurve: 'high_contrast',
    vibrance: 18,
  },
  {
    activeColorRange: 'reds',
    cameraProfile: 'camera_neutral',
    channelMixer: {
      blue: { blue: 100, constant: 0, green: 0, red: 0 },
      enabled: false,
      green: { blue: 0, constant: 0, green: 100, red: 0 },
      preserveLuminance: true,
      red: { blue: 0, constant: 0, green: 0, red: 100 },
    },
    colorBalanceRgb: {
      enabled: true,
      highlights: { blue: 0, green: 0, red: 0 },
      midtones: { blue: -1, green: 0, red: 1 },
      preserveLuminance: true,
      shadows: { blue: 1, green: 0, red: -1 },
    },
    colorGrading: {
      balance: 0,
      blending: 35,
      global: { hue: 0, saturation: 0, luminance: 0 },
      highlights: { hue: 45, saturation: 1, luminance: 0 },
      midtones: { hue: 0, saturation: 0, luminance: 0 },
      shadows: { hue: 220, saturation: 1, luminance: 0 },
    },
    descriptionKey: 'adjustments.color.workflowRecipes.neutralProductDescription',
    hsl: {
      reds: { hue: 0, luminance: 0, saturation: -2 },
      yellows: { hue: 0, luminance: 0, saturation: -2 },
    },
    id: 'neutralProduct',
    labelKey: 'adjustments.color.workflowRecipes.neutralProduct',
    levels: { enabled: true, gamma: 1.03, inputBlack: 0, inputWhite: 1, outputBlack: 0.01, outputWhite: 0.99 },
    saturation: 0,
    temperature: 0,
    tint: 0,
    toneCurve: 'soft_contrast',
    vibrance: 4,
  },
] satisfies Array<ProfessionalColorRecipe>;

const areHueSatLumValuesEqual = (left: HueSatLum | undefined, right: HueSatLum) =>
  left?.hue === right.hue && left.saturation === right.saturation && left.luminance === right.luminance;

const isProfessionalColorRecipeApplied = (adjustments: Adjustments, recipe: ProfessionalColorRecipe) =>
  adjustments.cameraProfile === recipe.cameraProfile &&
  adjustments.toneCurve === recipe.toneCurve &&
  adjustments.temperature === recipe.temperature &&
  adjustments.tint === recipe.tint &&
  adjustments.vibrance === recipe.vibrance &&
  adjustments.saturation === recipe.saturation &&
  adjustments.levels.enabled === recipe.levels.enabled &&
  adjustments.levels.gamma === recipe.levels.gamma &&
  adjustments.levels.inputBlack === recipe.levels.inputBlack &&
  adjustments.levels.inputWhite === recipe.levels.inputWhite &&
  adjustments.levels.outputBlack === recipe.levels.outputBlack &&
  adjustments.levels.outputWhite === recipe.levels.outputWhite &&
  Object.entries(recipe.hsl).every(([range, value]) => areHueSatLumValuesEqual(adjustments.hsl[range], value));

const ColorRuntimeStatusRail = () => {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t(runtimeStatusKey('ariaLabel'))}
      className="grid grid-cols-2 gap-1 rounded-md border border-border bg-bg-tertiary p-1"
      data-testid="color-runtime-status-rail"
    >
      {colorRuntimeStatusItems.map(([labelKey, stateKey]) => {
        const state = t(runtimeStatusKey(stateKey));

        return (
          <div className="min-w-0 rounded bg-bg-secondary px-2 py-1" key={labelKey}>
            <div className="text-[10px] font-semibold uppercase leading-tight tracking-normal text-text-secondary">
              {t(runtimeStatusKey(labelKey))}
            </div>
            <div className="mt-0.5 text-xs font-medium leading-tight text-text-primary">{state}</div>
          </div>
        );
      })}
    </div>
  );
};

const ColorWorkflowReadinessRail = () => {
  const { t } = useTranslation();
  const readinessItems = [
    { key: 'profile-tone', label: t('adjustments.color.profileTone.title') },
    { key: 'rgb-balance', label: t('adjustments.color.colorBalanceRgb.title') },
    { key: 'channel-mixer', label: t('adjustments.color.channelMixer.title') },
    { key: 'selective-color', label: t('adjustments.color.colorMixer') },
    { key: 'grading', label: t('adjustments.color.colorGrading') },
  ] as const;

  return (
    <div
      className="grid gap-1 rounded-md border border-border bg-bg-tertiary p-1"
      data-channel-mixer-ready="true"
      data-color-balance-ready="true"
      data-grading-ready="true"
      data-profile-tone-ready="true"
      data-selective-color-ready="true"
      data-testid="professional-color-workflow-readiness"
    >
      {readinessItems.map((item) => (
        <div
          className="min-w-0 rounded bg-bg-secondary px-2 py-1"
          data-testid="professional-color-readiness-item"
          key={item.key}
        >
          <div className="text-[10px] font-semibold uppercase leading-tight tracking-normal text-text-secondary">
            {item.label}
          </div>
          <div className="mt-0.5 text-xs font-medium leading-tight text-text-primary">
            {t(runtimeStatusKey('proofed'))}
          </div>
        </div>
      ))}
    </div>
  );
};

const formatPercent = (value: number) => `${String(value)}%`;
const formatSignedInteger = (value: number) => (value > 0 ? `+${value}` : String(value));
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
  const [selectiveColorPreviewMode, setSelectiveColorPreviewMode] = useState<SelectiveColorPreviewMode>('adjusted');
  const gamutWarningOverlay = useEditorStore((state) => state.gamutWarningOverlay);
  const isGamutWarningOverlayVisible = useEditorStore((state) => state.isGamutWarningOverlayVisible);
  const setEditor = useEditorStore((state) => state.setEditor);
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;
  const gamutWarningCoverage = formatGamutWarningCoverage(gamutWarningOverlay);

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

  const resetActiveSelectiveColorRange = () => {
    setAdjustments((prev: Adjustments) => ({
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
    setAdjustments((prev: Adjustments) => ({
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
    setAdjustments((prev: Adjustments) => {
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

  const skinTonePreviewHsl = (settings: Adjustments['skinToneUniformity']) => {
    const hueDelta = Math.min(
      settings.maxHueShiftDegrees,
      Math.max(-settings.maxHueShiftDegrees, settings.targetHueDegrees - 18),
    );

    return {
      hue: (hueDelta * settings.hueUniformity).toFixed(1),
      luminance: ((settings.targetLuminance - 0.5) * 100 * settings.luminanceUniformity).toFixed(1),
      saturation: ((settings.targetSaturation - 0.45) * 100 * settings.saturationUniformity).toFixed(1),
    };
  };
  const skinTonePreview = skinTonePreviewHsl(adjustments.skinToneUniformity);
  const skinToneInspectorOutput = applySkinToneUniformity(skinToneInspectorSample, adjustments.skinToneUniformity);
  const skinToneInspectorBeforeDistance = skinToneTargetDistance(
    skinToneInspectorSample,
    adjustments.skinToneUniformity,
  );
  const skinToneInspectorAfterDistance = skinToneTargetDistance(
    skinToneInspectorOutput,
    adjustments.skinToneUniformity,
  );
  const skinToneInspectorImprovement = skinToneInspectorBeforeDistance - skinToneInspectorAfterDistance;

  const syncSkinToneUniformity = (nextSettings: Adjustments['skinToneUniformity']) => {
    const nextPreview = skinTonePreviewHsl(nextSettings);
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      hsl: {
        ...prev.hsl,
        oranges: {
          ...prev.hsl.oranges,
          hue: nextSettings.enabled ? Number(nextPreview.hue) : 0,
          luminance: nextSettings.enabled ? Number(nextPreview.luminance) : 0,
          saturation: nextSettings.enabled ? Number(nextPreview.saturation) : 0,
        },
      },
      skinToneUniformity: nextSettings,
    }));
  };

  const handleSkinToneUniformityToggle = () => {
    syncSkinToneUniformity({
      ...adjustments.skinToneUniformity,
      enabled: !adjustments.skinToneUniformity.enabled,
    });
  };

  const handleSkinToneUniformityChange = (
    key: keyof Omit<Adjustments['skinToneUniformity'], 'enabled'>,
    value: number,
  ) => {
    syncSkinToneUniformity({
      ...adjustments.skinToneUniformity,
      [key]: value,
    });
  };

  const applyProfessionalColorRecipe = (recipe: ProfessionalColorRecipe) => {
    setActiveColor(recipe.activeColorRange);
    setActiveColorBalanceRange('midtones');
    setActiveChannelMixerOutput('red');
    setAdjustments((prev: Adjustments) => {
      const currentParametricCurve =
        prev.parametricCurve || INITIAL_ADJUSTMENTS.parametricCurve || DEFAULT_PARAMETRIC_CURVE;

      return {
        ...prev,
        cameraProfile: recipe.cameraProfile,
        channelMixer: {
          blue: { ...recipe.channelMixer.blue },
          enabled: recipe.channelMixer.enabled,
          green: { ...recipe.channelMixer.green },
          preserveLuminance: recipe.channelMixer.preserveLuminance,
          red: { ...recipe.channelMixer.red },
        },
        colorBalanceRgb: {
          enabled: recipe.colorBalanceRgb.enabled,
          highlights: { ...recipe.colorBalanceRgb.highlights },
          midtones: { ...recipe.colorBalanceRgb.midtones },
          preserveLuminance: recipe.colorBalanceRgb.preserveLuminance,
          shadows: { ...recipe.colorBalanceRgb.shadows },
        },
        colorGrading: {
          balance: recipe.colorGrading.balance,
          blending: recipe.colorGrading.blending,
          global: { ...recipe.colorGrading.global },
          highlights: { ...recipe.colorGrading.highlights },
          midtones: { ...recipe.colorGrading.midtones },
          shadows: { ...recipe.colorGrading.shadows },
        },
        curveMode: 'parametric',
        hsl: {
          ...prev.hsl,
          ...recipe.hsl,
        },
        levels: {
          ...recipe.levels,
        },
        parametricCurve: {
          ...currentParametricCurve,
          luma: { ...TONE_CURVE_PARAMETRIC_PRESETS[recipe.toneCurve] },
        },
        saturation: recipe.saturation,
        temperature: recipe.temperature,
        tint: recipe.tint,
        toneCurve: recipe.toneCurve,
        vibrance: recipe.vibrance,
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
      {!isForMask && <ColorWorkflowReadinessRail />}
      {!isForMask && (
        <div
          className="rounded-md border border-border bg-bg-tertiary p-2"
          data-coverage-ratio={(gamutWarningOverlay?.coverage_ratio ?? 0).toFixed(6)}
          data-proof-mask-height={gamutWarningOverlay?.height ?? 0}
          data-proof-mask-width={gamutWarningOverlay?.width ?? 0}
          data-proof-ready={String(gamutWarningOverlay !== null)}
          data-warning-pixel-count={gamutWarningOverlay?.warning_pixel_count ?? 0}
          data-testid="gamut-warning-controls"
          data-visible={String(isGamutWarningOverlayVisible)}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <UiText variant={TextVariants.heading}>{t('adjustments.color.gamutWarning.title')}</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                {t('adjustments.color.gamutWarning.coverage', { value: gamutWarningCoverage })}
              </UiText>
              <UiText
                variant={TextVariants.small}
                color={TextColors.secondary}
                className="mt-1 block"
                data-testid="gamut-warning-proof-details"
              >
                {t('adjustments.color.gamutWarning.proofDetails', {
                  height: gamutWarningOverlay?.height ?? 0,
                  pixels: gamutWarningOverlay?.warning_pixel_count ?? 0,
                  width: gamutWarningOverlay?.width ?? 0,
                })}
              </UiText>
            </div>
            <button
              aria-pressed={isGamutWarningOverlayVisible}
              className={`shrink-0 rounded px-2 py-1 text-xs transition-colors ${
                isGamutWarningOverlayVisible
                  ? 'bg-accent text-button-text'
                  : 'bg-bg-secondary text-text-secondary hover:bg-surface'
              }`}
              data-testid="gamut-warning-toggle"
              onClick={() => {
                setEditor({ isGamutWarningOverlayVisible: !isGamutWarningOverlayVisible });
              }}
              type="button"
            >
              {isGamutWarningOverlayVisible
                ? t('adjustments.color.gamutWarning.on')
                : t('adjustments.color.gamutWarning.off')}
            </button>
          </div>
        </div>
      )}
      {!isForMask && (
        <div
          className="rounded-md border border-border bg-bg-tertiary p-2"
          data-hsl-preview-hue={skinTonePreview.hue}
          data-hsl-preview-luminance={skinTonePreview.luminance}
          data-hsl-preview-saturation={skinTonePreview.saturation}
          data-inspector-distance-after={skinToneInspectorAfterDistance.toFixed(3)}
          data-inspector-distance-before={skinToneInspectorBeforeDistance.toFixed(3)}
          data-inspector-improvement={skinToneInspectorImprovement.toFixed(3)}
          data-inspector-output-hue={skinToneInspectorOutput.hueDegrees.toFixed(1)}
          data-skin-tone-runtime-proof="private-raw-preview-export"
          data-target-hue={adjustments.skinToneUniformity.targetHueDegrees}
          data-target-luminance={adjustments.skinToneUniformity.targetLuminance.toFixed(2)}
          data-target-saturation={adjustments.skinToneUniformity.targetSaturation.toFixed(2)}
          data-testid="skin-tone-uniformity-controls"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <UiText variant={TextVariants.heading}>{t('adjustments.color.skinToneUniformity.title')}</UiText>
              <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                {t('adjustments.color.skinToneUniformity.description')}
              </UiText>
            </div>
            <button
              aria-pressed={adjustments.skinToneUniformity.enabled}
              className={`shrink-0 rounded px-2 py-1 text-xs transition-colors ${
                adjustments.skinToneUniformity.enabled
                  ? 'bg-accent text-button-text'
                  : 'bg-bg-secondary text-text-secondary hover:bg-surface'
              }`}
              data-testid="skin-tone-uniformity-toggle"
              onClick={handleSkinToneUniformityToggle}
              type="button"
            >
              {adjustments.skinToneUniformity.enabled
                ? t('adjustments.color.skinToneUniformity.enabled')
                : t('adjustments.color.skinToneUniformity.disabled')}
            </button>
          </div>
          <div className="grid gap-1 rounded bg-bg-secondary p-2 text-[11px] text-text-secondary">
            <span>{t('adjustments.color.skinToneUniformity.warning')}</span>
            <span>
              {t('adjustments.color.skinToneUniformity.preview', {
                hue: skinTonePreview.hue,
                lightness: skinTonePreview.luminance,
                saturation: skinTonePreview.saturation,
              })}
            </span>
            <span className="flex justify-between gap-2" data-testid="skin-tone-uniformity-inspector">
              <span>{skinToneInspectorBeforeDistance.toFixed(3)}</span>
              <span>{skinToneInspectorAfterDistance.toFixed(3)}</span>
            </span>
          </div>
          <AdjustmentSlider
            defaultValue={0.42}
            label={t('adjustments.color.skinToneUniformity.hue')}
            max={0.75}
            min={0}
            onValueChange={(value) => {
              handleSkinToneUniformityChange('hueUniformity', value);
            }}
            step={0.01}
            value={adjustments.skinToneUniformity.hueUniformity}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            defaultValue={0.31}
            label={t('adjustments.color.skinToneUniformity.saturation')}
            max={0.75}
            min={0}
            onValueChange={(value) => {
              handleSkinToneUniformityChange('saturationUniformity', value);
            }}
            step={0.01}
            value={adjustments.skinToneUniformity.saturationUniformity}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            defaultValue={0.18}
            label={t('adjustments.color.skinToneUniformity.lightness')}
            max={0.75}
            min={0}
            onValueChange={(value) => {
              handleSkinToneUniformityChange('luminanceUniformity', value);
            }}
            step={0.01}
            value={adjustments.skinToneUniformity.luminanceUniformity}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            defaultValue={16}
            label={t('adjustments.color.skinToneUniformity.hueCap')}
            max={30}
            min={0}
            onValueChange={(value) => {
              handleSkinToneUniformityChange('maxHueShiftDegrees', value);
            }}
            step={1}
            value={adjustments.skinToneUniformity.maxHueShiftDegrees}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            defaultValue={24}
            label={t('adjustments.color.skinToneUniformity.targetHue')}
            max={45}
            min={10}
            onValueChange={(value) => {
              handleSkinToneUniformityChange('targetHueDegrees', value);
            }}
            step={1}
            value={adjustments.skinToneUniformity.targetHueDegrees}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            defaultValue={0.38}
            label={t('adjustments.color.skinToneUniformity.targetSaturation')}
            max={0.65}
            min={0.15}
            onValueChange={(value) => {
              handleSkinToneUniformityChange('targetSaturation', value);
            }}
            step={0.01}
            value={adjustments.skinToneUniformity.targetSaturation}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            defaultValue={0.56}
            label={t('adjustments.color.skinToneUniformity.targetLightness')}
            max={0.75}
            min={0.35}
            onValueChange={(value) => {
              handleSkinToneUniformityChange('targetLuminance', value);
            }}
            step={0.01}
            value={adjustments.skinToneUniformity.targetLuminance}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}
      {!isForMask && (
        <div className="rounded-md border border-border bg-bg-tertiary p-2" data-testid="professional-color-recipes">
          <div className="mb-2">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.workflowRecipes.title')}</UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {t('adjustments.color.workflowRecipes.description')}
            </UiText>
          </div>
          <div className="grid gap-2">
            {professionalColorRecipes.map((recipe) => {
              const isApplied = isProfessionalColorRecipeApplied(adjustments, recipe);

              return (
                <button
                  aria-pressed={isApplied}
                  className={`rounded-md border px-2.5 py-2 text-left text-xs transition-colors hover:border-accent hover:bg-surface ${
                    isApplied ? 'border-accent bg-accent/10 ring-1 ring-accent/40' : 'border-surface bg-bg-secondary'
                  }`}
                  data-active={String(isApplied)}
                  data-active-range={recipe.activeColorRange}
                  data-camera-profile={recipe.cameraProfile}
                  data-temperature={recipe.temperature}
                  data-testid={`professional-color-recipe-${recipe.id}`}
                  data-tint={recipe.tint}
                  data-tone-curve={recipe.toneCurve}
                  data-vibrance={recipe.vibrance}
                  key={recipe.id}
                  onClick={() => {
                    applyProfessionalColorRecipe(recipe);
                  }}
                  type="button"
                >
                  <span className="flex flex-wrap items-start justify-between gap-1.5">
                    <span className="min-w-0 flex-1 text-[13px] font-semibold leading-tight text-text-primary">
                      {t(recipe.labelKey)}
                    </span>
                    <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-text-secondary">
                      {t('adjustments.color.workflowRecipes.apply')}
                    </span>
                  </span>
                  <span className="mt-1 block leading-snug text-text-secondary">{t(recipe.descriptionKey)}</span>
                  <span
                    aria-hidden="true"
                    className="mt-2 grid gap-1 text-[10px] font-medium leading-tight text-text-secondary"
                    data-testid="professional-color-recipe-summary"
                  >
                    <span className="rounded bg-bg-primary px-1.5 py-1">
                      {t('adjustments.color.workflowRecipes.profileChip', {
                        value: t(`adjustments.color.profileTone.cameraProfiles.${recipe.cameraProfile}`),
                      })}
                    </span>
                    <span className="rounded bg-bg-primary px-1.5 py-1">
                      {t('adjustments.color.workflowRecipes.toneChip', {
                        value: t(`adjustments.color.profileTone.toneCurves.${recipe.toneCurve}`),
                      })}
                    </span>
                    <span className="rounded bg-bg-primary px-1.5 py-1">
                      {t('adjustments.color.workflowRecipes.whiteBalanceChip', {
                        temperature: formatSignedInteger(recipe.temperature),
                        tint: formatSignedInteger(recipe.tint),
                      })}
                    </span>
                    <span className="rounded bg-bg-primary px-1.5 py-1">
                      {t('adjustments.color.workflowRecipes.rangeChip', {
                        value: t(getSelectiveColorRange(recipe.activeColorRange).labelKey),
                      })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
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
        <AdjustmentSlider
          label={isForMask ? t('adjustments.color.localHue') : t('adjustments.color.hue')}
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
