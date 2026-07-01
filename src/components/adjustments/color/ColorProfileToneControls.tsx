import cx from 'clsx';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlackWhiteMixerChannel } from '../../../schemas/color/blackWhiteMixerSchemas';
import type { ChannelMixerOutput } from '../../../schemas/color/channelMixerSchemas';
import type { ColorBalanceRgbRange } from '../../../schemas/color/colorBalanceRgbSchemas';
import type { CameraProfileId, ToneCurveId } from '../../../schemas/color/profileToneSchemas';
import { TextColors, TextVariants } from '../../../types/typography';
import {
  type Adjustments,
  ColorAdjustment,
  DEFAULT_PARAMETRIC_CURVE,
  type HueSatLum,
  INITIAL_ADJUSTMENTS,
} from '../../../utils/adjustments';
import { applyProfileToneToRgbPixel } from '../../../utils/color/profile/profileToneRuntime';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../../utils/profileTonePresets';
import { getSelectiveColorRange } from '../../../utils/selectiveColorRanges';
import { editorChromeStatusChipClassName, editorChromeTokens } from '../../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import UiText from '../../ui/primitives/Text';
import type { ColorPanelGroupProps } from './types';

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

const formatSignedInteger = (value: number) => (value > 0 ? `+${value}` : String(value));

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

const profileTonePreviewPixel = {
  blue: 0.46,
  green: 0.5,
  red: 0.54,
};

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

interface ColorProfileToneControlsProps extends ColorPanelGroupProps {
  adjustmentVisibility: Record<string, boolean>;
  setActiveChannelMixerOutput: (output: ChannelMixerOutput) => void;
  setActiveColor: (color: BlackWhiteMixerChannel) => void;
  setActiveColorBalanceRange: (range: ColorBalanceRgbRange) => void;
}

