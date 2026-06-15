import { type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { TextVariants } from '../../types/typography';
import { Adjustments, DetailsAdjustment } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import UiText from '../ui/Text';

interface DetailsPanelProps {
  adjustments: Adjustments;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Partial<Adjustments>) => Partial<Adjustments>);

type SliderChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | {
      target: {
        value: number | string;
      };
    };

export default function DetailsPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  onDragStateChange,
}: DetailsPanelProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: string, value: number | string) => {
    const numericValue = parseInt(String(value), 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleFloatAdjustmentChange = (key: string, value: number | string) => {
    const numericValue = parseFloat(String(value));
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleBooleanAdjustmentChange = (key: string, value: boolean) => {
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: value }));
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
          <Slider
            label={t('adjustments.details.amount')}
            max={100}
            min={0}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.DeblurStrength, e.target.value);
            }}
            step={1}
            value={adjustments.deblurStrength}
            onDragStateChange={onDragStateChange}
            disabled={!adjustments.deblurEnabled}
            fillOrigin="min"
          />
          <Slider
            label={t('adjustments.details.blurRadius')}
            max={1.35}
            min={0.45}
            onChange={(e: SliderChangeEvent) => {
              handleFloatAdjustmentChange(DetailsAdjustment.DeblurSigmaPx, e.target.value);
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

      {adjustmentVisibility['sharpening'] !== false && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('adjustments.details.sharpening')}
          </UiText>
          <Slider
            label={t('adjustments.details.sharpness')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.Sharpness, e.target.value);
            }}
            step={1}
            value={adjustments.sharpness}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.threshold')}
            max={80}
            min={0}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.SharpnessThreshold, e.target.value);
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
          <Slider
            label={t('adjustments.details.clarity')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.Clarity, e.target.value);
            }}
            step={1}
            value={adjustments.clarity}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.dehaze')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.Dehaze, e.target.value);
            }}
            step={1}
            value={adjustments.dehaze}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.structure')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.Structure, e.target.value);
            }}
            step={1}
            value={adjustments.structure}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <>
              <Slider
                label={t('adjustments.details.localContrastRadius')}
                max={96}
                min={4}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(DetailsAdjustment.LocalContrastRadiusPx, e.target.value);
                }}
                step={1}
                value={adjustments.localContrastRadiusPx}
                onDragStateChange={onDragStateChange}
                defaultValue={24}
                suffix=" px"
              />
              <Slider
                label={t('adjustments.details.haloGuard')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(DetailsAdjustment.LocalContrastHaloGuard, e.target.value);
                }}
                step={1}
                value={adjustments.localContrastHaloGuard}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.details.midtoneMask')}
                max={100}
                min={0}
                onChange={(e: SliderChangeEvent) => {
                  handleAdjustmentChange(DetailsAdjustment.LocalContrastMidtoneMask, e.target.value);
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
            <Slider
              label={t('adjustments.details.centre')}
              max={100}
              min={-100}
              onChange={(e: SliderChangeEvent) => {
                handleAdjustmentChange(DetailsAdjustment.Centré, e.target.value);
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
          <Slider
            label={t('adjustments.details.luminance')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.LumaNoiseReduction, e.target.value);
            }}
            step={1}
            value={adjustments.lumaNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.color')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.ColorNoiseReduction, e.target.value);
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
          <Slider
            label={t('adjustments.details.redCyan')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationRedCyan, e.target.value);
            }}
            step={1}
            value={adjustments.chromaticAberrationRedCyan}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.blueYellow')}
            max={100}
            min={-100}
            onChange={(e: SliderChangeEvent) => {
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationBlueYellow, e.target.value);
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
