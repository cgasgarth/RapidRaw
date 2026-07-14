import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  Adjustments,
  OutputCurveSettingsV1,
  SceneCurvePointV1,
  SceneCurveSettingsV1,
} from '../../utils/adjustments';

type TypedCurveDomain = 'scene' | 'output';

interface TypedCurveEditorProps {
  adjustments: Adjustments;
  domain: TypedCurveDomain;
  setAdjustments: (updater: (previous: Adjustments) => Adjustments) => void;
}

const DEFAULT_SCENE_CURVE: SceneCurveSettingsV1 = {
  channelMode: 'luminance_preserving',
  middleGrey: 0.18,
  points: [
    { xEv: -16, yEv: -16 },
    { xEv: 16, yEv: 16 },
  ],
};

const DEFAULT_OUTPUT_CURVE: OutputCurveSettingsV1 = {
  domain: 'view_encoded',
  targetIdentity: 'rapid-view-default',
  sdrReferenceWhiteNits: 203,
  peakNits: 203,
  points: [
    { input: 0, output: 0 },
    { input: 1, output: 1 },
  ],
};

const SCENE_POINT_EPSILON = 1 / 4096;
const OUTPUT_POINT_EPSILON = 1 / 65_536;

function midpointIndex(points: ReadonlyArray<{ input: number }>): number {
  let index = 1;
  let widest = Number.NEGATIVE_INFINITY;
  for (let upper = 1; upper < points.length; upper += 1) {
    const lowerPoint = points[upper - 1];
    const upperPoint = points[upper];
    if (!lowerPoint || !upperPoint) continue;
    const width = upperPoint.input - lowerPoint.input;
    if (width > widest) {
      widest = width;
      index = upper;
    }
  }
  return index;
}

function sceneAsGeneric(points: ReadonlyArray<SceneCurvePointV1>) {
  return points.map((point) => ({ input: point.xEv, output: point.yEv }));
}

function commitScene(
  setAdjustments: TypedCurveEditorProps['setAdjustments'],
  update: (curve: SceneCurveSettingsV1) => SceneCurveSettingsV1,
) {
  setAdjustments((previous) => ({
    ...previous,
    rawEngineEditGraphVersion: 2,
    sceneCurveV1: update(structuredClone(previous.sceneCurveV1 ?? DEFAULT_SCENE_CURVE)),
  }));
}

function commitOutput(
  setAdjustments: TypedCurveEditorProps['setAdjustments'],
  update: (curve: OutputCurveSettingsV1) => OutputCurveSettingsV1,
) {
  setAdjustments((previous) => ({
    ...previous,
    rawEngineEditGraphVersion: 2,
    outputCurveV1: update(structuredClone(previous.outputCurveV1 ?? DEFAULT_OUTPUT_CURVE)),
  }));
}

