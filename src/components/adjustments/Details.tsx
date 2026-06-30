import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../types/typography';
import { type Adjustments, DetailsAdjustment } from '../../utils/adjustments';
import type { AppSettings } from '../ui/AppProperties';
import Slider, { type SliderChangeEvent } from '../ui/Slider';
import Switch from '../ui/Switch';
import UiText from '../ui/Text';
import AdjustmentSlider from './AdjustmentSlider';

interface DetailsPanelProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);

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

  return (
    <div className="space-y-4">
      {!isForMask && adjustmentVisibility['deblur'] !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.deblur')}
          </UiText>
          <Switch
            checked={adjustments.deblurEnabled}
            label={t('adjustments.details.enableDeblur')}
            onChange={(checked) => {
              handleBooleanAdjustmentChange(DetailsAdjustment.DeblurEnabled, checked);
            }}
          />
          <AdjustmentSlider
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
          <UiText variant={TextVariants.small} className="mt-2 text-text-secondary">
            {t('adjustments.details.deblurStatus')}
          </UiText>
        </div>
      )}

      {!isForMask && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.dustSpotVisualization')}
          </UiText>
          <Switch
            checked={adjustments.dustSpotOverlayEnabled}
            label={t('adjustments.details.showDustOverlay')}
            onChange={(checked) => {
              handleBooleanAdjustmentChange(DetailsAdjustment.DustSpotOverlayEnabled, checked);
            }}
          />
          <div className="mt-3 rounded-md border border-border-color bg-bg-primary p-3">
            <div className="relative h-24 overflow-hidden rounded bg-linear-to-br from-[#20242a] via-[#34313a] to-[#15171b]">
              {[18, 31, 46, 59, 77].map((left, index) => (
                <span
                  aria-hidden="true"
                  className={`absolute rounded-full border ${
                    adjustments.dustSpotOverlayEnabled
                      ? 'border-red-300 bg-red-500/25 shadow-[0_0_12px_rgba(248,113,113,0.45)]'
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
            <UiText variant={TextVariants.small} className="mt-2 text-text-secondary">
              {t('adjustments.details.dustOverlayStatus')}
            </UiText>
          </div>
          <Slider
            label={t('adjustments.details.sensitivity')}
            max={100}
            min={0}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.DustSpotSensitivity, Number(e.target.value));
            }}
            step={1}
            value={adjustments.dustSpotSensitivity}
            onDragStateChange={onDragStateChange}
            disabled={!adjustments.dustSpotOverlayEnabled}
            fillOrigin="min"
          />
          <Slider
            label={t('adjustments.details.minSpotRadius')}
            max={12}
            min={1}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.DustSpotMinRadiusPx, Number(e.target.value));
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
        <div className="p-2 bg-bg-tertiary rounded-md">
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.sharpening')}
          </UiText>
          <AdjustmentSlider
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
        <div className="p-2 bg-bg-tertiary rounded-md">
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.presence')}
          </UiText>
          <AdjustmentSlider
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
              <UiText variant={TextVariants.small} className="mt-2 text-text-secondary">
                {t('adjustments.details.localContrastStatus')}
              </UiText>
            </>
          )}
          {!isForMask && (
            <AdjustmentSlider
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
        <div className="p-2 bg-bg-tertiary rounded-md">
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.noiseReduction')}
          </UiText>
          <AdjustmentSlider
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
        <div className="p-2 bg-bg-tertiary rounded-md">
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.chromaticAberration')}
          </UiText>
          <AdjustmentSlider
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
