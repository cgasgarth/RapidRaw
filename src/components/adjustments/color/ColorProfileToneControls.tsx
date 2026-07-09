import cx from 'clsx';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraProfileId, ToneCurveId } from '../../../schemas/color/profileToneSchemas';
import { TextColors, TextVariants } from '../../../types/typography';
import {
  type Adjustments,
  ColorAdjustment,
  DEFAULT_PARAMETRIC_CURVE,
  INITIAL_ADJUSTMENTS,
} from '../../../utils/adjustments';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../../utils/profileTonePresets';
import { editorChromeTokens } from '../../ui/editorChromeTokens';
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

interface ColorProfileToneControlsProps extends ColorPanelGroupProps {
  adjustmentVisibility: Record<string, boolean>;
}

export const ColorProfileToneControls = ({
  adjustmentVisibility,
  adjustments,
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

  const handleCameraProfileChange = (cameraProfile: CameraProfileId) => {
    setAdjustments((previous) => ({ ...previous, cameraProfile }));
  };

  const handleToneCurveChange = (toneCurve: ToneCurveId) => {
    setAdjustments((previous) => {
      const currentParametricCurve =
        previous.parametricCurve || INITIAL_ADJUSTMENTS.parametricCurve || DEFAULT_PARAMETRIC_CURVE;

      return {
        ...previous,
        curveMode: 'parametric',
        parametricCurve: {
          ...currentParametricCurve,
          luma: { ...TONE_CURVE_PARAMETRIC_PRESETS[toneCurve] },
        },
        toneCurve,
      };
    });
  };

  if (
    adjustmentVisibility[ColorAdjustment.CameraProfile] === false &&
    adjustmentVisibility[ColorAdjustment.ToneCurve] === false
  ) {
    return null;
  }

  return (
    <section
      className="border-b border-editor-border pb-2"
      data-camera-profile={adjustments.cameraProfile}
      data-testid="profile-tone-controls"
      data-tone-curve={adjustments.toneCurve}
    >
      <UiText variant={TextVariants.heading} className={cx(density.sectionHeader.title, 'mb-1.5 block')}>
        {t('adjustments.color.profileTone.title')}
      </UiText>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {adjustmentVisibility[ColorAdjustment.CameraProfile] !== false && (
          <label className="grid min-w-0 gap-0.5">
            <UiText variant={TextVariants.label} color={TextColors.secondary} className="block">
              {t('adjustments.color.profileTone.cameraProfile')}
            </UiText>
            <select
              aria-label={t('adjustments.color.profileTone.cameraProfile')}
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
          </label>
        )}
        {adjustmentVisibility[ColorAdjustment.ToneCurve] !== false && (
          <label className="grid min-w-0 gap-0.5">
            <UiText variant={TextVariants.label} color={TextColors.secondary} className="block">
              {t('adjustments.color.profileTone.toneCurve')}
            </UiText>
            <select
              aria-label={t('adjustments.color.profileTone.toneCurve')}
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
          </label>
        )}
      </div>
    </section>
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