export default function TypedCurveEditor({ adjustments, domain, setAdjustments }: TypedCurveEditorProps) {
  const { t } = useTranslation();
  const scene = adjustments.sceneCurveV1 ?? DEFAULT_SCENE_CURVE;
  const output = adjustments.outputCurveV1 ?? DEFAULT_OUTPUT_CURVE;
  const points = domain === 'scene' ? sceneAsGeneric(scene.points) : output.points;
  const axis =
    domain === 'scene'
      ? t('adjustments.curves.typed.sceneAxis', { defaultValue: 'EV relative to middle grey' })
      : t('adjustments.curves.typed.outputAxis', { defaultValue: 'Encoded value relative to SDR white' });

  const updatePoint = (index: number, key: 'input' | 'output', value: number) => {
    if (!Number.isFinite(value)) return;
    if (domain === 'scene') {
      commitScene(setAdjustments, (curve) => {
        const next = curve.points.map((point) => ({ ...point }));
        const point = next[index];
        if (!point) return curve;
        const previous = next[index - 1];
        const following = next[index + 1];
        if (key === 'input') {
          point.xEv = Math.max(
            (previous?.xEv ?? -16 - SCENE_POINT_EPSILON) + SCENE_POINT_EPSILON,
            Math.min((following?.xEv ?? 16 + SCENE_POINT_EPSILON) - SCENE_POINT_EPSILON, value),
          );
        } else {
          point.yEv = Math.max(previous?.yEv ?? -16, Math.min(following?.yEv ?? 16, value));
        }
        return { ...curve, points: next };
      });
      return;
    }
    commitOutput(setAdjustments, (curve) => {
      const next = curve.points.map((point) => ({ ...point }));
      const point = next[index];
      if (!point) return curve;
      const maximum = curve.peakNits / curve.sdrReferenceWhiteNits;
      if (key === 'input') {
        point.input = Math.max(
          (next[index - 1]?.input ?? -OUTPUT_POINT_EPSILON) + OUTPUT_POINT_EPSILON,
          Math.min((next[index + 1]?.input ?? maximum + OUTPUT_POINT_EPSILON) - OUTPUT_POINT_EPSILON, value),
        );
      } else {
        point.output = Math.max(next[index - 1]?.output ?? 0, Math.min(next[index + 1]?.output ?? maximum, value));
      }
      return { ...curve, points: next };
    });
  };

  const addPoint = () => {
    if (points.length >= 32) return;
    const index = midpointIndex(points);
    const lower = points[index - 1];
    const upper = points[index];
    if (!lower || !upper) return;
    const point = { input: (lower.input + upper.input) / 2, output: (lower.output + upper.output) / 2 };
    if (domain === 'scene') {
      commitScene(setAdjustments, (curve) => {
        const next = [...curve.points];
        next.splice(index, 0, { xEv: point.input, yEv: point.output });
        return { ...curve, points: next };
      });
    } else {
      commitOutput(setAdjustments, (curve) => {
        const next = [...curve.points];
        next.splice(index, 0, point);
        return { ...curve, points: next };
      });
    }
  };

  const removePoint = (index: number) => {
    if (index === 0 || index === points.length - 1) return;
    if (domain === 'scene') {
      commitScene(setAdjustments, (curve) => ({ ...curve, points: curve.points.filter((_, item) => item !== index) }));
    } else {
      commitOutput(setAdjustments, (curve) => ({ ...curve, points: curve.points.filter((_, item) => item !== index) }));
    }
  };

  const reset = () => {
    if (domain === 'scene') {
      commitScene(setAdjustments, (curve) => ({
        ...curve,
        points: structuredClone(DEFAULT_SCENE_CURVE.points),
      }));
    } else {
      commitOutput(setAdjustments, (curve) => {
        const maximum = curve.peakNits / curve.sdrReferenceWhiteNits;
        return {
          ...curve,
          points: [
            { input: 0, output: 0 },
            { input: maximum, output: maximum },
          ],
        };
      });
    }
  };

  return (
    <div className="space-y-3" data-curve-domain={domain} data-testid="typed-curve-editor">
      <div className="rounded border border-border bg-surface/40 p-2 text-xs text-text-secondary">
        <div className="font-medium text-text-primary">
          {domain === 'scene'
            ? t('adjustments.curves.typed.sceneTitle', { defaultValue: 'Scene Curve' })
            : t('adjustments.curves.typed.outputTitle', { defaultValue: 'Output Curve' })}
        </div>
        <div>{axis}</div>
      </div>

      {domain === 'scene' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-text-secondary">
            {t('adjustments.curves.typed.channelMode', { defaultValue: 'Channel mode' })}
            <select
              aria-label="Scene curve channel mode"
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-text-primary"
              onChange={(event) =>
                commitScene(setAdjustments, (curve) => ({
                  ...curve,
                  channelMode: event.target.value as SceneCurveSettingsV1['channelMode'],
                }))
              }
              value={scene.channelMode}
            >
              <option value="luminance_preserving">
                {t('adjustments.curves.typed.luminancePreserving', { defaultValue: 'Luminance preserving' })}
              </option>
              <option value="linked_rgb">
                {t('adjustments.curves.typed.linkedRgb', { defaultValue: 'Linked RGB' })}
              </option>
            </select>
          </label>
          <NumericField
            label="Middle grey"
            value={scene.middleGrey}
            onCommit={(value) => {
              if (value > 0 && value < 1) commitScene(setAdjustments, (curve) => ({ ...curve, middleGrey: value }));
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <NumericField
            label="SDR white (nits)"
            value={output.sdrReferenceWhiteNits}
            onCommit={(value) => {
              const headroom = output.peakNits / value;
              const maximumPoint = Math.max(...output.points.flatMap((point) => [point.input, point.output]));
              if (value > 0 && value <= output.peakNits && maximumPoint <= headroom) {
                commitOutput(setAdjustments, (curve) => ({ ...curve, sdrReferenceWhiteNits: value }));
              }
            }}
          />
          <NumericField
            label="Peak (nits)"
            value={output.peakNits}
            onCommit={(value) => {
              const headroom = value / output.sdrReferenceWhiteNits;
              const maximumPoint = Math.max(...output.points.flatMap((point) => [point.input, point.output]));
              if (value >= output.sdrReferenceWhiteNits && value <= 10_000 && maximumPoint <= headroom) {
                commitOutput(setAdjustments, (curve) => ({ ...curve, peakNits: value }));
              }
            }}
          />
        </div>
      )}

      <div className="space-y-1" role="list" aria-label={`${domain} curve points`}>
        {points.map((point, index) => (
          <div
            className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
            key={`${String(index)}-${String(point.input)}`}
          >
            <NumericField
              label={domain === 'scene' ? 'Input EV' : 'Input'}
              value={point.input}
              onCommit={(value) => updatePoint(index, 'input', value)}
            />
            <NumericField
              label={domain === 'scene' ? 'Output EV' : 'Output'}
              value={point.output}
              onCommit={(value) => updatePoint(index, 'output', value)}
            />
            <button
              aria-label={`Delete point ${String(index + 1)}`}
              className="rounded p-1.5 text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-30"
              disabled={index === 0 || index === points.length - 1}
              onClick={() => removePoint(index)}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
          disabled={points.length >= 32}
          onClick={addPoint}
          type="button"
        >
          <Plus size={13} /> {t('adjustments.curves.typed.addPoint', { defaultValue: 'Add point' })}
        </button>
        <button
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs"
          onClick={reset}
          type="button"
        >
          <RotateCcw size={13} /> {t('common.reset', { defaultValue: 'Reset' })}
        </button>
      </div>
    </div>
  );
}

function NumericField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  return (
    <label className="text-xs text-text-secondary">
      {label}
      <input
        aria-label={label}
        className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-text-primary"
        defaultValue={value}
        key={value}
        onBlur={(event) => onCommit(event.currentTarget.valueAsNumber)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        step="any"
        type="number"
      />
    </label>
  );
}
