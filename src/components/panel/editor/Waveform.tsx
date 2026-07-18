import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { AlertOctagon } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PreviewScopeStatus } from '../../../store/useEditorStore';
import { BasicAdjustment, DisplayMode } from '../../../utils/adjustments';
import type { ChannelConfig } from '../../adjustments/Curves';
import type { WaveformData } from '../../ui/AppProperties';

interface WaveformProps {
  waveformData: WaveformData | null;
  histogram?: ChannelConfig | null;
  displayMode: DisplayMode;
  setDisplayMode: (mode: DisplayMode) => void;
  showClipping?: boolean;
  onToggleClipping?: () => void;
  previewScopeStatus?: PreviewScopeStatus | null;
  showInlineControls?: boolean;
  theme?: string;
}

type WaveformTooltipKey =
  | 'ui.waveform.tooltips.histogram'
  | 'ui.waveform.tooltips.luma'
  | 'ui.waveform.tooltips.parade'
  | 'ui.waveform.tooltips.rgb'
  | 'ui.waveform.tooltips.vectorscope';

interface ModeButton {
  mode: DisplayMode;
  label: string;
  tooltip: WaveformTooltipKey;
  bgClass: string;
  textActiveClass: string;
}

interface Particle {
  active: boolean;
  b: number;
  g: number;
  life: number;
  maxLife: number;
  r: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
}

interface HistogramChannel {
  color: string;
  data: Array<number>;
  key: 'blue' | 'green' | 'luma' | 'red';
}

export interface HistogramClippingSummary {
  highlightPercent: number;
  shadowPercent: number;
}

export interface HistogramHoverSample {
  bin: number;
  bluePercent: number;
  greenPercent: number;
  lumaPercent: number;
  redPercent: number;
  zone: 'blacks' | 'exposure' | 'highlights' | 'shadows' | 'whites';
}

/** The five editable tonal regions exposed by the compact histogram. */
export type HistogramTonalZone = HistogramHoverSample['zone'];

export interface HistogramTonalZoneConfig {
  adjustment: BasicAdjustment;
  key: HistogramTonalZone;
  label: string;
  max: number;
  min: number;
  step: number;
  widthFraction: number;
}

export const HISTOGRAM_TONAL_ZONES: ReadonlyArray<HistogramTonalZoneConfig> = [
  {
    adjustment: BasicAdjustment.Blacks,
    key: 'blacks',
    label: 'Blacks',
    max: 100,
    min: -100,
    step: 1,
    widthFraction: 0.1,
  },
  {
    adjustment: BasicAdjustment.Shadows,
    key: 'shadows',
    label: 'Shadows',
    max: 100,
    min: -100,
    step: 1,
    widthFraction: 0.2,
  },
  {
    adjustment: BasicAdjustment.Exposure,
    key: 'exposure',
    label: 'Exposure',
    max: 5,
    min: -5,
    step: 0.01,
    widthFraction: 0.4,
  },
  {
    adjustment: BasicAdjustment.Highlights,
    key: 'highlights',
    label: 'Highlights',
    max: 100,
    min: -100,
    step: 1,
    widthFraction: 0.2,
  },
  {
    adjustment: BasicAdjustment.Whites,
    key: 'whites',
    label: 'Whites',
    max: 100,
    min: -100,
    step: 1,
    widthFraction: 0.1,
  },
] as const;

export const getHistogramTonalZoneConfig = (zone: HistogramTonalZone): HistogramTonalZoneConfig =>
  HISTOGRAM_TONAL_ZONES.find((candidate) => candidate.key === zone) ?? HISTOGRAM_TONAL_ZONES[2]!;

export const getHistogramTonalZoneForPosition = (position: number): HistogramTonalZone => {
  const clamped = Math.max(0, Math.min(1, position));
  let accumulated = 0;
  for (const zone of HISTOGRAM_TONAL_ZONES) {
    accumulated += zone.widthFraction;
    if (clamped < accumulated) return zone.key;
  }
  return 'whites';
};

export interface HistogramTonalZoneEditor {
  enabled: boolean;
  values: Partial<Record<BasicAdjustment, number>>;
  onInteractionStart: (zone: HistogramTonalZone) => void;
  onInteractionChange: (zone: HistogramTonalZone, value: number) => void;
  onInteractionCommit: (zone: HistogramTonalZone) => void;
  onInteractionCancel: (zone: HistogramTonalZone) => void;
  onInteractionReset: (zone: HistogramTonalZone) => void;
}

