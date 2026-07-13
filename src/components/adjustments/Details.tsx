import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../types/typography';
import { type Adjustments, DetailsAdjustment } from '../../utils/adjustments';
import type { AppSettings } from '../ui/AppProperties';
import { professionalInspectorDensityTokens } from '../ui/inspectorTokens';
import Switch from '../ui/primitives/Switch';
import UiText from '../ui/primitives/Text';
import AdjustmentSlider from './AdjustmentSlider';

interface DetailsPanelProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);
const detailGroupClassName = 'border-b border-editor-border py-1.5';

export default function DetailsPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  onDragStateChange,
}: DetailsPanelProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: string, value: number) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: Math.trunc(value) }));
  };

  const handleFloatAdjustmentChange = (key: string, value: number) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: value }));
  };

  const handleBooleanAdjustmentChange = (key: string, value: boolean) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: value }));
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const density = professionalInspectorDensityTokens;

  return (
    <div className="space-y-0">
      {!isForMask && adjustmentVisibility['deblur'] !== false && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.deblur')}
          </UiText>
          <Switch
            chrome="editor"
            checked={adjustments.deblurEnabled}
            label={t('adjustments.details.enableDeblur')}
            onChange={(checked) => {
              handleBooleanAdjustmentChange(DetailsAdjustment.DeblurEnabled, checked);
            }}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.amount')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.DeblurStrength, value);
            }}
            step={1}
            value={adjustments.deblurStrength}
            onDragStateChange={onDragStateChange}
            disabled={!adjustments.deblurEnabled}
            fillOrigin="min"
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.blurRadius')}
            max={1.35}
            min={0.45}
            onValueChange={(value) => {
              handleFloatAdjustmentChange(DetailsAdjustment.DeblurSigmaPx, value);
            }}
            step={0.05}
            value={adjustments.deblurSigmaPx}
            onDragStateChange={onDragStateChange}
            disabled={!adjustments.deblurEnabled}
            defaultValue={0.8}
            suffix=" px"
          />
          <UiText variant={TextVariants.small} className="mt-1 text-[11px] leading-4 text-text-secondary">
            {t('adjustments.details.deblurStatus')}
          </UiText>
        </div>
      )}

      {!isForMask && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.dustSpotVisualization')}
          </UiText>
          <Switch
            chrome="editor"
            checked={adjustments.dustSpotOverlayEnabled}
            label={t('adjustments.details.showDustOverlay')}
            onChange={(checked) => {
              handleBooleanAdjustmentChange(DetailsAdjustment.DustSpotOverlayEnabled, checked);
            }}
          />
          <div className="mt-1.5 rounded border border-editor-border bg-editor-panel p-1.5">
            <div className="relative h-16 overflow-hidden rounded bg-linear-to-br from-[#20242a] via-[#34313a] to-[#15171b]">
              {[18, 31, 46, 59, 77].map((left, index) => (
                <span
                  aria-hidden="true"
                  className={`absolute rounded-full border ${
                    adjustments.dustSpotOverlayEnabled
                      ? 'border-editor-danger bg-editor-danger-surface shadow-[0_0_12px_var(--editor-danger-surface)]'
                      : 'border-white/10 bg-white/5'
                  }`}
                  key={left}
                  style={{
                    height: `${Math.max(6, adjustments.dustSpotMinRadiusPx * 4 + index)}px`,
                    left: `${left}%`,
                    top: `${16 + ((index * 13) % 58)}%`,
                    width: `${Math.max(6, adjustments.dustSpotMinRadiusPx * 4 + index)}px`,
                  }}
                />
              ))}
            </div>
            <UiText variant={TextVariants.small} className="mt-1 text-[11px] leading-4 text-text-secondary">
              {t('adjustments.details.dustOverlayStatus')}
            </UiText>
          </div>
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.sensitivity')}
            max={100}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.DustSpotSensitivity, value);
            }}
            step={1}
            value={adjustments.dustSpotSensitivity}
            onDragStateChange={onDragStateChange}
            disabled={!adjustments.dustSpotOverlayEnabled}
            fillOrigin="min"
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.minSpotRadius')}
            max={12}
            min={1}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.DustSpotMinRadiusPx, value);
            }}
            step={1}
            value={adjustments.dustSpotMinRadiusPx}
            onDragStateChange={onDragStateChange}
            disabled={!adjustments.dustSpotOverlayEnabled}
            suffix=" px"
          />
        </div>
      )}

      {adjustmentVisibility['sharpening'] !== false && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.sharpening')}
          </UiText>
          <Switch
            chrome="editor"
            checked={adjustments.multiscaleDetail.process === 'multiscale_v1'}
            label={t('adjustments.details.multiscaleDetail')}
            onChange={(checked) => {
              setAdjustments((prev: Adjustments) => ({
                ...prev,
                multiscaleDetail: {
                  ...prev.multiscaleDetail,
                  process: checked ? 'multiscale_v1' : 'legacy_v1',
                },
              }));
            }}
          />
          {adjustments.multiscaleDetail.process === 'multiscale_v1' && (
            <>
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.texture')}
                max={100}
                min={-100}
                onValueChange={(value) => {
                  setAdjustments((prev: Adjustments) => ({
                    ...prev,
                    multiscaleDetail: { ...prev.multiscaleDetail, texture: Math.trunc(value) },
                  }));
                }}
                step={1}
                value={adjustments.multiscaleDetail.texture}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.noiseProtection')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  setAdjustments((prev: Adjustments) => ({
                    ...prev,
                    multiscaleDetail: { ...prev.multiscaleDetail, noiseProtection: Math.trunc(value) },
                  }));
                }}
                step={1}
                value={adjustments.multiscaleDetail.noiseProtection}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <details className="mt-1 rounded border border-editor-border px-1.5 py-1">
                <summary className="cursor-pointer text-[11px] text-text-secondary">
                  {t('adjustments.details.advancedEqualizer')}
                </summary>
                {(['finest', 'fine', 'medium', 'coarse'] as const).map((band) => (
                  <AdjustmentSlider
                    density="compact"
                    key={band}
                    label={t(`adjustments.details.band.${band}`)}
                    max={100}
                    min={-100}
                    onValueChange={(value) => {
                      setAdjustments((prev: Adjustments) => ({
                        ...prev,
                        multiscaleDetail: { ...prev.multiscaleDetail, [band]: Math.trunc(value) },
                      }));
                    }}
                    step={1}
                    value={adjustments.multiscaleDetail[band]}
                    onDragStateChange={onDragStateChange}
                  />
                ))}
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.details.overallDetailAmount')}
                  max={100}
                  min={0}
                  onValueChange={(value) => {
                    setAdjustments((prev: Adjustments) => ({
                      ...prev,
                      multiscaleDetail: { ...prev.multiscaleDetail, overallAmount: Math.trunc(value) },
                    }));
                  }}
                  step={1}
                  value={adjustments.multiscaleDetail.overallAmount}
                  onDragStateChange={onDragStateChange}
                  defaultValue={100}
                  fillOrigin="min"
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.details.haloSuppression')}
                  max={100}
                  min={0}
                  onValueChange={(value) => {
                    setAdjustments((prev: Adjustments) => ({
                      ...prev,
                      multiscaleDetail: { ...prev.multiscaleDetail, haloSuppression: Math.trunc(value) },
                    }));
                  }}
                  step={1}
                  value={adjustments.multiscaleDetail.haloSuppression}
                  onDragStateChange={onDragStateChange}
                  defaultValue={50}
                  fillOrigin="min"
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.details.ringingSuppression')}
                  max={100}
                  min={0}
                  onValueChange={(value) => {
                    setAdjustments((prev: Adjustments) => ({
                      ...prev,
                      multiscaleDetail: { ...prev.multiscaleDetail, ringingSuppression: Math.trunc(value) },
                    }));
                  }}
                  step={1}
                  value={adjustments.multiscaleDetail.ringingSuppression}
                  onDragStateChange={onDragStateChange}
                  defaultValue={50}
                  fillOrigin="min"
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.details.chromaDetail')}
                  max={100}
                  min={0}
                  onValueChange={(value) => {
                    setAdjustments((prev: Adjustments) => ({
                      ...prev,
                      multiscaleDetail: { ...prev.multiscaleDetail, chromaDetail: Math.trunc(value) },
                    }));
                  }}
                  step={1}
                  value={adjustments.multiscaleDetail.chromaDetail}
                  onDragStateChange={onDragStateChange}
                  fillOrigin="min"
                />
              </details>
            </>
          )}
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.sharpness')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.Sharpness, value);
            }}
            step={1}
            value={adjustments.sharpness}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.threshold')}
            max={80}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.SharpnessThreshold, value);
            }}
            step={1}
            value={adjustments.sharpnessThreshold}
            onDragStateChange={onDragStateChange}
            defaultValue={15}
            fillOrigin="min"
          />
        </div>
      )}

      {adjustmentVisibility['presence'] !== false && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.presence')}
          </UiText>
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.clarity')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.Clarity, value);
            }}
            step={1}
            value={adjustments.clarity}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.dehaze')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.Dehaze, value);
            }}
            step={1}
            value={adjustments.dehaze}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.structure')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.Structure, value);
            }}
            step={1}
            value={adjustments.structure}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <>
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.localContrastRadius')}
                max={96}
                min={4}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.LocalContrastRadiusPx, value);
                }}
                step={1}
                value={adjustments.localContrastRadiusPx}
                onDragStateChange={onDragStateChange}
                defaultValue={24}
                suffix=" px"
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.haloGuard')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.LocalContrastHaloGuard, value);
                }}
                step={1}
                value={adjustments.localContrastHaloGuard}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.midtoneMask')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.LocalContrastMidtoneMask, value);
                }}
                step={1}
                value={adjustments.localContrastMidtoneMask}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <UiText variant={TextVariants.small} className="mt-1 text-[11px] leading-4 text-text-secondary">
                {t('adjustments.details.localContrastStatus')}
              </UiText>
            </>
          )}
          {!isForMask && (
            <AdjustmentSlider
              density="compact"
              label={t('adjustments.details.centre')}
              max={100}
              min={-100}
              onValueChange={(value) => {
                handleAdjustmentChange(DetailsAdjustment.Centré, value);
              }}
              step={1}
              value={adjustments.centré}
              onDragStateChange={onDragStateChange}
            />
          )}
        </div>
      )}

      {adjustmentVisibility['noiseReduction'] !== false && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.noiseReduction')}
          </UiText>
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.luminance')}
            max={100}
            min={isForMask ? -100 : 0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.LumaNoiseReduction, value);
            }}
            step={1}
            value={adjustments.lumaNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.color')}
            max={100}
            min={isForMask ? -100 : 0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.ColorNoiseReduction, value);
            }}
            step={1}
            value={adjustments.colorNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}

      {!isForMask && adjustmentVisibility['chromaticAberration'] !== false && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.chromaticAberration')}
          </UiText>
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.redCyan')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationRedCyan, value);
            }}
            step={1}
            value={adjustments.chromaticAberrationRedCyan}
            onDragStateChange={onDragStateChange}
          />
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.blueYellow')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationBlueYellow, value);
            }}
            step={1}
            value={adjustments.chromaticAberrationBlueYellow}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}
    </div>
  );
}
