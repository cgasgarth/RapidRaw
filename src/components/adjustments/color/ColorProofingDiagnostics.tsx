import { useTranslation } from 'react-i18next';
import { TextColors, TextVariants } from '../../../types/typography';
import type { Adjustments } from '../../../utils/adjustments';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import type { ColorPanelGroupProps } from './types';

const colorRuntimeStatusItems = [
  ['gpuLabel', 'previewExport'],
  ['apiLabel', 'typed'],
  ['uiLabel', 'proofed'],
] as const;
type RuntimeStatusKey = (typeof colorRuntimeStatusItems)[number][number] | 'ariaLabel';
export const runtimeStatusKey = (key: RuntimeStatusKey) => `adjustments.color.runtimeStatus.${key}` as const;

export const ColorRuntimeStatusRail = () => {
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

export const ColorWorkflowReadinessRail = () => {
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

interface ColorProofingDiagnosticsProps extends ColorPanelGroupProps {
  activeCameraProfileLabel: string;
  activeExportPresetName: string | null;
  activeToneCurveLabel: string;
  colorWorkspaceWarningChips: Array<string>;
  currentGamutWarningOverlay: {
    coverage_ratio?: number;
    effective_color_profile?: string;
    effective_rendering_intent?: string;
    export_soft_proof_recipe_id?: string;
    preview_basis?: string;
    source_image_path?: string;
    transform_policy_fingerprint?: string;
    warning_pixel_count?: number;
  } | null;
  gamutWarningCoverage: string;
  isGamutWarningOverlayVisible: boolean;
  proofDimensions: { height: number; width: number };
  setEditor: (state: { isGamutWarningOverlayVisible: boolean }) => void;
  skinToneInspectorAfterDistance: number;
  skinToneInspectorBeforeDistance: number;
  skinToneInspectorImprovement: number;
  skinToneInspectorOutputHue: number;
  skinTonePreview: { hue: string; luminance: string; saturation: string };
  syncSkinToneUniformity: (nextSettings: Adjustments['skinToneUniformity']) => void;
}

export const ColorProofingDiagnostics = ({
  activeCameraProfileLabel,
  activeExportPresetName,
  activeToneCurveLabel,
  adjustments,
  colorWorkspaceWarningChips,
  currentGamutWarningOverlay,
  gamutWarningCoverage,
  isGamutWarningOverlayVisible,
  onDragStateChange,
  proofDimensions,
  setEditor,
  skinToneInspectorAfterDistance,
  skinToneInspectorBeforeDistance,
  skinToneInspectorImprovement,
  skinToneInspectorOutputHue,
  skinTonePreview,
  syncSkinToneUniformity,
}: ColorProofingDiagnosticsProps) => {
  const { t } = useTranslation();

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

  return (
    <>
      <ColorRuntimeStatusRail />
      <ColorWorkflowReadinessRail />
      <div
        className="rounded-md border border-border bg-bg-tertiary p-2"
        data-active-camera-profile={adjustments.cameraProfile}
        data-active-tone-curve={adjustments.toneCurve}
        data-export-transform-label={activeExportPresetName ?? ''}
        data-gamut-warning-count={currentGamutWarningOverlay?.warning_pixel_count ?? 0}
        data-histogram-hook="histogram"
        data-testid="professional-color-workspace-panel"
        data-vectorscope-hook="vectorscope"
        data-warning-count={colorWorkspaceWarningChips.length}
        data-waveform-hook="waveform"
        data-working-space-label="linear-raw-to-working-rgb"
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <UiText variant={TextVariants.heading}>{t('adjustments.color.colorMixer')}</UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {t('adjustments.color.profileTone.receiptSummary', {
                profile: activeCameraProfileLabel,
                toneCurve: activeToneCurveLabel,
              })}
            </UiText>
          </div>
          <span className="shrink-0 rounded bg-bg-secondary px-2 py-1 text-[10px] font-semibold uppercase tracking-normal text-text-secondary">
            {t(runtimeStatusKey('previewExport'))}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] font-medium text-text-secondary">
          <span className="min-w-0 rounded bg-bg-secondary px-1.5 py-1" data-testid="color-workspace-working-label">
            {t(runtimeStatusKey('apiLabel'))}: {t('adjustments.color.profileTone.cameraProfiles.linear_raw')}
          </span>
          <span className="min-w-0 rounded bg-bg-secondary px-1.5 py-1" data-testid="color-workspace-export-label">
            {t(runtimeStatusKey('uiLabel'))}: {activeExportPresetName ?? t(runtimeStatusKey('previewExport'))}
          </span>
          <span className="min-w-0 rounded bg-bg-secondary px-1.5 py-1" data-testid="color-workspace-scope-label">
            {t(runtimeStatusKey('gpuLabel'))}: {t('ui.waveform.tooltips.vectorscope')}
          </span>
        </div>
        <div
          className="mt-2 flex flex-wrap gap-1 text-[10px] font-medium text-text-secondary"
          data-testid="professional-color-workspace-warning-chips"
        >
          {(colorWorkspaceWarningChips.length > 0
            ? colorWorkspaceWarningChips
            : [t('adjustments.color.gamutWarning.off')]
          ).map((warning) => (
            <span className="rounded bg-bg-secondary px-1.5 py-1" key={warning}>
              {warning}
            </span>
          ))}
        </div>
      </div>

      <div
        className="rounded-md border border-border bg-bg-tertiary p-2"
        data-coverage-ratio={(currentGamutWarningOverlay?.coverage_ratio ?? 0).toFixed(6)}
        data-effective-color-profile={currentGamutWarningOverlay?.effective_color_profile ?? ''}
        data-effective-rendering-intent={currentGamutWarningOverlay?.effective_rendering_intent ?? ''}
        data-export-soft-proof-recipe-id={currentGamutWarningOverlay?.export_soft_proof_recipe_id ?? ''}
        data-preview-basis={currentGamutWarningOverlay?.preview_basis ?? ''}
        data-proof-mask-height={proofDimensions.height}
        data-proof-mask-width={proofDimensions.width}
        data-proof-ready={String(currentGamutWarningOverlay !== null)}
        data-source-image-path={currentGamutWarningOverlay?.source_image_path ?? ''}
        data-transform-policy-fingerprint={currentGamutWarningOverlay?.transform_policy_fingerprint ?? ''}
        data-warning-pixel-count={currentGamutWarningOverlay?.warning_pixel_count ?? 0}
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
                height: proofDimensions.height,
                pixels: currentGamutWarningOverlay?.warning_pixel_count ?? 0,
                width: proofDimensions.width,
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

      <div
        className="rounded-md border border-border bg-bg-tertiary p-2"
        data-hsl-preview-hue={skinTonePreview.hue}
        data-hsl-preview-luminance={skinTonePreview.luminance}
        data-hsl-preview-saturation={skinTonePreview.saturation}
        data-inspector-distance-after={skinToneInspectorAfterDistance.toFixed(3)}
        data-inspector-distance-before={skinToneInspectorBeforeDistance.toFixed(3)}
        data-inspector-improvement={skinToneInspectorImprovement.toFixed(3)}
        data-inspector-output-hue={skinToneInspectorOutputHue.toFixed(1)}
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
    </>
  );
};
