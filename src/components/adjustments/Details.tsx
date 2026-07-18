import { useEffect, useMemo, useRef, useState } from 'react';
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
import { type DetailModifierPreview, resolveDetailModifierPreview } from '../../utils/detailLoupe';
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
  const setEditor = useEditorStore((state) => state.setEditor);
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
  const [hoveredModifier, setHoveredModifier] = useState<DetailModifierPreview | null>(null);
  const [modifierPreview, setModifierPreview] = useState<DetailModifierPreview | null>(null);
  const detailSliderInteractionRef = useRef<{ changed: boolean; transactionId: string } | null>(null);
  const altKeyRef = useRef(false);
  const draggingModifierRef = useRef<DetailModifierPreview | null>(null);
  useEffect(() => {
    const clearModifierPreview = () => {
      altKeyRef.current = false;
      draggingModifierRef.current = null;
      setModifierPreview(null);
      setEditor({ detailModifierPreview: null });
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      altKeyRef.current = true;
      const nextPreview = resolveDetailModifierPreview({
        altKey: true,
        dragging: draggingModifierRef.current !== null,
        hovered: draggingModifierRef.current ?? hoveredModifier,
      });
      setModifierPreview(nextPreview);
      setEditor({ detailModifierPreview: nextPreview });
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || !event.altKey) clearModifierPreview();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearModifierPreview);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearModifierPreview);
    };
  }, [hoveredModifier, setEditor]);
  useEffect(() => () => setEditor({ detailModifierPreview: null }), [setEditor]);
  useEffect(() => {
    draggingModifierRef.current = null;
    setModifierPreview(null);
    setEditor({ detailModifierPreview: null });
  }, [detailCommitIdentity?.imageSessionId, detailCommitIdentity?.sourceIdentity, isForMask, setEditor]);
  const handleModifierDragState = (kind: DetailModifierPreview, dragging: boolean) => {
    onDragStateChange?.(dragging);
    draggingModifierRef.current = dragging ? kind : null;
    const nextPreview = resolveDetailModifierPreview({ altKey: altKeyRef.current, dragging, hovered: kind });
    setModifierPreview(nextPreview);
    setEditor({ detailModifierPreview: nextPreview });
  };

  const beginDetailInteraction = () => {
    if (isForMask) {
      onDragStateChange?.(true);
      return;
    }
    if (detailCommitIdentityRef.current === null || detailSliderInteractionRef.current !== null) return;
    detailSliderInteractionRef.current = { changed: false, transactionId: crypto.randomUUID() };
  };

  const commitDetailInteraction = () => {
    if (isForMask) {
      onDragStateChange?.(false);
      return;
    }
    detailSliderInteractionRef.current = null;
  };

  const cancelDetailInteraction = () => {
    if (isForMask) {
      onDragStateChange?.(false);
      return;
    }
    const interaction = detailSliderInteractionRef.current;
    detailSliderInteractionRef.current = null;
    if (interaction?.changed !== true) return;
    const state = useEditorStore.getState();
    state.undo();
    const identity = detailCommitIdentityRef.current;
    if (identity !== null) {
      detailCommitIdentityRef.current = {
        ...identity,
        adjustmentRevision: useEditorStore.getState().adjustmentRevision,
      };
    }
  };

  const detailInteractionProps = isForMask
    ? {}
    : {
        onInteractionCancel: cancelDetailInteraction,
        onInteractionCommit: commitDetailInteraction,
        onInteractionStart: beginDetailInteraction,
      };

  useEffect(
    () => () => {
      detailSliderInteractionRef.current = null;
    },
    [imageSessionId, isForMask, selectedImagePath],
  );

  const handleAdjustmentChange = (key: DetailsAdjustment, value: number) => {
    const nextValue = Math.trunc(value);
    if (!isForMask && isDetailNumberNodeAdjustment(key)) {
      const identity = detailCommitIdentityRef.current;
      if (identity === null) return;
      const interaction = detailSliderInteractionRef.current;
      const transactionId = interaction?.transactionId ?? crypto.randomUUID();
      const result = applyEditTransaction(
        buildDetailEditTransaction(
          useEditorStore.getState(),
          identity,
          key,
          nextValue,
          transactionId,
          interaction?.changed === true ? 'coalesced-interaction' : 'single-entry',
        ),
      );
      if (interaction !== null) interaction.changed = true;
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
      const interaction = detailSliderInteractionRef.current;
      const transactionId = interaction?.transactionId ?? crypto.randomUUID();
      const result = applyEditTransaction(
        buildDetailEditTransaction(
          useEditorStore.getState(),
          identity,
          key,
          value,
          transactionId,
          interaction?.changed === true ? 'coalesced-interaction' : 'single-entry',
        ),
      );
      if (interaction !== null) interaction.changed = true;
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
      {adjustmentVisibility['sharpening'] !== false && (
        <div
          className={detailGroupClassName}
          data-detail-modifier="sharpening"
          data-testid="detail-section-sharpening"
          onPointerEnter={() => setHoveredModifier('sharpening')}
          onPointerLeave={() => {
            setHoveredModifier(null);
            if (!draggingModifierRef.current) {
              setModifierPreview(null);
              setEditor({ detailModifierPreview: null });
            }
          }}
        >
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.sharpening')}
          </UiText>
          <AdjustmentSlider
            {...detailInteractionProps}
            density="compact"
            label={t('adjustments.details.amount')}
            max={100}
            min={-100}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.Sharpness, value);
            }}
            step={1}
            testId="detail-control-sharpening-amount"
            value={adjustments.sharpness}
            onDragStateChange={(dragging) => handleModifierDragState('sharpening', dragging)}
          />
          {!isForMask && (
            <AdjustmentSlider
              {...detailInteractionProps}
              density="compact"
              label={t('adjustments.details.radius')}
              max={96}
              min={4}
              onValueChange={(value) => {
                handleAdjustmentChange(DetailsAdjustment.LocalContrastRadiusPx, value);
              }}
              step={1}
              suffix=" px"
              testId="detail-control-sharpening-radius"
              value={adjustments.localContrastRadiusPx}
              onDragStateChange={(dragging) => handleModifierDragState('sharpening', dragging)}
              defaultValue={24}
              fillOrigin="min"
            />
          )}
          <AdjustmentSlider
            {...detailInteractionProps}
            density="compact"
            label={t('adjustments.details.detail')}
            max={80}
            min={0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.SharpnessThreshold, value);
            }}
            step={1}
            testId="detail-control-sharpening-detail"
            value={adjustments.sharpnessThreshold}
            onDragStateChange={(dragging) => handleModifierDragState('sharpening', dragging)}
            defaultValue={15}
            fillOrigin="min"
          />
          {!isForMask && (
            <AdjustmentSlider
              {...detailInteractionProps}
              density="compact"
              label={t('adjustments.details.masking')}
              max={100}
              min={0}
              onValueChange={(value) => {
                handleAdjustmentChange(DetailsAdjustment.LocalContrastMidtoneMask, value);
              }}
              step={1}
              testId="detail-control-sharpening-masking"
              value={adjustments.localContrastMidtoneMask}
              onDragStateChange={(dragging) => handleModifierDragState('sharpening', dragging)}
              defaultValue={50}
              fillOrigin="min"
            />
          )}
          {modifierPreview === 'sharpening' && (
            <div
              className="mt-1 rounded border border-editor-info/40 bg-editor-info-surface px-2 py-1 text-[11px] text-editor-info"
              data-detail-modifier-preview="sharpening"
              data-testid="detail-modifier-preview"
            >
              {t('adjustments.details.altPreviewSharpening')}
            </div>
          )}
        </div>
      )}

      {adjustmentVisibility['noiseReduction'] !== false && (
        <div
          className={detailGroupClassName}
          data-detail-modifier="noise-reduction"
          data-testid="detail-section-noise-reduction"
          onPointerEnter={() => setHoveredModifier('noise-reduction')}
          onPointerLeave={() => {
            setHoveredModifier(null);
            if (!draggingModifierRef.current) {
              setModifierPreview(null);
              setEditor({ detailModifierPreview: null });
            }
          }}
        >
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.noiseReduction')}
          </UiText>
          <AdjustmentSlider
            {...detailInteractionProps}
            density="compact"
            label={t('adjustments.details.luminance')}
            max={100}
            min={isForMask ? -100 : 0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.LumaNoiseReduction, value);
            }}
            step={1}
            testId="detail-control-noise-luminance"
            value={adjustments.lumaNoiseReduction}
            onDragStateChange={(dragging) => handleModifierDragState('noise-reduction', dragging)}
          />
          {!isForMask && (
            <>
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.detail')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseDetail, value);
                }}
                step={1}
                testId="detail-control-noise-detail"
                value={adjustments.denoiseDetail}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.contrastProtection')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseContrastProtection, value);
                }}
                step={1}
                testId="detail-control-noise-contrast"
                value={adjustments.denoiseContrastProtection}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
            </>
          )}
          {modifierPreview === 'noise-reduction' && (
            <div
              className="mt-1 rounded border border-editor-warning/40 bg-editor-warning-surface px-2 py-1 text-[11px] text-editor-warning"
              data-detail-modifier-preview="noise-reduction"
              data-testid="detail-modifier-preview"
            >
              {t('adjustments.details.altPreviewNoiseReduction')}
            </div>
          )}
        </div>
      )}

      {adjustmentVisibility['noiseReduction'] !== false && (
        <div className={detailGroupClassName} data-testid="detail-section-color-noise-reduction">
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.colorNoiseReduction')}
          </UiText>
          <AdjustmentSlider
            {...detailInteractionProps}
            density="compact"
            label={t('adjustments.details.color')}
            max={100}
            min={isForMask ? -100 : 0}
            onValueChange={(value) => {
              handleAdjustmentChange(DetailsAdjustment.ColorNoiseReduction, value);
            }}
            step={1}
            testId="detail-control-color-noise-color"
            value={adjustments.colorNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <>
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.detail')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseDetail, value);
                }}
                step={1}
                testId="detail-control-color-noise-detail"
                value={adjustments.denoiseDetail}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.smoothness')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseNaturalGrain, 100 - value);
                }}
                step={1}
                testId="detail-control-color-noise-smoothness"
                value={100 - adjustments.denoiseNaturalGrain}
                onDragStateChange={onDragStateChange}
                defaultValue={100}
                fillOrigin="min"
              />
            </>
          )}
        </div>
      )}

      <details className={detailGroupClassName} data-testid="detail-advanced">
        <summary className="cursor-pointer list-none">
          <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
            {t('adjustments.details.advanced')}
          </UiText>
        </summary>
        <div className="pt-1">
          {!isForMask && adjustmentVisibility['deblur'] !== false && (
            <div data-testid="detail-advanced-deblur">
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
                {...detailInteractionProps}
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
                {...detailInteractionProps}
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
          {!isForMask && (
            <div data-testid="detail-advanced-existing">
              <UiText variant={TextVariants.heading} className={density.sectionHeader.title}>
                {t('adjustments.details.sharpening')}
              </UiText>
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.haloGuard')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.LocalContrastHaloGuard, value);
                }}
                step={1}
                testId="detail-control-advanced-halo-guard"
                value={adjustments.localContrastHaloGuard}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.centre')}
                max={100}
                min={-100}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.Centré, value);
                }}
                step={1}
                testId="detail-control-advanced-centre"
                value={adjustments.centré}
                onDragStateChange={onDragStateChange}
              />
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.naturalGrain')}
                max={100}
                min={0}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseNaturalGrain, value);
                }}
                step={1}
                testId="detail-control-advanced-natural-grain"
                value={adjustments.denoiseNaturalGrain}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <AdjustmentSlider
                {...detailInteractionProps}
                density="compact"
                label={t('adjustments.details.shadowBias')}
                max={100}
                min={-100}
                onValueChange={(value) => {
                  handleAdjustmentChange(DetailsAdjustment.DenoiseShadowBias, value);
                }}
                step={1}
                testId="detail-control-advanced-shadow-bias"
                value={adjustments.denoiseShadowBias}
                onDragStateChange={onDragStateChange}
              />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
