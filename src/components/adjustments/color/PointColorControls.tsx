import { Crosshair, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { POINT_COLOR_MAX_POINTS_V1 } from '../../../../packages/rawengine-schema/src/color/pointColorSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import {
  buildPointColorEditTransaction,
  type PointColorCommitIdentity,
  type PointColorPatch,
} from '../../../utils/pointColorEditTransaction';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import AdjustmentSlider from '../AdjustmentSlider';
import type { ColorPanelGroupProps } from './types';

interface PointColorControlsProps extends ColorPanelGroupProps {
  isForMask?: boolean;
}

const clampPointName = (value: string): string => value.trim().slice(0, 80);

export const PointColorControls = ({
  adjustments,
  isForMask = false,
  onDragStateChange,
  setAdjustments,
}: PointColorControlsProps) => {
  const { t } = useTranslation();
  const pointColorPickerActive = useUIStore((state) => state.pointColorPickerActive);
  const pointColorPickerReceipt = useUIStore((state) => state.pointColorPickerReceipt);
  const setUI = useUIStore((state) => state.setUI);
  const adjustmentRevision = useEditorStore((state) => state.adjustmentRevision);
  const applyEditTransaction = useEditorStore((state) => state.applyEditTransaction);
  const imageSessionId = useEditorStore(
    (state) => state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
  );
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const commitIdentity = useMemo<PointColorCommitIdentity | null>(
    () =>
      !isForMask && selectedImagePath !== null
        ? { adjustmentRevision, imageSessionId, sourceIdentity: selectedImagePath }
        : null,
    [adjustmentRevision, imageSessionId, isForMask, selectedImagePath],
  );
  const commitIdentityRef = useRef(commitIdentity);
  commitIdentityRef.current = commitIdentity;
  const plan = adjustments.pointColor;
  const pointLimitReached = plan.points.length >= POINT_COLOR_MAX_POINTS_V1;
  const canSampleFromImage = !isForMask && selectedImagePath !== null && !pointLimitReached;
  const selected = useMemo(
    () => plan.points.find((point) => point.id === plan.selectedPointId) ?? plan.points[0] ?? null,
    [plan.points, plan.selectedPointId],
  );
  const sample = selected?.samples[0] ?? null;
  const currentPointColorPickerReceipt =
    pointColorPickerReceipt?.sourceIdentity === selectedImagePath ? pointColorPickerReceipt : null;

  useEffect(
    () => () => {
      setUI({ pointColorPickerActive: false, pointColorPickerReceipt: null });
    },
    [setUI],
  );
  const [nameDraft, setNameDraft] = useState(selected?.name ?? '');
  const nameDraftPointId = useRef<string | null>(selected?.id ?? null);

  useEffect(() => {
    if (nameDraftPointId.current === selected?.id) return;
    nameDraftPointId.current = selected?.id ?? null;
    setNameDraft(selected?.name ?? '');
  }, [selected?.id, selected?.name]);

  const updatePlan = (update: PointColorPatch) => {
    const identity = commitIdentityRef.current;
    if (identity === null) {
      setAdjustments((previous) => ({ ...previous, pointColor: { ...previous.pointColor, ...update } }));
      return;
    }
    const result = applyEditTransaction(
      buildPointColorEditTransaction(useEditorStore.getState(), identity, update, crypto.randomUUID()),
    );
    commitIdentityRef.current = { ...identity, adjustmentRevision: result.nextAdjustmentRevision };
  };

  const updateSelected = (update: Partial<NonNullable<typeof selected>>) => {
    if (selected === null) return;
    updatePlan({ points: plan.points.map((point) => (point.id === selected.id ? { ...point, ...update } : point)) });
  };

  const updateSourceColor = (update: Partial<NonNullable<typeof sample>['sourceColor']>) => {
    if (selected === null || sample === null) return;
    updateSelected({
      samples: selected.samples.map((entry, index) =>
        index === 0 ? { ...entry, sourceColor: { ...entry.sourceColor, ...update } } : entry,
      ),
    });
  };

  const commitName = (draft = nameDraft) => {
    if (selected === null) return;
    const nextName = clampPointName(draft);
    if (nextName.length === 0 || nextName === selected.name) {
      setNameDraft(selected.name);
      return;
    }
    updateSelected({ name: nextName });
    setNameDraft(nextName);
  };

  const updateSkin = (update: Partial<Adjustments['pointColor']['skinUniformity']>) => {
    updatePlan({ skinUniformity: { ...plan.skinUniformity, ...update } });
  };

  const togglePicker = () => {
    if (!canSampleFromImage && !pointColorPickerActive) return;
    const nextActive = !pointColorPickerActive;
    setUI({ pointColorPickerActive: nextActive, pointColorPickerReceipt: null });
    // Range visualization is a canvas tool state; starting/cancelling a sample
    // must never leave an old range overlay active.
    if (nextActive && plan.visualizeMode !== 'image') updatePlan({ visualizeMode: 'image' });
  };

  const resetPointColor = () => {
    updatePlan({
      enabled: INITIAL_ADJUSTMENTS.pointColor.enabled,
      points: structuredClone(INITIAL_ADJUSTMENTS.pointColor.points),
      selectedPointId: INITIAL_ADJUSTMENTS.pointColor.selectedPointId,
      skinUniformity: structuredClone(INITIAL_ADJUSTMENTS.pointColor.skinUniformity),
      visualizeMode: INITIAL_ADJUSTMENTS.pointColor.visualizeMode,
    });
    setUI({ pointColorPickerActive: false, pointColorPickerReceipt: null });
  };

  const selectPointByOffset = (offset: number) => {
    if (plan.points.length === 0) return;
    const selectedIndex = Math.max(
      0,
      plan.points.findIndex((point) => point.id === selected?.id),
    );
    const nextIndex = Math.min(plan.points.length - 1, Math.max(0, selectedIndex + offset));
    const nextPoint = plan.points[nextIndex];
    if (nextPoint !== undefined && nextPoint.id !== selected?.id) updatePlan({ selectedPointId: nextPoint.id });
  };

  const handlePointListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectPointByOffset(1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      selectPointByOffset(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = plan.points[0];
      if (first !== undefined) updatePlan({ selectedPointId: first.id });
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = plan.points.at(-1);
      if (last !== undefined) updatePlan({ selectedPointId: last.id });
    }
  };

  return (
    <details
      className="group border-b border-editor-border"
      data-commit-adjustment-revision={commitIdentity?.adjustmentRevision}
      data-commit-image-session={commitIdentity?.imageSessionId}
      data-commit-source-identity={commitIdentity?.sourceIdentity}
      data-point-color-receipt-source={currentPointColorPickerReceipt?.sourceIdentity}
      data-testid="point-color-controls"
      open
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <CompactInspectorSectionHeader
          modified={plan.enabled || plan.points.length > 0}
          modifiedLabel="Edited"
          summary={`${plan.points.length} / ${POINT_COLOR_MAX_POINTS_V1}`}
          title="Point Color"
        />
      </summary>
      <div
        className="space-y-1 border-t border-editor-border p-1.5"
        data-point-color-visualize-mode={plan.visualizeMode}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && pointColorPickerActive) {
            setUI({ pointColorPickerActive: false, pointColorPickerReceipt: null });
          }
        }}
      >
        <div className="flex flex-wrap gap-1">
          <button
            aria-pressed={plan.enabled}
            className="rounded border border-editor-border px-2 py-1 text-xs"
            data-testid="point-color-enable"
            onClick={() => updatePlan({ enabled: !plan.enabled })}
            type="button"
          >
            {plan.enabled ? 'Enabled' : 'Enable'}
          </button>
          <button
            aria-pressed={pointColorPickerActive}
            className="flex items-center gap-1 rounded border border-editor-border px-2 py-1 text-xs"
            data-testid="point-color-picker"
            disabled={!canSampleFromImage && !pointColorPickerActive}
            onClick={togglePicker}
            type="button"
          >
            <Crosshair size={12} /> {t('adjustments.color.pointColor.pickFromImage')}
          </button>
          <button
            aria-label={t('adjustments.color.pointColor.addPoint')}
            className="flex items-center gap-1 rounded border border-editor-border px-2 py-1 text-xs"
            data-testid="point-color-add-point"
            disabled={pointLimitReached || !canSampleFromImage || pointColorPickerActive}
            onClick={togglePicker}
            title={t('adjustments.color.pointColor.addPointHint', {
              defaultValue: 'Sample a rendered pixel to add a point',
            })}
            type="button"
          >
            <Plus size={12} /> {t('adjustments.color.pointColor.addPoint')}
          </button>
          <button
            aria-pressed={plan.visualizeMode === 'range'}
            className="flex items-center gap-1 rounded border border-editor-border px-2 py-1 text-xs"
            data-testid="point-color-visualize-range"
            disabled={selected === null}
            onClick={() => updatePlan({ visualizeMode: plan.visualizeMode === 'range' ? 'image' : 'range' })}
            type="button"
          >
            <Crosshair size={12} /> {t('adjustments.color.pointColor.visualize')}
          </button>
          <button
            aria-label={t('adjustments.color.pointColor.reset', { defaultValue: 'Reset Point Color' })}
            className="flex items-center gap-1 rounded border border-editor-border px-2 py-1 text-xs text-text-secondary"
            data-testid="point-color-reset"
            disabled={!plan.enabled && plan.points.length === 0 && !plan.skinUniformity.enabled}
            onClick={resetPointColor}
            type="button"
          >
            <RotateCcw size={12} /> {t('adjustments.color.pointColor.resetAction', { defaultValue: 'Reset' })}
          </button>
        </div>
        {pointColorPickerActive ? (
          <p className="text-xs text-text-secondary" data-testid="point-color-picker-hint">
            {t('adjustments.color.pointColor.pickerHint', {
              defaultValue: 'Click a rendered pixel to add a sampled point. Escape cancels.',
            })}
          </p>
        ) : null}
        {currentPointColorPickerReceipt ? (
          <p className="text-[10px] text-text-secondary" data-testid="point-color-picker-receipt">
            {t('adjustments.color.pointColor.pickerReceipt', {
              confidence: (currentPointColorPickerReceipt.confidence * 100).toFixed(0),
              defaultValue: 'Sampled {{confidence}}% confidence · {{revision}}',
              revision: currentPointColorPickerReceipt.graphRevision,
            })}
          </p>
        ) : null}
        {plan.points.length > 0 ? (
          <div
            aria-label={t('adjustments.color.pointColor.samples')}
            className="flex flex-wrap gap-1"
            data-testid="point-color-sample-list"
            onKeyDown={handlePointListKeyDown}
            role="listbox"
            tabIndex={0}
          >
            {plan.points.map((point) => (
              <button
                aria-selected={point.id === selected?.id}
                className="rounded border border-editor-border px-2 py-1 text-xs"
                data-testid={`point-color-sample-${point.id}`}
                key={point.id}
                onClick={() => updatePlan({ selectedPointId: point.id })}
                role="option"
                type="button"
              >
                {point.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-secondary">{t('adjustments.color.pointColor.empty')}</p>
        )}
        {selected !== null && sample !== null ? (
          <div className="space-y-1" data-testid="point-color-selected-controls">
            <div className="flex items-center gap-1">
              <label className="min-w-0 flex-1 text-xs text-text-secondary" htmlFor="point-color-name">
                {t('adjustments.color.pointColor.name', { defaultValue: 'Name' })}
              </label>
              <input
                aria-label={t('adjustments.color.pointColor.nameInput', { defaultValue: 'Point name' })}
                className="min-w-0 flex-1 rounded border border-editor-border bg-transparent px-1 py-0.5 text-xs"
                data-testid="point-color-name"
                id="point-color-name"
                maxLength={80}
                onBlur={(event) => commitName(event.currentTarget.value)}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitName(event.currentTarget.value);
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setNameDraft(selected.name);
                    event.currentTarget.blur();
                  }
                }}
                value={nameDraft}
              />
            </div>
            <button
              aria-label={`Delete ${selected.name}`}
              className="flex items-center gap-1 text-xs text-text-secondary"
              data-testid="point-color-delete-point"
              onClick={() => {
                const points = plan.points.filter((point) => point.id !== selected.id);
                updatePlan({ points, selectedPointId: points[0]?.id ?? null });
              }}
              type="button"
            >
              <Trash2 size={12} /> {t('adjustments.color.pointColor.deletePoint')}
            </button>
            <div className="grid grid-cols-2 gap-x-2">
              <AdjustmentSlider
                density="compact"
                label="Hue shift"
                max={180}
                min={-180}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ hueShiftDegrees: value })}
                step={1}
                testId="point-color-hue-shift"
                value={selected.hueShiftDegrees}
              />
              <AdjustmentSlider
                density="compact"
                label="Saturation shift"
                max={4}
                min={-1}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ saturationShift: value })}
                step={0.01}
                testId="point-color-saturation-shift"
                value={selected.saturationShift}
              />
              <AdjustmentSlider
                density="compact"
                label="Luminance shift"
                max={1}
                min={-1}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ lightnessShift: value })}
                step={0.01}
                testId="point-color-luminance-shift"
                value={selected.lightnessShift}
              />
              <AdjustmentSlider
                density="compact"
                label="Hue range"
                max={180}
                min={0.1}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ hueRadiusDegrees: value })}
                step={1}
                testId="point-color-hue-range"
                value={selected.hueRadiusDegrees}
              />
              <AdjustmentSlider
                density="compact"
                label="Saturation range"
                max={1}
                min={0.001}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ chromaRadius: value })}
                step={0.005}
                testId="point-color-saturation-range"
                value={selected.chromaRadius}
              />
              <AdjustmentSlider
                density="compact"
                label="Luminance range"
                max={2}
                min={0.001}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ lightnessRadius: value })}
                step={0.01}
                testId="point-color-luminance-range"
                value={selected.lightnessRadius}
              />
              <AdjustmentSlider
                density="compact"
                label="Variance"
                max={4}
                min={0.25}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ variance: value })}
                step={0.05}
                testId="point-color-variance"
                value={selected.variance}
              />
              <AdjustmentSlider
                density="compact"
                label="Feather"
                max={1}
                min={0}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSelected({ feather: value })}
                step={0.01}
                testId="point-color-feather"
                value={selected.feather}
              />
            </div>
            <div className="border-t border-editor-border pt-1" data-testid="point-color-sampled-source">
              <p className="text-[10px] uppercase tracking-wide text-text-secondary">
                {t('adjustments.color.pointColor.sampledRange', { defaultValue: 'Sampled range' })}
              </p>
              <div className="grid grid-cols-3 gap-x-2">
                <AdjustmentSlider
                  density="compact"
                  label="Hue"
                  max={360}
                  min={0}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(value) => updateSourceColor({ hueDegrees: value })}
                  step={1}
                  testId="point-color-sampled-hue"
                  value={sample.sourceColor.hueDegrees}
                />
                <AdjustmentSlider
                  density="compact"
                  label="Saturation"
                  max={2}
                  min={0}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(value) => updateSourceColor({ chroma: value })}
                  step={0.005}
                  testId="point-color-sampled-saturation"
                  value={sample.sourceColor.chroma}
                />
                <AdjustmentSlider
                  density="compact"
                  label="Luminance"
                  max={4}
                  min={-1}
                  onDragStateChange={onDragStateChange}
                  onValueChange={(value) => updateSourceColor({ lightness: value })}
                  step={0.01}
                  testId="point-color-sampled-luminance"
                  value={sample.sourceColor.lightness}
                />
              </div>
              <p className="text-[10px] text-text-secondary">
                {t('adjustments.color.pointColor.sampleConfidence', {
                  confidence: (sample.confidence * 100).toFixed(0),
                  defaultValue: 'Sample confidence {{confidence}}% · {{revision}}',
                  revision: sample.graphRevision,
                })}
              </p>
            </div>
            <div className="border-t border-editor-border pt-1" data-testid="point-color-skin-uniformity">
              <button
                aria-pressed={plan.skinUniformity.enabled}
                className="rounded border border-editor-border px-2 py-1 text-xs"
                onClick={() =>
                  updateSkin({
                    enabled: !plan.skinUniformity.enabled,
                    range: selected,
                    target: sample.sourceColor,
                  })
                }
                type="button"
              >
                {t('adjustments.color.skinToneUniformity.title')}
              </button>
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.color.skinToneUniformity.hue')}
                max={1}
                min={0}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSkin({ hueUniformity: value })}
                step={0.01}
                value={plan.skinUniformity.hueUniformity}
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.color.skinToneUniformity.saturation')}
                max={1}
                min={0}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSkin({ chromaUniformity: value })}
                step={0.01}
                value={plan.skinUniformity.chromaUniformity}
              />
              <AdjustmentSlider
                density="compact"
                label={t('adjustments.color.skinToneUniformity.lightness')}
                max={1}
                min={0}
                onDragStateChange={onDragStateChange}
                onValueChange={(value) => updateSkin({ lightnessUniformity: value })}
                step={0.01}
                value={plan.skinUniformity.lightnessUniformity}
              />
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
};