interface HistogramViewProps {
  histogram: ChannelConfig | null | undefined;
  interactive?: boolean;
  onHoverSample?: (sample: HistogramHoverSample | null) => void;
  showClippingReadouts?: boolean;
  testId?: string;
  tonalZoneEditor?: HistogramTonalZoneEditor;
}

const modeButtons: ReadonlyArray<ModeButton> = [
  {
    mode: DisplayMode.Luma,
    label: 'L',
    tooltip: 'ui.waveform.tooltips.luma',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Rgb,
    label: 'RGB',
    tooltip: 'ui.waveform.tooltips.rgb',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Parade,
    label: 'P',
    tooltip: 'ui.waveform.tooltips.parade',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Vectorscope,
    label: 'V',
    tooltip: 'ui.waveform.tooltips.vectorscope',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Histogram,
    label: 'H',
    tooltip: 'ui.waveform.tooltips.histogram',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
] as const;

export const getHistogramChannelData = (channel: unknown): Array<number> => {
  if (Array.isArray(channel)) {
    return channel.map((value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0));
  }
  if (typeof channel === 'object' && channel !== null && 'data' in channel) {
    const { data } = channel as { data?: unknown };
    if (Array.isArray(data)) {
      return data.map((value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0));
    }
  }
  return [];
};

export const getHistogramClippingSummary = (histogram: ChannelConfig | null | undefined): HistogramClippingSummary => {
  let highlightPercent = 0;
  let shadowPercent = 0;

  const channels: ReadonlyArray<HistogramChannel> = [
    { key: 'red', color: '#ff625f', data: getHistogramChannelData(histogram?.red) },
    { key: 'green', color: '#66d17a', data: getHistogramChannelData(histogram?.green) },
    { key: 'blue', color: '#5c91ff', data: getHistogramChannelData(histogram?.blue) },
  ];

  for (const channel of channels) {
    const total = channel.data.reduce((sum, value) => sum + Math.max(value, 0), 0);
    if (total <= 0) continue;

    const shadowBin = Math.max(channel.data[0] ?? 0, 0);
    const highlightBin = Math.max(channel.data.at(-1) ?? 0, 0);
    shadowPercent = Math.max(shadowPercent, (shadowBin / total) * 100);
    highlightPercent = Math.max(highlightPercent, (highlightBin / total) * 100);
  }

  return { highlightPercent, shadowPercent };
};

export const formatClipPercent = (value: number): string => {
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${value.toFixed(1)}%`;
};

const zoneForBin = (bin: number): HistogramHoverSample['zone'] => {
  if (bin < 26) return 'blacks';
  if (bin < 77) return 'shadows';
  if (bin < 179) return 'exposure';
  if (bin < 230) return 'highlights';
  return 'whites';
};

export const sampleHistogram = (
  histogram: ChannelConfig | null | undefined,
  requestedBin: number,
): HistogramHoverSample | null => {
  const red = getHistogramChannelData(histogram?.red);
  const green = getHistogramChannelData(histogram?.green);
  const blue = getHistogramChannelData(histogram?.blue);
  const luma = getHistogramChannelData(histogram?.luma);
  const binCount = Math.min(red.length, green.length, blue.length, luma.length);
  if (binCount === 0) return null;

  const bin = Math.min(binCount - 1, Math.max(0, Math.round(requestedBin)));
  const peak = Math.max(...red, ...green, ...blue, ...luma, 1);
  const asPercent = (data: number[]) => (Math.max(0, data[bin] ?? 0) / peak) * 100;
  return {
    bin,
    bluePercent: asPercent(blue),
    greenPercent: asPercent(green),
    lumaPercent: asPercent(luma),
    redPercent: asPercent(red),
    zone: zoneForBin(Math.round((bin / Math.max(1, binCount - 1)) * 255)),
  };
};

export const HistogramView = ({
  histogram,
  interactive = false,
  onHoverSample,
  showClippingReadouts = true,
  testId = 'histogram-clipping-readouts',
  tonalZoneEditor,
}: HistogramViewProps) => {
  const { t } = useTranslation();
  const redData = getHistogramChannelData(histogram?.red);
  const greenData = getHistogramChannelData(histogram?.green);
  const blueData = getHistogramChannelData(histogram?.blue);
  const lumaData = getHistogramChannelData(histogram?.luma);
  const [keyboardBin, setKeyboardBin] = useState<number | null>(null);
  const pointerZoneRef = useRef<HistogramTonalZone | null>(null);
  const pointerStartXRef = useRef<number | null>(null);
  const pointerValueRef = useRef<number | null>(null);
  const pointerWidthRef = useRef<number>(1);
  const keyboardZoneRef = useRef<HistogramTonalZone | null>(null);
  const tonalZoneEditorRef = useRef(tonalZoneEditor);
  tonalZoneEditorRef.current = tonalZoneEditor;

  useEffect(() => {
    const cancelInteractionOnWindowBlur = () => {
      const editor = tonalZoneEditorRef.current;
      if (pointerZoneRef.current !== null) {
        editor?.onInteractionCancel(pointerZoneRef.current);
        pointerZoneRef.current = null;
        pointerStartXRef.current = null;
        pointerValueRef.current = null;
      }
      if (keyboardZoneRef.current !== null) {
        editor?.onInteractionCancel(keyboardZoneRef.current);
        keyboardZoneRef.current = null;
      }
    };
    window.addEventListener('blur', cancelInteractionOnWindowBlur);
    return () => {
      window.removeEventListener('blur', cancelInteractionOnWindowBlur);
      cancelInteractionOnWindowBlur();
    };
  }, []);

  const resolvePointerZone = (
    event: Pick<PointerEvent<HTMLElement>, 'clientX' | 'currentTarget'>,
  ): HistogramTonalZone => {
    const targetZone = event.currentTarget.dataset['histogramTonalZone'] as HistogramTonalZone | undefined;
    if (targetZone !== undefined && HISTOGRAM_TONAL_ZONES.some((candidate) => candidate.key === targetZone)) {
      return targetZone;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = bounds.width <= 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return getHistogramTonalZoneForPosition(position);
  };

  const snapTonalValue = (zone: HistogramTonalZone, value: number): number => {
    const config = getHistogramTonalZoneConfig(zone);
    const decimals = config.step.toString().split('.')[1]?.length ?? 0;
    const snapped = Math.round((value - config.min) / config.step) * config.step + config.min;
    return Number(Math.max(config.min, Math.min(config.max, snapped)).toFixed(decimals));
  };

  const clampTonalValue = (zone: HistogramTonalZone, value: number, precision: number): number => {
    const config = getHistogramTonalZoneConfig(zone);
    return Number(Math.max(config.min, Math.min(config.max, value)).toFixed(precision));
  };

  const beginPointerInteraction = (event: PointerEvent<HTMLElement>) => {
    if (!interactive || !tonalZoneEditor?.enabled) return;
    const zone = resolvePointerZone(event);
    const config = getHistogramTonalZoneConfig(zone);
    const value = tonalZoneEditor.values[config.adjustment] ?? 0;
    pointerZoneRef.current = zone;
    pointerStartXRef.current = event.clientX;
    pointerValueRef.current = value;
    pointerWidthRef.current = Math.max(
      1,
      (event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect().width,
    );
    tonalZoneEditor.onInteractionStart(zone);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const updatePointerInteraction = (event: PointerEvent<HTMLElement>) => {
    const zone = pointerZoneRef.current;
    const startX = pointerStartXRef.current;
    const startValue = pointerValueRef.current;
    if (!zone || startX === null || startValue === null || !tonalZoneEditor?.enabled) return;
    const config = getHistogramTonalZoneConfig(zone);
    const next = snapTonalValue(
      zone,
      startValue + ((event.clientX - startX) / pointerWidthRef.current) * (config.max - config.min),
    );
    tonalZoneEditor.onInteractionChange(zone, next);
  };

  const finishPointerInteraction = (cancelled: boolean) => {
    const zone = pointerZoneRef.current;
    if (zone !== null && tonalZoneEditor !== undefined) {
      if (cancelled) tonalZoneEditor.onInteractionCancel(zone);
      else tonalZoneEditor.onInteractionCommit(zone);
    }
    pointerZoneRef.current = null;
    pointerStartXRef.current = null;
    pointerValueRef.current = null;
    pointerWidthRef.current = 1;
  };

  const handleTonalZoneKeyDown = (event: KeyboardEvent<HTMLButtonElement>, zone: HistogramTonalZone) => {
    if (!interactive || !tonalZoneEditor?.enabled) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      tonalZoneEditor.onInteractionCancel(zone);
      keyboardZoneRef.current = null;
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const config = getHistogramTonalZoneConfig(zone);
      tonalZoneEditor.onInteractionStart(zone);
      tonalZoneEditor.onInteractionChange(zone, event.key === 'Home' ? config.min : config.max);
      keyboardZoneRef.current = zone;
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    const config = getHistogramTonalZoneConfig(zone);
    const current = tonalZoneEditor.values[config.adjustment] ?? 0;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown' ? -1 : 1;
    const multiplier =
      event.key === 'PageUp' || event.key === 'PageDown' ? 10 : event.shiftKey || event.altKey ? 0.2 : 1;
    if (keyboardZoneRef.current !== zone) {
      tonalZoneEditor.onInteractionStart(zone);
      keyboardZoneRef.current = zone;
    }
    const baseDecimals = config.step.toString().split('.')[1]?.length ?? 0;
    const precision = multiplier < 1 ? Math.max(1, baseDecimals) : baseDecimals;
    tonalZoneEditor.onInteractionChange(
      zone,
      multiplier < 1
        ? clampTonalValue(zone, current + direction * config.step * multiplier, precision)
        : snapTonalValue(zone, current + direction * config.step * multiplier),
    );
  };

  const handleTonalZoneKeyUp = (event: KeyboardEvent<HTMLButtonElement>, zone: HistogramTonalZone) => {
    if (keyboardZoneRef.current !== zone) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      tonalZoneEditor?.onInteractionCommit(zone);
      keyboardZoneRef.current = null;
    }
  };

  if (redData.length === 0 || greenData.length === 0 || blueData.length === 0 || lumaData.length === 0) return null;

  const redMax = Math.max(...redData);
  const greenMax = Math.max(...greenData);
  const blueMax = Math.max(...blueData);
  const lumaMax = Math.max(...lumaData);
  const globalMax = Math.max(redMax, greenMax, blueMax, lumaMax, 1);

  const getFill = (data: number[]) => {
    const denominator = Math.max(1, data.length - 1);
    const pathData = data.map((val, i) => `${(i / denominator) * 255},${255 - (val / globalMax) * 255}`).join(' L');
    return `M0,255 L${pathData} L255,255 Z`;
  };

  const getLine = (data: number[]) => {
    const denominator = Math.max(1, data.length - 1);
    return `M${data.map((val, i) => `${(i / denominator) * 255},${255 - (val / globalMax) * 255}`).join(' L')}`;
  };

  const channels: Array<HistogramChannel> = [
    { key: 'luma', color: '#d8dde5', data: lumaData },
    { key: 'red', color: '#ff625f', data: redData },
    { key: 'green', color: '#66d17a', data: greenData },
    { key: 'blue', color: '#5c91ff', data: blueData },
  ];
  const clippingSummary = getHistogramClippingSummary(histogram);
  const shadowClipLabel = formatClipPercent(clippingSummary.shadowPercent);
  const highlightClipLabel = formatClipPercent(clippingSummary.highlightPercent);

  const publishSample = (bin: number | null) => {
    onHoverSample?.(bin === null ? null : sampleHistogram(histogram, bin));
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = bounds.width <= 0 ? 0 : (event.clientX - bounds.left) / bounds.width;
    publishSample(position * (Math.min(redData.length, greenData.length, blueData.length, lumaData.length) - 1));
    updatePointerInteraction(event);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const lastBin = Math.min(redData.length, greenData.length, blueData.length, lumaData.length) - 1;
    const step = event.shiftKey ? 16 : 1;
    const current = keyboardBin ?? Math.round(lastBin / 2);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? lastBin
          : event.key === 'ArrowLeft'
            ? Math.max(0, current - step)
            : event.key === 'ArrowRight'
              ? Math.min(lastBin, current + step)
              : null;
    if (event.key === 'Escape') {
      event.preventDefault();
      setKeyboardBin(null);
      publishSample(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setKeyboardBin(next);
    publishSample(next);
  };

  return (
    <div
      aria-label={t('ui.waveform.header.histogramLabel', { defaultValue: 'Current photo RGB histogram' })}
      className="relative h-full w-full overflow-hidden"
      data-histogram-bin-count={Math.min(redData.length, greenData.length, blueData.length, lumaData.length)}
      data-testid={testId}
      onBlur={() => {
        setKeyboardBin(null);
        publishSample(null);
        if (keyboardZoneRef.current !== null) {
          tonalZoneEditor?.onInteractionCancel(keyboardZoneRef.current);
          keyboardZoneRef.current = null;
        }
        if (pointerZoneRef.current !== null) finishPointerInteraction(true);
      }}
      onKeyDown={handleKeyDown}
      onPointerCancel={() => finishPointerInteraction(true)}
      onPointerDown={beginPointerInteraction}
      onPointerLeave={() => publishSample(null)}
      onPointerMove={handlePointerMove}
      onPointerUp={() => finishPointerInteraction(false)}
      role={tonalZoneEditor?.enabled ? 'group' : 'img'}
      tabIndex={interactive ? 0 : undefined}
    >
      <svg
        viewBox="0 0 255 255"
        className="w-full h-full overflow-visible pointer-events-none"
        preserveAspectRatio="none"
      >
        {channels.map((ch) => {
          if (ch.data.length === 0) return null;
          return (
            <g key={ch.key} style={{ mixBlendMode: ch.key === 'luma' ? 'normal' : 'screen' }}>
              <path d={getFill(ch.data)} fill={ch.color} fillOpacity={ch.key === 'luma' ? 0.16 : 0.34} />
              <path
                d={getLine(ch.data)}
                fill="none"
                stroke={ch.color}
                strokeWidth={ch.key === 'luma' ? 1 : 1.2}
                strokeOpacity={ch.key === 'luma' ? 0.72 : 0.92}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </svg>
      {interactive && tonalZoneEditor?.enabled && (
        <div className="absolute inset-0 z-10 flex" data-testid={`${testId}-tonal-zones`}>
          {HISTOGRAM_TONAL_ZONES.map((zone) => {
            const config = getHistogramTonalZoneConfig(zone.key);
            const value = tonalZoneEditor.values[config.adjustment] ?? 0;
            const active = pointerZoneRef.current === zone.key || keyboardZoneRef.current === zone.key;
            const zoneLabel = t(`ui.waveform.header.zones.${zone.key}`, { defaultValue: zone.label });
            return (
              <button
                aria-label={`${zoneLabel} tonal adjustment`}
                aria-valuemax={config.max}
                aria-valuemin={config.min}
                aria-valuenow={value}
                aria-valuetext={`${value}${zone.key === 'exposure' ? ' EV' : ''}`}
                className={`h-full min-w-0 cursor-ew-resize border-r border-white/8 bg-transparent transition-colors focus-visible:bg-white/12 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/70 ${active ? 'bg-white/12' : 'hover:bg-white/6'}`}
                data-active={String(active)}
                data-histogram-tonal-zone={zone.key}
                data-tonal-value={value}
                data-testid={`${testId}-tonal-zone-${zone.key}`}
                key={zone.key}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  tonalZoneEditor.onInteractionReset(zone.key);
                }}
                onKeyDown={(event) => handleTonalZoneKeyDown(event, zone.key)}
                onKeyUp={(event) => handleTonalZoneKeyUp(event, zone.key)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginPointerInteraction(event);
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  finishPointerInteraction(false);
                }}
                onPointerCancel={(event) => {
                  event.stopPropagation();
                  finishPointerInteraction(true);
                }}
                role="slider"
                style={{ flex: `0 0 ${zone.widthFraction * 100}%` }}
                type="button"
              />
            );
          })}
        </div>
      )}
      {showClippingReadouts && (
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <span
            className="rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
            data-shadow-clipping={shadowClipLabel}
          >
            {t('ui.waveform.clippingReadouts.shadows', { value: shadowClipLabel })}
          </span>
          <span
            className="rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
            data-highlight-clipping={highlightClipLabel}
          >
            {t('ui.waveform.clippingReadouts.highlights', { value: highlightClipLabel })}
          </span>
        </div>
      )}
    </div>
  );
};

const useRawRgbaCanvas = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  resourceUrl: string,
  width: number,
  height: number,
) => {
  useEffect(() => {
    if (!resourceUrl || !canvasRef.current || !width || !height) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    const abort = new AbortController();
    void fetch(resourceUrl, { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Analytics resource failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (buffer.byteLength !== width * height * 4 || abort.signal.aborted) return;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) console.error('Failed to load analytics resource', error);
      });
    return () => abort.abort();
  }, [resourceUrl, width, height, canvasRef]);
};

const WaveformCanvas = ({
  base64Data,
  width,
  height,
  isVectorscope,
}: {
  base64Data: string;
  width: number;
  height: number;
  isVectorscope: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useRawRgbaCanvas(canvasRef, base64Data, width, height);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`w-full h-full ${isVectorscope ? 'object-contain' : ''}`}
    />
  );
};

const FakeWaveformLoader = ({ mode }: { mode: DisplayMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastTimeRef = useRef<number>(0);
  const spawnAccumulatorRef = useRef<number>(0);

  const MAX_PARTICLES = 10000;
  const particles = useMemo<Array<Particle>>(
    () =>
      Array.from({ length: MAX_PARTICLES }, () => ({
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        life: 0,
        maxLife: 1,
        r: 255,
        g: 255,
        b: 255,
        active: false,
      })),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const WIDTH = 256;
    const HEIGHT = 256;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    particles.forEach((p) => (p.active = false));
    lastTimeRef.current = 0;
    spawnAccumulatorRef.current = 0;
    let isPrewarmed = false;

    const imgData = ctx.createImageData(WIDTH, HEIGHT);
    const data = imgData.data;

    const gridBuffer = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    if (mode === DisplayMode.Vectorscope) {
      for (let py = 0; py < HEIGHT; py++) {
        for (let px = 0; px < WIDTH; px++) {
          const dx = px - 128.0;
          const dy = 128.0 - py;
          const min_d = Math.min(Math.abs(dx), Math.abs(dy));
          const dist = Math.sqrt(dx * dx + dy * dy);
          const off = (py * WIDTH + px) * 4;

          if (min_d <= 1.0) {
            const alpha = Math.max(0, 40.0 - min_d * 30.0);
            gridBuffer[off] = 255;
            gridBuffer[off + 1] = 255;
            gridBuffer[off + 2] = 255;
            gridBuffer[off + 3] = alpha;
          } else if (Math.abs(dist - 127.0) < 0.8 || Math.abs(dist - 64.0) < 0.8) {
            gridBuffer[off] = 255;
            gridBuffer[off + 1] = 255;
            gridBuffer[off + 2] = 255;
            gridBuffer[off + 3] = 15;
          } else if (dx < 0.0 && dy > 0.0 && Math.abs(dy + 1.53 * dx) < 1.0) {
            gridBuffer[off] = 255;
            gridBuffer[off + 1] = 200;
            gridBuffer[off + 2] = 150;
            gridBuffer[off + 3] = 120;
          }
        }
      }
    }

    let animationFrameId: number;

    const render = (time: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = time;
      let dt = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      if (dt > 0.05) dt = 0.05;

      let frameDt = dt;

      if (!isPrewarmed) {
        frameDt = 0.5;
        isPrewarmed = true;
      }

      data.set(gridBuffer);

      const SPAWN_RATE = 1000;
      spawnAccumulatorRef.current += SPAWN_RATE * frameDt;

      const dotsToSpawn = Math.floor(spawnAccumulatorRef.current);
      if (dotsToSpawn > 0) {
        spawnAccumulatorRef.current -= dotsToSpawn;
        let spawnedCount = 0;

        for (const p of particles) {
          if (spawnedCount >= dotsToSpawn) break;

          if (!p.active) {
            p.active = true;

            if (mode !== DisplayMode.Vectorscope) {
              p.x = Math.random() * WIDTH;
              p.targetX = p.x;

              p.y = HEIGHT - Math.random() * 2;

              const isPot = Math.random() < 0.4;

              if (isPot) {
                p.targetY = HEIGHT - Math.random() * 6;
              } else {
                const randomCurve = Math.random() ** 1.2;
                p.targetY = HEIGHT - randomCurve * HEIGHT;
              }

              if (mode === DisplayMode.Parade) {
                const section = Math.floor((p.x / WIDTH) * 3);
                if (section === 0) {
                  p.r = 255;
                  p.g = 70;
                  p.b = 70;
                } else if (section === 1) {
                  p.r = 70;
                  p.g = 255;
                  p.b = 70;
                } else {
                  p.r = 70;
                  p.g = 150;
                  p.b = 255;
                }
              } else if (mode === DisplayMode.Rgb) {
                const rand = Math.random();
                if (rand > 0.85) {
                  p.r = 255;
                  p.g = 80;
                  p.b = 80;
                } else if (rand > 0.7) {
                  p.r = 80;
                  p.g = 255;
                  p.b = 80;
                } else if (rand > 0.55) {
                  p.r = 80;
                  p.g = 150;
                  p.b = 255;
                } else {
                  p.r = 255;
                  p.g = 255;
                  p.b = 255;
                }
              } else {
                p.r = 255;
                p.g = 255;
                p.b = 255;
              }
            }

            const life = Math.random() * 5.0 + 8.0;
            p.life = life;
            p.maxLife = life;

            spawnedCount++;
          }
        }
      }

      const speedMultiplier = 1;
      const interpolation = 1 - Math.exp(-speedMultiplier * frameDt);

      for (const p of particles) {
        if (p.active) {
          p.life -= frameDt;

          if (p.life <= 0) {
            p.active = false;
            continue;
          }

          p.x += (p.targetX - p.x) * interpolation;
          p.y += (p.targetY - p.y) * interpolation;

          const lifeRatio = p.life / p.maxLife;

          let opacity = 1.0;
          if (lifeRatio > 0.8) {
            opacity = (1 - lifeRatio) / 0.12;
          } else if (lifeRatio < 0.2) {
            opacity = lifeRatio / 0.2;
          }

          const alpha = opacity * 0.18;

          const px = Math.floor(p.x);
          const py = Math.floor(p.y);

          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 1.5; dx++) {
              const cx = px + dx;
              const cy = py + dy;

              if (cx >= 0 && cx < WIDTH && cy >= 0 && cy < HEIGHT) {
                const idx = (cy * WIDTH + cx) * 4;
                data[idx] = Math.min(255, (data[idx] ?? 0) + p.r * alpha);
                data[idx + 1] = Math.min(255, (data[idx + 1] ?? 0) + p.g * alpha);
                data[idx + 2] = Math.min(255, (data[idx + 2] ?? 0) + p.b * alpha);
                data[idx + 3] = Math.min(255, (data[idx + 3] ?? 0) + alpha * 255);
              }
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [mode, particles]);

  return (
    <canvas ref={canvasRef} className={`w-full h-full ${mode === DisplayMode.Vectorscope ? 'object-contain' : ''}`} />
  );
};

export default function Waveform({
  waveformData,
  histogram,
  displayMode,
  setDisplayMode,
  showClipping,
  onToggleClipping,
  previewScopeStatus,
  showInlineControls = true,
  theme,
}: WaveformProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLightTheme = theme ? ['light', 'snow', 'arctic'].includes(theme) : false;
  const isHistogram = displayMode === DisplayMode.Histogram;
  const isVectorscope = displayMode === DisplayMode.Vectorscope;
  const isReady = isHistogram ? !!histogram?.red : !!waveformData;
  const [hadDataOnMount] = useState(isReady);
  const width = waveformData?.width || 256;
  const height = waveformData?.height || 256;

  const activeData = waveformData
    ? {
        [DisplayMode.Rgb]: waveformData.rgb,
        [DisplayMode.Luma]: waveformData.luma,
        [DisplayMode.Parade]: waveformData.parade,
        [DisplayMode.Vectorscope]: waveformData.vectorscope,
        [DisplayMode.Histogram]: undefined,
      }[displayMode]
    : '';

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 250);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const baseButtonClass =
    'relative grow text-center px-1.5 py-1 text-xs rounded-lg font-medium transition-colors duration-150';
  const inactiveButtonClass = 'text-text-primary hover:bg-bg-tertiary';

  const isLoaderMode = [
    DisplayMode.Luma,
    DisplayMode.Rgb,
    DisplayMode.Parade,
    DisplayMode.Vectorscope,
    DisplayMode.Histogram,
  ].includes(displayMode);
  const scopeUpdatedAt = previewScopeStatus?.updatedAt ? new Date(previewScopeStatus.updatedAt) : null;
  const scopeUpdatedLabel =
    scopeUpdatedAt && Number.isFinite(scopeUpdatedAt.getTime())
      ? scopeUpdatedAt.toLocaleTimeString()
      : t('ui.waveform.scopeStatus.pending');
  const scopeReadinessLabel =
    previewScopeStatus?.histogramReady && previewScopeStatus.waveformReady
      ? t('ui.waveform.scopeStatus.ready')
      : t('ui.waveform.scopeStatus.updating');
  const transformPathLabel = previewScopeStatus
    ? t('ui.waveform.scopeStatus.transformPath', {
        display: previewScopeStatus.displayTransformLabel,
        working: previewScopeStatus.workingTransformLabel,
      })
    : '';

  return (
    <div
      className="relative w-full h-full bg-surface rounded-lg overflow-hidden border-border-color shadow-inner"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          isolation: 'isolate',
          filter: isLightTheme ? 'invert(1) hue-rotate(180deg)' : 'none',
          transition: 'filter 0.3s ease',
        }}
      >
        <AnimatePresence initial={!hadDataOnMount} mode="sync">
          {isReady ? (
            isHistogram ? (
              <motion.div
                key="waveform-histogram"
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0 }}
                transition={{
                  duration: 0.5,
                  ease: [0.22, 1, 0.36, 1],
                  opacity: { duration: 0.4 },
                }}
                style={{ transformOrigin: 'bottom' }}
                className="absolute inset-0 z-10"
              >
                <HistogramView histogram={histogram} />
              </motion.div>
            ) : (
              <motion.div
                key={`waveform-canvas-${displayMode}`}
                initial={{ opacity: 0, ...(isVectorscope ? {} : { scaleY: 0 }) }}
                animate={{ opacity: 1, ...(isVectorscope ? {} : { scaleY: 1 }) }}
                exit={{ opacity: 0, ...(isVectorscope ? {} : { scaleY: 0 }) }}
                transition={{
                  duration: 0.5,
                  ease: [0.22, 1, 0.36, 1],
                  opacity: { duration: 0.4 },
                }}
                style={{ transformOrigin: 'bottom' }}
                className="absolute inset-0 z-10"
              >
                <WaveformCanvas
                  base64Data={activeData || ''}
                  width={width}
                  height={height}
                  isVectorscope={isVectorscope}
                />
              </motion.div>
            )
          ) : isLoaderMode ? (
            <motion.div
              key={`waveform-loader-${displayMode}`}
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { duration: 0.6, ease: 'easeOut' },
              }}
              exit={{
                opacity: 0,
                transition: { duration: 0.2, ease: 'easeIn' },
              }}
              className="absolute inset-0 pointer-events-none z-0"
            >
              {isHistogram ? (
                <div
                  aria-hidden="true"
                  className="h-full w-full animate-pulse bg-linear-to-b from-white/4 via-white/7 to-transparent"
                  data-testid="histogram-loading-surface"
                />
              ) : (
                <FakeWaveformLoader mode={displayMode} />
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showInlineControls && isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute inset-x-0 bottom-0 p-2 pt-6 bg-linear-to-t from-black/80 to-transparent flex justify-center z-20"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1, ease: 'easeOut', delay: 0.05 }}
              className="flex items-center justify-center gap-1 p-1 bg-surface/90 backdrop-blur-md rounded-lg w-full shadow-lg border border-white/5"
            >
              {onToggleClipping && (
                <>
                  <button
                    aria-label={
                      showClipping ? t('ui.waveform.tooltips.hideClipping') : t('ui.waveform.tooltips.showClipping')
                    }
                    aria-pressed={showClipping}
                    onClick={onToggleClipping}
                    data-testid="waveform-clipping-toggle"
                    data-tooltip={
                      showClipping ? t('ui.waveform.tooltips.hideClipping') : t('ui.waveform.tooltips.showClipping')
                    }
                    className={`relative flex items-center justify-center w-7 h-7 shrink-0 rounded-lg transition-colors duration-150 ${
                      showClipping ? 'bg-accent text-button-text' : 'text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    <AlertOctagon size={14} />
                  </button>
                  <div className="w-px h-5 bg-white/20 mx-1 shrink-0"></div>
                </>
              )}

              <LayoutGroup>
                {modeButtons.map(({ mode, label, tooltip, bgClass, textActiveClass }) => (
                  <button
                    aria-label={t(tooltip, { defaultValue: label })}
                    aria-pressed={displayMode === mode}
                    key={mode}
                    onClick={() => {
                      setDisplayMode(mode);
                    }}
                    data-testid={`waveform-mode-${mode}`}
                    data-tooltip={t(tooltip, { defaultValue: label })}
                    className={`${baseButtonClass} ${displayMode === mode ? textActiveClass : inactiveButtonClass}`}
                  >
                    {displayMode === mode && (
                      <motion.div
                        layoutId="waveform-mode-indicator"
                        className={`absolute inset-0 ${bgClass} rounded-lg`}
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </LayoutGroup>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div
        className="absolute left-2 top-2 z-20 max-w-[calc(100%-1rem)] rounded bg-black/60 px-2 py-1 text-[10px] text-white/80 backdrop-blur"
        data-display-transform-label={previewScopeStatus?.displayTransformLabel ?? ''}
        data-export-profile-label={previewScopeStatus?.exportProfileLabel ?? ''}
        data-export-rendering-intent-label={previewScopeStatus?.exportRenderingIntentLabel ?? ''}
        data-preview-scope-ready={String(
          Boolean(previewScopeStatus?.histogramReady && previewScopeStatus.waveformReady),
        )}
        data-preview-scope-render-basis={previewScopeStatus?.renderBasis ?? ''}
        data-preview-scope-source={previewScopeStatus?.sourceLabel ?? ''}
        data-preview-scope-soft-proof-transform-applied={String(previewScopeStatus?.softProofTransformApplied ?? '')}
        data-preview-scope-updated-at={previewScopeStatus?.updatedAt ?? ''}
        data-preview-scope-warning-codes={previewScopeStatus?.warningCodes.join(',') ?? ''}
        data-testid="preview-scope-status"
        data-working-transform-label={previewScopeStatus?.workingTransformLabel ?? ''}
      >
        {previewScopeStatus ? (
          <>
            <span className="font-semibold">{scopeReadinessLabel}</span>
            <span>{previewScopeStatus.sourceLabel}</span>
            <span>{transformPathLabel}</span>
            <span>{scopeUpdatedLabel}</span>
          </>
        ) : (
          <span>{t('ui.waveform.scopeStatus.pending')}</span>
        )}
      </div>
    </div>
  );
}