export const ColorProfileToneControls = ({
  adjustmentVisibility,
  adjustments,
  setActiveChannelMixerOutput,
  setActiveColor,
  setActiveColorBalanceRange,
  setAdjustments,
}: ColorProfileToneControlsProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;

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
  const profileToneReceipt = applyProfileToneToRgbPixel(profileTonePreviewPixel, {
    cameraProfile: adjustments.cameraProfile,
    toneCurve: adjustments.toneCurve,
  });
  const activeCameraProfileLabel =
    cameraProfileOptions.find((option) => option.key === adjustments.cameraProfile)?.label ?? adjustments.cameraProfile;
  const activeToneCurveLabel =
    toneCurveOptions.find((option) => option.key === adjustments.toneCurve)?.label ?? adjustments.toneCurve;

  const handleCameraProfileChange = (cameraProfile: CameraProfileId) => {
    setAdjustments((prev) => ({
      ...prev,
      cameraProfile,
    }));
  };

  const handleToneCurveChange = (toneCurve: ToneCurveId) => {
    setAdjustments((prev) => {
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

  const applyProfessionalColorRecipe = (recipe: ProfessionalColorRecipe) => {
    setActiveColor(recipe.activeColorRange);
    setActiveColorBalanceRange('midtones');
    setActiveChannelMixerOutput('red');
    setAdjustments((prev) => {
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

  return (
    <>
      {(adjustmentVisibility[ColorAdjustment.CameraProfile] !== false ||
        adjustmentVisibility[ColorAdjustment.ToneCurve] !== false) && (
        <div className={density.card.panel} data-testid="profile-tone-controls">
          <UiText variant={TextVariants.heading} className={cx(density.sectionHeader.title, 'mb-2 block')}>
            {t('adjustments.color.profileTone.title')}
          </UiText>
          {adjustmentVisibility[ColorAdjustment.CameraProfile] !== false && (
            <div className="mb-3">
              <UiText variant={TextVariants.label} color={TextColors.secondary} className="mb-2 block">
                {t('adjustments.color.profileTone.cameraProfile')}
              </UiText>
              <select
                className={cx(editorChromeTokens.input.base, editorChromeTokens.input.compact, 'w-full')}
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
                className={cx(editorChromeTokens.input.base, editorChromeTokens.input.compact, 'w-full')}
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
          <div
            className="mt-3 grid gap-1 rounded border border-editor-border bg-editor-panel p-2 text-[11px] text-text-secondary"
            data-camera-profile={adjustments.cameraProfile}
            data-luminance-after={profileToneReceipt.luminanceAfter.toFixed(4)}
            data-luminance-before={profileToneReceipt.luminanceBefore.toFixed(4)}
            data-testid="profile-tone-visible-receipt"
            data-tone-curve={adjustments.toneCurve}
            data-tone-delta={profileToneReceipt.toneDelta.toFixed(4)}
          >
            <span className="font-medium text-text-primary">{t('adjustments.color.profileTone.receiptTitle')}</span>
            <span>
              {t('adjustments.color.profileTone.receiptSummary', {
                profile: activeCameraProfileLabel,
                toneCurve: activeToneCurveLabel,
              })}
            </span>
            <span>
              {t('adjustments.color.profileTone.receiptRuntime', {
                after: profileToneReceipt.luminanceAfter.toFixed(3),
                before: profileToneReceipt.luminanceBefore.toFixed(3),
                delta: profileToneReceipt.toneDelta.toFixed(3),
              })}
            </span>
            <span>{t('adjustments.color.profileTone.receiptExportParity')}</span>
          </div>
        </div>
      )}

      <details className={density.card.nestedPanel} data-testid="professional-color-recipes-disclosure">
        <summary className="flex cursor-pointer items-start justify-between gap-3 px-2 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring">
          <span className="min-w-0">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.workflowRecipes.title')}</UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {t('adjustments.color.workflowRecipes.description')}
            </UiText>
          </span>
          <span className={editorChromeStatusChipClassName('neutral')}>{t('adjustments.color.collapsed')}</span>
        </summary>
        <div className="grid gap-2 border-t border-editor-border p-2" data-testid="professional-color-recipes">
          {professionalColorRecipes.map((recipe) => {
            const isApplied = isProfessionalColorRecipeApplied(adjustments, recipe);

            return (
              <button
                aria-pressed={isApplied}
                className={`rounded-md border px-2.5 py-2 text-left text-xs transition-colors hover:border-accent hover:bg-editor-panel-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring ${
                  isApplied
                    ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
                    : 'border-editor-border bg-editor-panel'
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
                  <span className={editorChromeStatusChipClassName(isApplied ? 'success' : 'neutral')}>
                    {t('adjustments.color.workflowRecipes.apply')}
                  </span>
                </span>
                <span className="mt-1 block leading-snug text-text-secondary">{t(recipe.descriptionKey)}</span>
                <span
                  aria-hidden="true"
                  className="mt-2 grid gap-1 text-[10px] font-medium leading-tight text-text-secondary"
                  data-testid="professional-color-recipe-summary"
                >
                  <span className={editorChromeStatusChipClassName('neutral')}>
                    {t('adjustments.color.workflowRecipes.profileChip', {
                      value: t(`adjustments.color.profileTone.cameraProfiles.${recipe.cameraProfile}`),
                    })}
                  </span>
                  <span className={editorChromeStatusChipClassName('neutral')}>
                    {t('adjustments.color.workflowRecipes.toneChip', {
                      value: t(`adjustments.color.profileTone.toneCurves.${recipe.toneCurve}`),
                    })}
                  </span>
                  <span className={editorChromeStatusChipClassName('neutral')}>
                    {t('adjustments.color.workflowRecipes.whiteBalanceChip', {
                      temperature: formatSignedInteger(recipe.temperature),
                      tint: formatSignedInteger(recipe.tint),
                    })}
                  </span>
                  <span className={editorChromeStatusChipClassName('neutral')}>
                    {t('adjustments.color.workflowRecipes.rangeChip', {
                      value: t(getSelectiveColorRange(recipe.activeColorRange).labelKey),
                    })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </details>
    </>
  );
};

export const getProfileToneLabels = (adjustments: Adjustments, t: TFunction) => {
  const cameraProfileOptions = [
    { key: 'camera_standard', label: t('adjustments.color.profileTone.cameraProfiles.camera_standard') },
    { key: 'camera_neutral', label: t('adjustments.color.profileTone.cameraProfiles.camera_neutral') },
    { key: 'camera_portrait', label: t('adjustments.color.profileTone.cameraProfiles.camera_portrait') },
    { key: 'camera_landscape', label: t('adjustments.color.profileTone.cameraProfiles.camera_landscape') },
    { key: 'linear_raw', label: t('adjustments.color.profileTone.cameraProfiles.linear_raw') },
  ] satisfies Array<{ key: CameraProfileId; label: string }>;
  const toneCurveOptions = [
    { key: 'auto_filmic', label: t('adjustments.color.profileTone.toneCurves.auto_filmic') },
    { key: 'linear', label: t('adjustments.color.profileTone.toneCurves.linear') },
    { key: 'soft_contrast', label: t('adjustments.color.profileTone.toneCurves.soft_contrast') },
    { key: 'high_contrast', label: t('adjustments.color.profileTone.toneCurves.high_contrast') },
    { key: 'shadow_lift', label: t('adjustments.color.profileTone.toneCurves.shadow_lift') },
  ] satisfies Array<{ key: ToneCurveId; label: string }>;

  return {
    activeCameraProfileLabel:
      cameraProfileOptions.find((option) => option.key === adjustments.cameraProfile)?.label ??
      adjustments.cameraProfile,
    activeToneCurveLabel:
      toneCurveOptions.find((option) => option.key === adjustments.toneCurve)?.label ?? adjustments.toneCurve,
  };
};
