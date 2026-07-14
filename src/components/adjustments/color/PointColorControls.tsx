import { Crosshair, Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { POINT_COLOR_MAX_POINTS_V1 } from '../../../../packages/rawengine-schema/src/color/pointColorSchemas';
import { useUIStore } from '../../../store/useUIStore';
import type { Adjustments } from '../../../utils/adjustments';
import CompactInspectorSectionHeader from '../../ui/CompactInspectorSectionHeader';
import AdjustmentSlider from '../AdjustmentSlider';
import type { ColorPanelGroupProps } from './types';

const createPoint = (index: number): Adjustments['pointColor']['points'][number] => {
  const id = crypto.randomUUID();
  return {
    chromaRadius: 0.08,
    chromaShift: 0,
    enabled: true,
    feather: 0.4,
    hueRadiusDegrees: 25,
    hueShiftDegrees: 0,
    id,
    lightnessRadius: 0.2,
    lightnessShift: 0,
    name: `Point ${index + 1}`,
    opacity: 1,
    samples: [
      {
        confidence: 1,
        graphRevision: 'manual_pending_picker',
        id: crypto.randomUUID(),
        sampleRadiusPx: 5,
        sourceColor: { chroma: 0.12, hueDegrees: 30, lightness: 0.6 },
        sourceSceneRevision: 'manual_pending_picker',
      },
    ],
    saturationShift: 0,
    variance: 1,
  };
};

export const PointColorControls = ({ adjustments, onDragStateChange, setAdjustments }: ColorPanelGroupProps) => {
  const { t } = useTranslation();
  const pointColorPickerActive = useUIStore((state) => state.pointColorPickerActive);
  const setUI = useUIStore((state) => state.setUI);
  const plan = adjustments.pointColor;
  const selected = useMemo(
    () => plan.points.find((point) => point.id === plan.selectedPointId) ?? plan.points[0] ?? null,
    [plan.points, plan.selectedPointId],
  );
  const sample = selected?.samples[0] ?? null;

  const updatePlan = (update: Partial<Adjustments['pointColor']>) => {
    setAdjustments((previous) => ({ ...previous, pointColor: { ...previous.pointColor, ...update } }));
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
  const updateSkin = (update: Partial<Adjustments['pointColor']['skinUniformity']>) => {
    updatePlan({ skinUniformity: { ...plan.skinUniformity, ...update } });
  };

  return (
    <details className="group border-b border-editor-border" data-testid="point-color-controls" open>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <CompactInspectorSectionHeader
          modified={plan.enabled || plan.points.length > 0}
          modifiedLabel="Edited"
          summary={`${plan.points.length} / ${POINT_COLOR_MAX_POINTS_V1}`}
          title="Point Color"
        />
      </summary>
      <div className="space-y-1 border-t border-editor-border p-1.5">
        <div className="flex gap-1">
          <button
            aria-pressed={plan.enabled}
            className="rounded border border-editor-border px-2 py-1 text-xs"
            onClick={() => updatePlan({ enabled: !plan.enabled })}
            type="button"
          >
            {plan.enabled ? 'Enabled' : 'Enable'}
          </button>
          <button
            className="flex items-center gap-1 rounded border border-editor-border px-2 py-1 text-xs"
            disabled={plan.points.length >= POINT_COLOR_MAX_POINTS_V1}
            onClick={() => {
              const point = createPoint(plan.points.length);
              updatePlan({ enabled: true, points: [...plan.points, point], selectedPointId: point.id });
            }}
            type="button"
          >
            <Plus size={12} /> {t('adjustments.color.pointColor.addPoint')}
          </button>
          <button
            aria-pressed={pointColorPickerActive}
            className="flex items-center gap-1 rounded border border-editor-border px-2 py-1 text-xs"
            data-testid="point-color-picker"
            onClick={() => setUI({ pointColorPickerActive: !pointColorPickerActive, pointColorPickerReceipt: null })}
            type="button"
          >
            <Crosshair size={12} /> {t('adjustments.color.pointColor.pickFromImage')}
          </button>
          <button
            aria-pressed={plan.visualizeMode !== 'image'}
            className="flex items-center gap-1 rounded border border-editor-border px-2 py-1 text-xs"
            disabled={selected === null}
            onClick={() => updatePlan({ visualizeMode: plan.visualizeMode === 'image' ? 'range' : 'image' })}
            type="button"
          >
            <Crosshair size={12} /> {t('adjustments.color.pointColor.visualize')}
          </button>
        </div>
        {plan.points.length > 0 ? (
          <div aria-label={t('adjustments.color.pointColor.samples')} className="flex flex-wrap gap-1" role="listbox">
            {plan.points.map((point) => (
              <button
                aria-selected={point.id === selected?.id}
                className="rounded border border-editor-border px-2 py-1 text-xs"
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
            <button
              aria-label={`Delete ${selected.name}`}
              className="flex items-center gap-1 text-xs text-text-secondary"
              onClick={() => {
                const points = plan.points.filter((point) => point.id !== selected.id);
                updatePlan({ points, selectedPointId: points[0]?.id ?? null });
              }}
              type="button"
            >
              <Trash2 size={12} /> {t('adjustments.color.pointColor.deletePoint')}
            </button>
            <AdjustmentSlider
              density="compact"
              label="Picked hue"
              max={360}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSourceColor({ hueDegrees: value })}
              step={1}
              value={sample.sourceColor.hueDegrees}
            />
            <AdjustmentSlider
              density="compact"
              label="Picked chroma"
              max={0.5}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSourceColor({ chroma: value })}
              step={0.005}
              value={sample.sourceColor.chroma}
            />
            <AdjustmentSlider
              density="compact"
              label="Picked lightness"
              max={1.5}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSourceColor({ lightness: value })}
              step={0.01}
              value={sample.sourceColor.lightness}
            />
            <AdjustmentSlider
              density="compact"
              label="Hue range"
              max={180}
              min={1}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSelected({ hueRadiusDegrees: value })}
              step={1}
              value={selected.hueRadiusDegrees}
            />
            <AdjustmentSlider
              density="compact"
              label="Variance"
              max={4}
              min={0.25}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSelected({ variance: value })}
              step={0.05}
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
              value={selected.feather}
            />
            <AdjustmentSlider
              density="compact"
              label="Hue shift"
              max={180}
              min={-180}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSelected({ hueShiftDegrees: value })}
              step={1}
              value={selected.hueShiftDegrees}
            />
            <AdjustmentSlider
              density="compact"
              label="Chroma shift"
              max={1}
              min={-1}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSelected({ chromaShift: value })}
              step={0.01}
              value={selected.chromaShift}
            />
            <AdjustmentSlider
              density="compact"
              label="Saturation shift"
              max={4}
              min={-1}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSelected({ saturationShift: value })}
              step={0.01}
              value={selected.saturationShift}
            />
            <AdjustmentSlider
              density="compact"
              label="Lightness shift"
              max={1}
              min={-1}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => updateSelected({ lightnessShift: value })}
              step={0.01}
              value={selected.lightnessShift}
            />
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
