import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditDocumentNodeParamsV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { useEditorStore } from '../../store/useEditorStore';
import { TextVariants } from '../../types/typography';
import { DetailsAdjustment } from '../../utils/adjustments';
import {
  buildDetailEditTransaction,
  type DetailCommitIdentity,
  isDetailBooleanNodeAdjustment,
  isDetailNumberNodeAdjustment,
} from '../../utils/detailEditTransaction';
import {
  buildLensCorrectionEditTransaction,
  isManualLensCorrectionAdjustment,
} from '../../utils/lensCorrectionEditTransaction';
import type { AppSettings } from '../ui/AppProperties';
import { professionalInspectorDensityTokens } from '../ui/inspectorTokens';
import Switch from '../ui/primitives/Switch';
import UiText from '../ui/primitives/Text';
import AdjustmentSlider from './AdjustmentSlider';

export type DetailAdjustmentView = EditDocumentNodeParamsV2<'detail_denoise_dehaze'> &
  EditDocumentNodeParamsV2<'lens_correction'>;
export type DetailAdjustmentUpdate =
  | Partial<DetailAdjustmentView>
  | ((prev: DetailAdjustmentView) => DetailAdjustmentView);

interface DetailsPanelProps {
  adjustments: DetailAdjustmentView;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

type AdjustmentUpdate = DetailAdjustmentUpdate;
const detailGroupClassName = 'border-b border-editor-border py-1.5';

export default function DetailsPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  onDragStateChange,
}: DetailsPanelProps) {
  const { t } = useTranslation();
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const detailCommitIdentity = useMemo<DetailCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const detailCommitIdentityRef = useRef(detailCommitIdentity);
  detailCommitIdentityRef.current = detailCommitIdentity;

  const handleAdjustmentChange = (key: DetailsAdjustment, value: number) => {
    const nextValue = Math.trunc(value);
    if (!isForMask && isManualLensCorrectionAdjustment(key)) {
      const identity = detailCommitIdentityRef.current;
      if (identity === null) return;
      const result = applyEditTransaction(
        buildLensCorrectionEditTransaction(useEditorStore.getState(), identity, key, nextValue, crypto.randomUUID()),
      );
      detailCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
      return;
    }
    if (!isForMask && isDetailNumberNodeAdjustment(key)) {
      const identity = detailCommitIdentityRef.current;
      if (identity === null) return;
      const result = applyEditTransaction(
        buildDetailEditTransaction(useEditorStore.getState(), identity, key, nextValue, crypto.randomUUID()),
      );
      detailCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
      return;
    }
    setAdjustments((prev: DetailAdjustmentView) => ({ ...prev, [key]: nextValue }));
  };

  const handleFloatAdjustmentChange = (key: DetailsAdjustment, value: number) => {
    if (!isForMask && isDetailNumberNodeAdjustment(key)) {
      const identity = detailCommitIdentityRef.current;
      if (identity === null) return;
      const result = applyEditTransaction(
        buildDetailEditTransaction(useEditorStore.getState(), identity, key, value, crypto.randomUUID()),
      );
      detailCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
      return;
    }
    setAdjustments((prev: DetailAdjustmentView) => ({ ...prev, [key]: value }));
  };

  const handleBooleanAdjustmentChange = (key: DetailsAdjustment, value: boolean) => {
    if (!isForMask && isDetailBooleanNodeAdjustment(key)) {
      const identity = detailCommitIdentityRef.current;
      if (identity === null) return;
      const result = applyEditTransaction(
        buildDetailEditTransaction(useEditorStore.getState(), identity, key, value, crypto.randomUUID()),
      );
      detailCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: result.nextAdjustmentRevision,
      };
      return;
    }
    setAdjustments((prev: DetailAdjustmentView) => ({ ...prev, [key]: value }));
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const density = professionalInspectorDensityTokens;

  return (
    <div
      className="space-y-0"
      data-commit-adjustment-revision={detailCommitIdentity?.adjustmentRevision}
      data-commit-image-session={detailCommitIdentity?.imageSessionId}
      data-commit-source-identity={detailCommitIdentity?.sourceIdentity}
      data-testid="detail-controls"
    >
      {!isForMask && adjustmentVisibility['deblur'] !== false && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.deblur')}
          </UiText>
          <Switch
            chrome="editor"
            checked={adjustments.deblurEnabled}
            id="detail-control-deblur-enabled"
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
            testId="detail-control-deblur-strength"
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
            testId="detail-control-deblur-sigma"
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

      {adjustmentVisibility['sharpening'] !== false && (
        <div className={detailGroupClassName}>
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.sharpening')}
          </UiText>
          <AdjustmentSlider
            density="compact"
            label={t('adjustments.details.sharpness')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.Sharpness, value);
            }}
            step={1}
            testId="detail-control-sharpness"
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
          {!isForMask && (
            <>
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.detail')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseDetail, value);
                }}
                step={1}
                value={adjustments.denoiseDetail}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.naturalGrain')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseNaturalGrain, value);
                }}
                step={1}
                value={adjustments.denoiseNaturalGrain}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.contrastProtection')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseContrastProtection, value);
                }}
                step={1}
                value={adjustments.denoiseContrastProtection}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.details.shadowBias')}
                max={100}
                min={-100}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseShadowBias, value);
                }}
                step={1}
                value={adjustments.denoiseShadowBias}
                onDragStateChange={onDragStateChange}
              />
            </>
          )}
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
