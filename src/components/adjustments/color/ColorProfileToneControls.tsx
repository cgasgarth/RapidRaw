import cx from 'clsx';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCameraProfileRegistry } from '../../../hooks/editor/useCameraProfileRegistry';
import type { CalibrationFitReceipt } from '../../../schemas/color/chartCalibrationSchemas';
import {
  type CameraProfileId,
  cameraProfileIdSchema,
  type ToneCurveId,
} from '../../../schemas/color/profileToneSchemas';
import type { RawDevelopmentReport } from '../../../schemas/imageLoaderSchemas';
import { TextVariants } from '../../../types/typography';
import {
  type Adjustments,
  ColorAdjustment,
  DEFAULT_PARAMETRIC_CURVE,
  INITIAL_ADJUSTMENTS,
} from '../../../utils/adjustments';
import { applyCameraProfileIdentity } from '../../../utils/color/profile/cameraProfileBrowserRuntime';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../../utils/profileTonePresets';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import { editorChromeTokens } from '../../ui/editorChromeTokens';
import UiText from '../../ui/primitives/Text';
import { CameraProfileBrowser } from './CameraProfileBrowser';
import { ChartCalibrationModal } from './ChartCalibrationModal';
import type { ColorPanelGroupProps } from './types';

const TONE_CURVE_IDS = [
  'auto_filmic',
  'linear',
  'soft_contrast',
  'high_contrast',
  'shadow_lift',
] satisfies Array<ToneCurveId>;

const parseToneCurveId = (value: string): ToneCurveId =>
  TONE_CURVE_IDS.find((toneCurve) => toneCurve === value) ?? 'auto_filmic';

interface ColorProfileToneControlsProps extends ColorPanelGroupProps {
  adjustmentVisibility: Record<string, boolean>;
  rawDevelopmentReport?: RawDevelopmentReport | null;
  sourcePath?: string | null;
}

