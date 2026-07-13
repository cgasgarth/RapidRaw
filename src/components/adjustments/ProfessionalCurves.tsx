import { Crosshair, RotateCcw } from 'lucide-react';
import { type PointerEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Adjustments,
  getDefaultOutputCurve,
  getDefaultSceneCurve,
  type OutputCurveAdjustment,
  type ProfessionalCurveChannelMode,
  type SceneCurveAdjustment,
} from '../../utils/adjustments';
import type { ChannelConfig } from './Curves';

interface ProfessionalCurvesProps {
  adjustments: Adjustments;
  histogram: ChannelConfig | null;
  setAdjustments: (updater: (previous: Adjustments) => Adjustments) => void;
  onDragStateChange?: ((dragging: boolean) => void) | undefined;
}

type Surface = 'scene' | 'output';
type Point = { x: number; y: number };

const SIZE = 256;
const CHANNELS: Array<{ value: ProfessionalCurveChannelMode; label: string }> = [
  { value: 'luminance_preserving', label: 'Luma' },
  { value: 'linked_rgb', label: 'Linked RGB' },
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
];

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export default function ProfessionalCurves({
  adjustments,
  histogram,
  setAdjustments,
  onDragStateChange,
}: ProfessionalCurvesProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [surface, setSurface] = useState<Surface>('scene');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [targeted, setTargeted] = useState(false);
  const scene = adjustments.sceneCurve ?? getDefaultSceneCurve();
  const output = adjustments.outputCurve ?? getDefaultOutputCurve();
  const range = surface === 'scene' ? { minimum: -16, maximum: 16 } : { minimum: 0, maximum: output.maximumValue };
  const points: Array<Point> =
    surface === 'scene'
      ? scene.points.map(({ xEv, yEv }) => ({ x: xEv, y: yEv }))
      : output.points.map(({ x, y }) => ({ x, y }));
  const active = surface === 'scene' ? scene : output;

  const histogramPath = useMemo(() => {
    const values = histogram?.luma.data;
    if (!values || values.length === 0) return '';
    const peak = Math.max(...values, 1);
    return values
      .map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * SIZE;
        const y = SIZE - (value / peak) * SIZE * 0.32;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [histogram]);

  const updateCurve = (nextPoints: Array<Point>, patch: Partial<SceneCurveAdjustment & OutputCurveAdjustment> = {}) => {
    setAdjustments((previous) => {
      if (surface === 'scene') {
        return {
          ...previous,
          rawEngineEditGraphVersion: 2,
          sceneCurve: {
            ...(previous.sceneCurve ?? getDefaultSceneCurve()),
            enabled: true,
            ...patch,
            points: nextPoints.map(({ x, y }) => ({ xEv: x, yEv: y })),
          },
        };
      }
      return {
        ...previous,
        rawEngineEditGraphVersion: 2,
        outputCurve: {
          ...(previous.outputCurve ?? getDefaultOutputCurve()),
          enabled: true,
          ...patch,
          points: nextPoints,
        },
      };
    });
  };

  const eventPoint = (event: PointerEvent<SVGSVGElement>): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: range.minimum, y: range.minimum };
    const normalizedX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const normalizedY = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const width = range.maximum - range.minimum;
    return { x: range.minimum + normalizedX * width, y: range.minimum + normalizedY * width };
  };

  const constrainPoint = (index: number, point: Point): Point => {
    const previous = points[index - 1];
    const next = points[index + 1];
    const epsilon = (range.maximum - range.minimum) / 1024;
    return {
      x: clamp(point.x, previous ? previous.x + epsilon : range.minimum, next ? next.x - epsilon : range.maximum),
      y: clamp(point.y, previous?.y ?? range.minimum, next?.y ?? range.maximum),
    };
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (dragIndex === null) return;
    const next = [...points];
    next[dragIndex] = constrainPoint(dragIndex, eventPoint(event));
    updateCurve(next);
  };

  const finishDrag = () => {
    if (dragIndex === null) return;
    setDragIndex(null);
    onDragStateChange?.(false);
  };

  const addPoint = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && !targeted) return;
    const point = eventPoint(event);
    const next = [...points, point].sort((left, right) => left.x - right.x);
    const index = next.indexOf(point);
    next[index] = constrainPoint(index, point);
    setSelectedIndex(index);
    updateCurve(next);
    setTargeted(false);
  };

  const removeSelected = () => {
    if (selectedIndex <= 0 || selectedIndex >= points.length - 1) return;
    updateCurve(points.filter((_, index) => index !== selectedIndex));
    setSelectedIndex(Math.max(0, selectedIndex - 1));
  };

  const setChannelMode = (channelMode: ProfessionalCurveChannelMode) => updateCurve(points, { channelMode });
  const setHdr = (enabled: boolean) => {
    const maximumValue = enabled ? 4 : 1;
    const scaled = output.points.map((point) => ({ x: point.x, y: point.y }));
    if (enabled && scaled.at(-1)?.x === 1 && scaled.at(-1)?.y === 1) scaled.push({ x: 4, y: 4 });
    updateCurve(scaled, { maximumValue });
  };

  const path = points
    .map((point, index) => {
      const width = range.maximum - range.minimum;
      const x = ((point.x - range.minimum) / width) * SIZE;
      const y = SIZE - ((point.y - range.minimum) / width) * SIZE;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <section className="mb-3 rounded-md border border-border/70 bg-background/25 p-2" data-testid="professional-curves">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex rounded bg-secondary/60 p-0.5">
          {(['scene', 'output'] as const).map((value) => (
            <button
              className={`rounded px-2 py-1 text-xs ${surface === value ? 'bg-background text-foreground shadow' : 'text-muted-foreground'}`}
              key={value}
              onClick={() => setSurface(value)}
              type="button"
            >
              {value === 'scene'
                ? t('adjustments.curves.scene.title', { defaultValue: 'Scene Curve' })
                : t('adjustments.curves.output.title', { defaultValue: 'Output Curve' })}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            aria-pressed={targeted}
            className={`rounded p-1 ${targeted ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}
            onClick={() => setTargeted((value) => !value)}
            title={t('adjustments.curves.targeted', { defaultValue: 'Targeted adjustment' })}
            type="button"
          >
            <Crosshair size={14} />
          </button>
          <button
            className="rounded bg-secondary p-1"
            onClick={() =>
              updateCurve(
                surface === 'scene'
                  ? getDefaultSceneCurve().points.map(({ xEv, yEv }) => ({ x: xEv, y: yEv }))
                  : getDefaultOutputCurve().points,
                { enabled: false },
              )
            }
            title={t('common.reset', { defaultValue: 'Reset' })}
            type="button"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2 text-xs">
        <select
          aria-label={t('adjustments.curves.channelMode', { defaultValue: 'Curve channel mode' })}
          className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1"
          onChange={(event) => setChannelMode(event.target.value as ProfessionalCurveChannelMode)}
          value={active.channelMode}
        >
          {CHANNELS.map((channel) => (
            <option key={channel.value} value={channel.value}>
              {channel.label}
            </option>
          ))}
        </select>
        {surface === 'output' && (
          <label className="flex items-center gap-1 whitespace-nowrap">
            <input
              checked={output.maximumValue > 1}
              onChange={(event) => setHdr(event.target.checked)}
              type="checkbox"
            />
            {t('adjustments.curves.output.hdrRange', { defaultValue: 'HDR 4×' })}
          </label>
        )}
      </div>

      <div className="relative overflow-hidden rounded border border-border bg-black/25">
        <svg
          aria-label={surface === 'scene' ? 'Scene EV curve editor' : 'Output curve editor'}
          className={`block aspect-square w-full touch-none ${targeted ? 'cursor-crosshair' : ''}`}
          onPointerDown={addPoint}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
        >
          <path d={`M0 ${SIZE / 2}H${SIZE} M${SIZE / 2} 0V${SIZE}`} stroke="currentColor" strokeOpacity="0.16" />
          {histogramPath && <path d={histogramPath} fill="none" stroke="currentColor" strokeOpacity="0.22" />}
          <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
          {points.map((point, index) => {
            const width = range.maximum - range.minimum;
            const x = ((point.x - range.minimum) / width) * SIZE;
            const y = SIZE - ((point.y - range.minimum) / width) * SIZE;
            return (
              <circle
                aria-label={`Curve point ${index + 1}`}
                cx={x}
                cy={y}
                fill={selectedIndex === index ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
                key={`${point.x}-${index}`}
                onDoubleClick={removeSelected}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedIndex(index);
                  setDragIndex(index);
                  onDragStateChange?.(true);
                }}
                r="4"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                tabIndex={0}
              />
            );
          })}
        </svg>
        <span className="absolute bottom-1 left-1 text-[10px] text-muted-foreground">
          {surface === 'scene' ? '-16 EV' : '0'}
        </span>
        <span className="absolute bottom-1 right-1 text-[10px] text-muted-foreground">
          {surface === 'scene' ? '+16 EV' : output.maximumValue > 1 ? '4× white' : '100%'}
        </span>
      </div>

      {points[selectedIndex] && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            X
            <input
              className="w-16 rounded border border-border bg-background px-1 py-0.5"
              onInput={(event) => {
                const current = points[selectedIndex];
                if (!current) return;
                const next = [...points];
                next[selectedIndex] = constrainPoint(selectedIndex, {
                  ...current,
                  x: Number(event.currentTarget.value),
                });
                updateCurve(next);
              }}
              step="0.1"
              type="number"
              value={points[selectedIndex].x}
            />
          </label>
          <label className="flex items-center gap-1">
            Y
            <input
              className="w-16 rounded border border-border bg-background px-1 py-0.5"
              onInput={(event) => {
                const current = points[selectedIndex];
                if (!current) return;
                const next = [...points];
                next[selectedIndex] = constrainPoint(selectedIndex, {
                  ...current,
                  y: Number(event.currentTarget.value),
                });
                updateCurve(next);
              }}
              step="0.1"
              type="number"
              value={points[selectedIndex].y}
            />
          </label>
          <button
            className="ml-auto rounded bg-secondary px-2 py-1 disabled:opacity-40"
            disabled={selectedIndex <= 0 || selectedIndex >= points.length - 1}
            onClick={removeSelected}
            type="button"
          >
            {t('common.delete', { defaultValue: 'Delete' })}
          </button>
        </div>
      )}
    </section>
  );
}
