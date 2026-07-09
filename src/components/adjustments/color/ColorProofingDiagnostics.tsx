import cx from 'clsx';
import { useTranslation } from 'react-i18next';
import { TextColors, TextVariants } from '../../../types/typography';
import type { Adjustments } from '../../../utils/adjustments';
import type { RenderedPreviewWarningStatus } from '../../../utils/color/runtime/gamutWarningDisplay';
import { professionalInspectorDensityTokens } from '../../ui/inspectorTokens';
import UiText from '../../ui/primitives/Text';
import AdjustmentSlider from '../AdjustmentSlider';
import type { ColorPanelGroupProps } from './types';

interface ColorProofingDiagnosticsProps extends ColorPanelGroupProps {
  colorWorkspaceWarningChips: Array<string>;
  hasCurrentGamutWarning: boolean;
  isGamutWarningOverlayVisible: boolean;
  renderedPreviewWarningStatus: RenderedPreviewWarningStatus;
  setEditor: (state: { isGamutWarningOverlayVisible: boolean }) => void;
  syncSkinToneUniformity: (nextSettings: Adjustments['skinToneUniformity']) => void;
}

export const ColorProofingDiagnostics = ({
  adjustments,
  colorWorkspaceWarningChips,
  hasCurrentGamutWarning,
  isGamutWarningOverlayVisible,
  onDragStateChange,
  renderedPreviewWarningStatus,
  setEditor,
  syncSkinToneUniformity,
}: ColorProofingDiagnosticsProps) => {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const gamutCoverageLabel =
    renderedPreviewWarningStatus.state === 'current'
      ? t('editor.canvas.gamutWarningCoverage', {
          profile: renderedPreviewWarningStatus.displayProfileLabel,
          value: renderedPreviewWarningStatus.coverageLabel,
        })
      : renderedPreviewWarningStatus.statusLabel;

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
    <details
      className="border-b border-editor-border bg-editor-panel"
      data-testid="color-proofing-diagnostics-disclosure"
    >
      <summary className="cursor-pointer px-2.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring">
        <div className={density.sectionHeader.root}>
          <div className="min-w-0">
            <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
              {t('adjustments.color.gamutWarning.title')}
            </UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className={density.sectionHeader.summary}>
              {gamutCoverageLabel}
            </UiText>
          </div>
          <span className={density.sectionHeader.badge}>
            {colorWorkspaceWarningChips.length > 0
              ? colorWorkspaceWarningChips.length
              : t('adjustments.color.gamutWarning.off')}
          </span>
        </div>
      </summary>
      <div className="space-y-2 border-t border-editor-border px-2.5 py-2">
        <div
          className={cx(
            'flex items-center justify-between gap-3 rounded border px-2 py-1.5',
            !hasCurrentGamutWarning
              ? 'border-editor-border bg-editor-panel-well'
              : 'border-editor-warning/40 bg-editor-warning-surface',
          )}
          data-testid="gamut-warning-controls"
          data-visible={String(isGamutWarningOverlayVisible)}
        >
          <div className="min-w-0">
            <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
              {t('adjustments.color.gamutWarning.title')}
            </UiText>
            <UiText variant={TextVariants.small} color={TextColors.secondary} className={density.sectionHeader.summary}>
              {gamutCoverageLabel}
            </UiText>
          </div>
          <button
            aria-pressed={isGamutWarningOverlayVisible}
            className={cx(
              density.actionButton.base,
              isGamutWarningOverlayVisible ? density.actionButton.active : density.actionButton.inactive,
            )}
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

        <div
          className={cx(
            density.card.nestedPanel,
            adjustments.skinToneUniformity.enabled ? 'border-accent bg-accent/10' : 'bg-editor-panel',
          )}
          data-testid="skin-tone-uniformity-controls"
        >
          <div className={density.sectionHeader.root}>
            <div>
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.color.skinToneUniformity.title')}
              </UiText>
              <UiText
                variant={TextVariants.small}
                color={TextColors.secondary}
                className={density.sectionHeader.summary}
              >
                {t('adjustments.color.skinToneUniformity.description')}
              </UiText>
            </div>
            <button
              aria-pressed={adjustments.skinToneUniformity.enabled}
              className={cx(
                density.actionButton.base,
                adjustments.skinToneUniformity.enabled ? density.actionButton.active : density.actionButton.inactive,
              )}
              data-testid="skin-tone-uniformity-toggle"
              onClick={handleSkinToneUniformityToggle}
              type="button"
            >
              {adjustments.skinToneUniformity.enabled
                ? t('adjustments.color.skinToneUniformity.enabled')
                : t('adjustments.color.skinToneUniformity.disabled')}
            </button>
          </div>
          <div className="grid gap-1 rounded border border-editor-border bg-editor-panel-raised p-1.5 text-[11px] text-text-secondary">
            <span>{t('adjustments.color.skinToneUniformity.warning')}</span>
          </div>
          <AdjustmentSlider
            density="compact"
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
            density="compact"
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
            density="compact"
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
            density="compact"
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
            density="compact"
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
            density="compact"
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
            density="compact"
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
      </div>
    </details>
  );
};