export const ColorProfileToneControls = ({
  adjustmentVisibility,
  adjustments,
  rawDevelopmentReport = null,
  sourcePath = null,
  setAdjustments,
}: ColorProfileToneControlsProps) => {
  const { t } = useTranslation();
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [firstCalibrationEndpoint, setFirstCalibrationEndpoint] = useState<CalibrationFitReceipt | null>(null);
  const profileRegistry = useCameraProfileRegistry(rawDevelopmentReport?.cameraProfile.cameraModel ?? null);
  const profileToneLabels = getProfileToneLabels(adjustments, t);
  const isModified =
    adjustments.cameraProfile !== INITIAL_ADJUSTMENTS.cameraProfile ||
    adjustments.cameraProfileAmount !== INITIAL_ADJUSTMENTS.cameraProfileAmount ||
    adjustments.toneCurve !== INITIAL_ADJUSTMENTS.toneCurve;
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
  const runtimeProfile = rawDevelopmentReport?.cameraProfile ?? null;
  const runtimeProfileStatus = runtimeProfile?.status ?? 'not_reported';
  const runtimeProfileLabel =
    runtimeProfile === null
      ? t('adjustments.color.profileTone.runtimeNotReported')
      : t(`editor.metadata.cameraProfile.status.${runtimeProfile.status}`);
  const runtimeProcessLabel = rawDevelopmentReport?.processingProfile
    ? t('adjustments.color.profileTone.runtimeProcess', { process: rawDevelopmentReport.processingProfile })
    : null;

  const handleCameraProfileChange = (cameraProfile: CameraProfileId) => {
    setAdjustments((previous) => applyCameraProfileIdentity(previous, cameraProfile));
  };
  const handleCameraProfileAmountChange = (cameraProfileAmount: number) => {
    setAdjustments((previous) => ({ ...previous, cameraProfileAmount }));
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
      className="border-b border-editor-border pb-1.5"
      data-camera-profile={adjustments.cameraProfile}
      data-runtime-profile-status={runtimeProfileStatus}
      data-testid="profile-tone-controls"
      data-tone-curve={adjustments.toneCurve}
    >
      <CompactInspectorSectionHeader
        modified={isModified}
        modifiedLabel={t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
        summary={
          <span
            data-testid="profile-tone-summary"
            title={`${profileToneLabels.activeCameraProfileLabel} / ${profileToneLabels.activeToneCurveLabel}`}
          >
            {profileToneLabels.activeCameraProfileLabel} / {profileToneLabels.activeToneCurveLabel}
          </span>
        }
        title={t('adjustments.color.profileTone.foundationTitle')}
      />
      <div className="space-y-1">
        <div
          className="grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2 px-0.5 py-0.5"
          data-testid="color-input-profile-identity"
        >
          <UiText variant={TextVariants.label} className="truncate text-[10px] leading-4 text-text-secondary">
            {t('adjustments.color.profileTone.inputTransform')}
          </UiText>
          <div className="min-w-0 text-right">
            <UiText
              as="span"
              variant={TextVariants.label}
              className={cx(
                'inline-block max-w-full truncate text-[10px] leading-4',
                runtimeProfileStatus === 'fallback' || runtimeProfileStatus === 'unavailable'
                  ? 'text-editor-warning'
                  : 'text-text-primary',
              )}
              data-testid="color-input-profile-status"
              title={runtimeProfile?.fallbackReason ?? runtimeProfileLabel}
            >
              {runtimeProfileLabel}
            </UiText>
            {runtimeProcessLabel && (
              <UiText className="truncate text-[9px] leading-3 text-text-tertiary" title={runtimeProcessLabel}>
                {runtimeProcessLabel}
              </UiText>
            )}
          </div>
        </div>
        {adjustmentVisibility[ColorAdjustment.CameraProfile] !== false && (
          <div className="grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
            <UiText variant={TextVariants.label} className="truncate text-[10px] leading-4 text-text-secondary">
              {t('adjustments.color.profileTone.profilePreset')}
            </UiText>
            <CameraProfileBrowser
              amount={adjustments.cameraProfileAmount}
              builtIns={cameraProfileOptions.map((option) => ({ id: option.key, label: option.label }))}
              entries={profileRegistry.entries}
              errorCode={profileRegistry.errorCode}
              label={t('adjustments.color.profileTone.profilePreset')}
              loading={profileRegistry.loading}
              onAmountChange={handleCameraProfileAmountChange}
              onImport={() => void profileRegistry.importProfile()}
              onRemove={(id) => void profileRegistry.removeProfile(id)}
              onReveal={(id) => void profileRegistry.revealProfile(id)}
              onSelect={handleCameraProfileChange}
              selected={adjustments.cameraProfile}
            />
            {rawDevelopmentReport !== null && (
              <button
                className="col-start-2 mt-1 rounded border border-editor-border px-2 py-1 text-[10px] text-text-secondary hover:bg-white/5"
                data-testid="open-chart-calibration"
                onClick={() => setCalibrationOpen(true)}
                type="button"
              >
                {t('adjustments.color.profileTone.calibration.open')}
              </button>
            )}
          </div>
        )}
        {adjustmentVisibility[ColorAdjustment.ToneCurve] !== false && (
          <label className="grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)] items-center gap-2">
            <UiText variant={TextVariants.label} className="truncate text-[10px] leading-4 text-text-secondary">
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
      <ChartCalibrationModal
        firstEndpoint={firstCalibrationEndpoint}
        onClose={() => setCalibrationOpen(false)}
        onEndpointSaved={setFirstCalibrationEndpoint}
        onPublished={(profileId) => {
          const parsed = cameraProfileIdSchema.safeParse(profileId);
          if (parsed.success) handleCameraProfileChange(parsed.data);
          void profileRegistry.refresh();
        }}
        open={calibrationOpen}
        sourcePath={sourcePath}
      />
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
