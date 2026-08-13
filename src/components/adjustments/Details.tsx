import { useTranslation } from 'react-i18next';
import Slider from '../ui/Slider';
import { Adjustments, AdjustmentsUpdater, DetailsAdjustment } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface DetailsPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: AdjustmentsUpdater): void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function DetailsPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  onDragStateChange,
}: DetailsPanelProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: numericValue }));
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};

  return (
    <div className="space-y-4">
      {adjustmentVisibility.sharpening !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.sharpening')}
          </Text>
          <Slider
            label={t('adjustments.details.sharpness')}
            max={100}
            min={-100}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.Sharpness, String(e.target.value))}
            step={1}
            value={adjustments.sharpness}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.threshold')}
            max={80}
            min={0}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.SharpnessThreshold, String(e.target.value))}
            step={1}
            value={adjustments.sharpnessThreshold}
            onDragStateChange={onDragStateChange}
            defaultValue={15}
            fillOrigin="min"
          />
        </div>
      )}

      {adjustmentVisibility.presence !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.presence')}
          </Text>
          <Slider
            label={t('adjustments.details.clarity')}
            max={100}
            min={-100}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.Clarity, String(e.target.value))}
            step={1}
            value={adjustments.clarity}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.dehaze')}
            max={100}
            min={-100}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.Dehaze, String(e.target.value))}
            step={1}
            value={adjustments.dehaze}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.structure')}
            max={100}
            min={-100}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.Structure, String(e.target.value))}
            step={1}
            value={adjustments.structure}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <Slider
              label={t('adjustments.details.centre')}
              max={100}
              min={-100}
              onChange={(e) => handleAdjustmentChange(DetailsAdjustment.Centré, String(e.target.value))}
              step={1}
              value={adjustments.centré}
              onDragStateChange={onDragStateChange}
            />
          )}
        </div>
      )}

      {adjustmentVisibility.noiseReduction !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.noiseReduction')}
          </Text>
          <Slider
            label={t('adjustments.details.luminance')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.LumaNoiseReduction, String(e.target.value))}
            step={1}
            value={adjustments.lumaNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.color')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.ColorNoiseReduction, String(e.target.value))}
            step={1}
            value={adjustments.colorNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}

      {!isForMask && adjustmentVisibility.chromaticAberration !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.chromaticAberration')}
          </Text>
          <Slider
            label={t('adjustments.details.redCyan')}
            max={100}
            min={-100}
            onChange={(e) => handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationRedCyan, String(e.target.value))}
            step={1}
            value={adjustments.chromaticAberrationRedCyan}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.blueYellow')}
            max={100}
            min={-100}
            onChange={(e) =>
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationBlueYellow, String(e.target.value))
            }
            step={1}
            value={adjustments.chromaticAberrationBlueYellow}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}
    </div>
  );
}
