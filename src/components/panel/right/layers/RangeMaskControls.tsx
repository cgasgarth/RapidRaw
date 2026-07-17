import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type LayerMaskRangeSelectionV1,
  layerMaskRangeSelectionV1Schema,
} from '../../../../../packages/rawengine-schema/src/rawEngineSchemas';
import { toMaskParameterRecord } from '../../../../utils/mask/maskParameterAccess';

type RangeMaskKind = LayerMaskRangeSelectionV1['rangeKind'];

interface RangeMaskControlsProps {
  kind: RangeMaskKind;
  parameters: unknown;
  onApply: (parameters: Record<string, unknown>) => void;
  onPreview: (parameters: Record<string, unknown>) => void;
}

type TypedRangeDraft =
  | Extract<LayerMaskRangeSelectionV1, { rangeKind: 'luminance' }>
  | Extract<LayerMaskRangeSelectionV1, { rangeKind: 'color' }>;
type RangeDraft = TypedRangeDraft & { smoothness: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function defaultsFor(kind: RangeMaskKind, parameters: unknown): RangeDraft {
  const current = toMaskParameterRecord(parameters);
  if (kind === 'luminance') {
    const minLuma = clamp(finite(current['minLuma'], 0.08), 0, 0.98);
    const maxLuma = clamp(finite(current['maxLuma'], 0.92), minLuma + 0.01, 1);
    const feather = clamp(finite(current['feather'], finite(current['softness'], 0.18)), 0, 1);
    return {
      feather,
      maxLuma,
      minLuma,
      rangeKind: 'luminance',
      smoothness: clamp(finite(current['smoothness'], feather), 0, 1),
    };
  }
  const minLuma = clamp(finite(current['minLuma'], 0.02), 0, 0.98);
  const maxLuma = clamp(finite(current['maxLuma'], 0.98), minLuma + 0.01, 1);
  const minSaturation = clamp(finite(current['minSaturation'], 0.08), 0, 0.98);
  const maxSaturation = clamp(finite(current['maxSaturation'], 1), minSaturation + 0.01, 1);
  return {
    centerHueDegrees: clamp(finite(current['centerHueDegrees'], 180), 0, 359.999),
    feather: clamp(finite(current['feather'], 0.35), 0, 1),
    hueToleranceDegrees: clamp(finite(current['hueToleranceDegrees'], 36), 1, 180),
    maxLuma,
    maxSaturation,
    minLuma,
    minSaturation,
    rangeKind: 'color',
    smoothness: clamp(finite(current['smoothness'], 0.2), 0, 1),
  };
}

function parseDraft(kind: RangeMaskKind, parameters: unknown): RangeDraft {
  const draft = defaultsFor(kind, parameters);
  const { smoothness: _smoothness, ...typedDraft } = draft;
  const parsed = layerMaskRangeSelectionV1Schema.safeParse(typedDraft);
  return parsed.success ? { ...parsed.data, smoothness: draft.smoothness } : draft;
}

const histogram = Array.from({ length: 48 }, (_, index) => {
  const wave = Math.sin(index * 0.41) * 0.26 + Math.cos(index * 0.17) * 0.18;
  return clamp(0.28 + wave + (index > 10 && index < 35 ? 0.25 : 0), 0.08, 0.96);
});

function Histogram({ kind }: { kind: RangeMaskKind }) {
  return (
    <div
      className="relative h-14 overflow-hidden rounded border border-editor-border bg-editor-panel-well"
      data-range-histogram={kind}
      data-testid={`range-mask-histogram-${kind}`}
    >
      <div className="absolute inset-0 flex items-end gap-px px-1 pb-1 opacity-75" aria-hidden="true">
        {histogram.map((height, index) => (
          <span
            key={index}
            className="min-w-0 flex-1 rounded-t-sm bg-editor-primary-active/60"
            style={{ height: `${height * 100}%` }}
          />
        ))}
      </div>
      <span className="absolute left-1 top-1 text-[9px] uppercase tracking-wider text-text-tertiary">
        {kind === 'color' ? 'Hue / luma' : 'Luma'}
      </span>
    </div>
  );
}

function RangeTrack({
  draft,
  kind,
  onChange,
}: {
  draft: RangeDraft;
  kind: RangeMaskKind;
  onChange: (patch: Partial<RangeDraft>) => void;
}) {
  const minLuma = draft.minLuma;
  const maxLuma = draft.maxLuma;
  const updateMinLuma = (value: number) => onChange({ minLuma: clamp(value, 0, maxLuma - 0.01) });
  const updateMaxLuma = (value: number) => onChange({ maxLuma: clamp(value, minLuma + 0.01, 1) });
  return (
    <div className="space-y-1" data-range-track={kind}>
      <div className="relative h-7 overflow-hidden rounded bg-gradient-to-r from-[#15181c] via-[#9ca4ad] to-[#f4f5f7]">
        <div
          className="absolute inset-y-0 bg-editor-primary-active/25"
          style={{ left: `${minLuma * 100}%`, right: `${(1 - maxLuma) * 100}%` }}
        />
        <input
          aria-label="Range minimum"
          className="absolute inset-x-0 top-0 h-3 w-full accent-editor-primary-active"
          max={Math.round(Math.max(0, maxLuma - 0.01) * 100)}
          min={0}
          onChange={(event) => updateMinLuma(Number(event.currentTarget.value) / 100)}
          step={1}
          type="range"
          value={Math.round(minLuma * 100)}
        />
        <input
          aria-label="Range maximum"
          className="absolute inset-x-0 bottom-0 h-3 w-full accent-editor-primary-active"
          max={100}
          min={Math.min(100, Math.round((minLuma + 0.01) * 100))}
          onChange={(event) => updateMaxLuma(Number(event.currentTarget.value) / 100)}
          step={1}
          type="range"
          value={Math.round(maxLuma * 100)}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-text-tertiary">
        <span>{Math.round(minLuma * 100)}%</span>
        <span>{Math.round(maxLuma * 100)}%</span>
      </div>
    </div>
  );
}

export function RangeMaskControls({ kind, parameters, onApply, onPreview }: RangeMaskControlsProps) {
  const { t } = useTranslation();
  const sourceKey = useMemo(() => JSON.stringify(parameters), [parameters]);
  const [draft, setDraft] = useState<RangeDraft>(() => parseDraft(kind, parameters));
  const committed = useRef<RangeDraft>(draft);
  const publishedKey = useRef<string | null>(null);

  useEffect(() => {
    if (publishedKey.current === sourceKey) {
      publishedKey.current = null;
      return;
    }
    const next = parseDraft(kind, parameters);
    committed.current = next;
    setDraft(next);
  }, [kind, sourceKey, parameters]);

  const update = (patch: Partial<RangeDraft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch } as RangeDraft;
      return parseDraft(kind, next);
    });
  const serialized = (value: RangeDraft): Record<string, unknown> => ({ ...value });
  const publish = (value: RangeDraft, commit: boolean) => {
    const payload = serialized(value);
    publishedKey.current = JSON.stringify(payload);
    if (commit) committed.current = value;
    return payload;
  };
  const label = kind === 'color' ? 'Color range' : 'Luminance range';

  return (
    <section
      className="space-y-2 rounded-md border border-editor-border bg-editor-panel-raised p-2"
      data-range-mask-kind={kind}
      data-testid={`range-mask-controls-${kind}`}
      data-visual-smoke-section={`lightroom-range-mask-${kind}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          {t('editor.masks.rangeMask.title', { defaultValue: label })}
        </span>
        <span className="text-[10px] text-text-tertiary">
          {t('editor.masks.rangeMask.previewHint', { defaultValue: 'Preview before apply' })}
        </span>
      </div>
      <Histogram kind={kind} />
      {kind === 'color' && draft.rangeKind === 'color' && (
        <>
          <RangeTrack draft={draft} kind={kind} onChange={update} />
          <label className="grid gap-1 text-[10px] text-text-secondary">
            {t('editor.masks.rangeMask.hueCenter', { defaultValue: 'Hue center' })}{' '}
            <input
              aria-label="Hue center"
              max={360}
              min={0}
              onChange={(event) => update({ centerHueDegrees: Number(event.currentTarget.value) })}
              step={1}
              type="range"
              value={Math.round(draft.centerHueDegrees)}
            />
          </label>
          <label className="grid gap-1 text-[10px] text-text-secondary">
            {t('editor.masks.rangeMask.hueTolerance', { defaultValue: 'Hue tolerance' })}{' '}
            <input
              aria-label="Hue tolerance"
              max={180}
              min={1}
              onChange={(event) => update({ hueToleranceDegrees: Number(event.currentTarget.value) })}
              step={1}
              type="range"
              value={Math.round(draft.hueToleranceDegrees)}
            />
          </label>
          <label className="grid gap-1 text-[10px] text-text-secondary">
            {t('editor.masks.rangeMask.saturation', { defaultValue: 'Saturation' })}{' '}
            <input
              aria-label="Saturation minimum"
              max={99}
              min={0}
              onChange={(event) =>
                update({ minSaturation: clamp(Number(event.currentTarget.value) / 100, 0, draft.maxSaturation - 0.01) })
              }
              step={1}
              type="range"
              value={Math.round(draft.minSaturation * 100)}
            />
          </label>
        </>
      )}
      {kind === 'luminance' && <RangeTrack draft={draft} kind={kind} onChange={update} />}
      <label className="grid gap-1 text-[10px] text-text-secondary">
        {t('editor.masks.rangeMask.feather', { defaultValue: 'Feather' })}{' '}
        <input
          aria-label="Range feather"
          max={100}
          min={0}
          onChange={(event) => update({ feather: Number(event.currentTarget.value) / 100 })}
          step={1}
          type="range"
          value={Math.round(draft.feather * 100)}
        />
      </label>
      <label className="grid gap-1 text-[10px] text-text-secondary">
        {t('editor.masks.rangeMask.smooth', { defaultValue: 'Smooth' })}{' '}
        <input
          aria-label="Range smooth"
          max={100}
          min={0}
          onChange={(event) => update({ smoothness: Number(event.currentTarget.value) / 100 })}
          step={1}
          type="range"
          value={Math.round(draft.smoothness * 100)}
        />
      </label>
      <div className="flex items-center justify-end gap-1 pt-1">
        <button
          className="rounded border border-editor-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
          data-testid={`range-mask-cancel-${kind}`}
          onClick={() => {
            setDraft(committed.current);
            onPreview(publish(committed.current, false));
          }}
          type="button"
        >
          {t('editor.masks.rangeMask.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button
          className="rounded border border-editor-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
          data-testid={`range-mask-refine-${kind}`}
          onClick={() => onPreview(publish(draft, false))}
          type="button"
        >
          {t('editor.masks.rangeMask.refine', { defaultValue: 'Refine' })}
        </button>
        <button
          className="rounded border border-editor-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary"
          data-testid={`range-mask-preview-${kind}`}
          onClick={() => onPreview(publish(draft, false))}
          type="button"
        >
          {t('editor.masks.rangeMask.preview', { defaultValue: 'Preview' })}
        </button>
        <button
          className="rounded bg-editor-primary-active px-2 py-1 text-[10px] font-medium text-white hover:bg-editor-primary"
          data-testid={`range-mask-apply-${kind}`}
          onClick={() => onApply(publish(draft, true))}
          type="button"
        >
          {t('editor.masks.rangeMask.apply', { defaultValue: 'Apply' })}
        </button>
      </div>
    </section>
  );
}
