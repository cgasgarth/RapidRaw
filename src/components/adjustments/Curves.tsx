import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardPaste, Copy, RotateCcw, Settings2, Spline } from 'lucide-react';
import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useContextMenu } from '../../context/ContextMenuContext';
import { ActiveChannel, type Adjustments, type Coord, type ParametricCurveSettings } from '../../utils/adjustments';
import { OPTION_SEPARATOR, Theme } from '../ui/AppProperties';
import AdjustmentSlider from './AdjustmentSlider';

let curveClipboard: Array<Coord> | null = null;
let parametricClipboard: ParametricCurveSettings | null = null;

type CurveAdjustmentUpdater = (prev: Adjustments) => Adjustments;
type PointerInputEvent = globalThis.MouseEvent | TouchEvent | ReactMouseEvent | ReactTouchEvent;

const CURVE_CHANNELS = [ActiveChannel.Luma, ActiveChannel.Red, ActiveChannel.Green, ActiveChannel.Blue] as const;
const CURVE_CHANNEL_LABEL_FALLBACKS: Record<ActiveChannel, string> = {
  [ActiveChannel.Blue]: 'Blue',
  [ActiveChannel.Green]: 'Green',
  [ActiveChannel.Luma]: 'Luma',
  [ActiveChannel.Red]: 'Red',
};

export type ChannelConfig = Record<ActiveChannel, ColorData>;

interface ColorData {
  color: string;
  data: Array<number> | undefined;
}

interface CurveGraphProps {
  adjustments: Adjustments;
  histogram: ChannelConfig | null;
  isForMask?: boolean;
  setAdjustments: (updater: CurveAdjustmentUpdater) => void;
  theme: Theme;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}

const DEFAULT_PARAMETRIC_CURVE_SETTINGS: ParametricCurveSettings = {
  darks: 0,
  shadows: 0,
  highlights: 0,
  lights: 0,
  whiteLevel: 0,
  blackLevel: 0,
  split1: 25,
  split2: 50,
  split3: 75,
};

const DEFAULT_PARAMETRIC_CURVE: Record<ActiveChannel, ParametricCurveSettings> = {
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
};

const DEFAULT_POINT_CURVES: Record<ActiveChannel, Array<Coord>> = {
  blue: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
};

const formatPercent = (value: number) => `${String(value)}%`;
const formatSvgNumber = (value: number) => String(value);
const formatSvgNumberFixed = (value: number) => value.toFixed(2);
const formatInvertedSvgNumber = (value: number) => String(255 - value);
const formatInvertedSvgNumberFixed = (value: number) => String(255 - Number(value.toFixed(2)));

function buildParametricPoints(settings: ParametricCurveSettings): Array<Coord> {
  const vH = settings.highlights / 100;
  const vL = settings.lights / 100;
  const vD = settings.darks / 100;
  const vS = settings.shadows / 100;

  const blackYOffset = settings.blackLevel;
  const whiteYOffset = settings.whiteLevel;

  const s1 = settings.split1 / 100;
  const s2 = settings.split2 / 100;
  const s3 = settings.split3 / 100;

  const xH = (s3 + 1) / 2;
  const xS = s1 / 2;
  const xs = [0, xS, s1, s2, s3, xH, 1];

  const SLIDER_GAIN = 1.2;
  const MAX_DISPLACEMENT = 0.35;

  const response = (v: number, x: number): number => {
    const headroom = v >= 0 ? 1 - x : x;
    const compressedHeadroom = Math.sqrt(headroom);
    const sigmoid = Math.tanh(v * SLIDER_GAIN);
    return sigmoid * MAX_DISPLACEMENT * compressedHeadroom;
  };

  const ys = [
    0,
    xS + response(vS, xS),
    s1 + (response(vS, s1) + response(vD, s1)) / 2,
    s2 + (response(vD, s2) + response(vL, s2)) / 2,
    s3 + (response(vL, s3) + response(vH, s3)) / 2,
    xH + response(vH, xH),
    1,
  ];

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const points = xs.map((x, i) => ({
    x: x * 255,
    y: clamp(ys[i] ?? x) * 255,
  }));

  if (points.length >= 2) {
    const firstPoint = points[0];
    const lastIndex = points.length - 1;
    const lastPoint = points[lastIndex];
    if (firstPoint && lastPoint) {
      firstPoint.y = Math.max(0, Math.min(255, firstPoint.y + blackYOffset));
      lastPoint.y = Math.max(0, Math.min(255, lastPoint.y + whiteYOffset));
    }
  }

  return points;
}

function getCurvePath(points: Array<Coord>) {
  if (points.length < 2) return '';

  const n = points.length;
  const deltas = [];
  const ms = [];

  for (let i = 0; i < n - 1; i++) {
    const currentPoint = points[i];
    const nextPoint = points[i + 1];
    if (!currentPoint || !nextPoint) continue;

    const dx = nextPoint.x - currentPoint.x;
    const dy = nextPoint.y - currentPoint.y;
    if (dx === 0) {
      deltas.push(dy > 0 ? 1e6 : dy < 0 ? -1e6 : 0);
    } else {
      deltas.push(dy / dx);
    }
  }

  const firstDelta = deltas[0];
  if (firstDelta === undefined) return '';

  ms.push(firstDelta);

  for (let i = 1; i < n - 1; i++) {
    const previousDelta = deltas[i - 1] ?? 0;
    const currentDelta = deltas[i] ?? 0;
    if (previousDelta * currentDelta <= 0) {
      ms.push(0);
    } else {
      ms.push((previousDelta + currentDelta) / 2);
    }
  }

  ms.push(deltas[n - 2] ?? 0);

  for (let i = 0; i < n - 1; i++) {
    const delta = deltas[i];
    const currentSlope = ms[i];
    const nextSlope = ms[i + 1];
    if (delta === undefined || currentSlope === undefined || nextSlope === undefined) continue;

    if (delta === 0) {
      ms[i] = 0;
      ms[i + 1] = 0;
    } else {
      const alpha: number = currentSlope / delta;
      const beta: number = nextSlope / delta;

      const tau = alpha * alpha + beta * beta;
      if (tau > 9) {
        const scale = 3.0 / Math.sqrt(tau);
        ms[i] = scale * alpha * delta;
        ms[i + 1] = scale * beta * delta;
      }
    }
  }

  let path = '';

  const firstPoint = points[0];
  const lastPoint = points[n - 1];
  if (!firstPoint || !lastPoint) return '';

  if (firstPoint.x > 0) {
    path += `M 0 ${formatInvertedSvgNumber(firstPoint.y)} L ${formatSvgNumber(firstPoint.x)} ${formatInvertedSvgNumber(firstPoint.y)}`;
  } else {
    path += `M ${formatSvgNumber(firstPoint.x)} ${formatInvertedSvgNumber(firstPoint.y)}`;
  }

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const m0 = ms[i];
    const m1 = ms[i + 1];
    if (!p0 || !p1 || m0 === undefined || m1 === undefined) continue;

    const dx = p1.x - p0.x;

    const cp1x = p0.x + dx / 3.0;
    const cp1y = p0.y + (m0 * dx) / 3.0;
    const cp2x = p1.x - dx / 3.0;
    const cp2y = p1.y - (m1 * dx) / 3.0;

    path += ` C ${formatSvgNumberFixed(cp1x)} ${formatInvertedSvgNumberFixed(cp1y)}, ${formatSvgNumberFixed(
      cp2x,
    )} ${formatInvertedSvgNumberFixed(cp2y)}, ${formatSvgNumber(p1.x)} ${formatInvertedSvgNumber(p1.y)}`;
  }

  if (lastPoint.x < 255) {
    path += ` L 255 ${formatInvertedSvgNumber(lastPoint.y)}`;
  }

  return path;
}

function getHistogramPath(data: Array<number> | undefined) {
  if (!data || data.length === 0) return '';
  const maxVal = Math.max(...data);
  if (maxVal === 0) return '';

  const pathData = data
    .map((value: number, index: number) => {
      const x = (index / 255) * 255;
      const y = 255 - (value / maxVal) * 255;
      return `${formatSvgNumber(x)},${formatSvgNumber(y)}`;
    })
    .join(' ');

  return `M0,255 L${pathData} L255,255 Z`;
}

function getZeroHistogramPath(data: Array<number> | undefined) {
  if (!data || data.length === 0) return '';
  const pathData = data.map((_, index: number) => `${formatSvgNumber((index / 255) * 255)},255`).join(' ');
  return `M0,255 L${pathData} L255,255 Z`;
}

function isDefaultCurve(points: Array<Coord> | undefined) {
  if (points?.length !== 2) return false;
  const [p1, p2] = points;
  if (!p1 || !p2) return false;
  return p1.x === 0 && p1.y === 0 && p2.x === 255 && p2.y === 255;
}

function isDefaultParametricCurve(settings: ParametricCurveSettings | undefined) {
  if (!settings) return true;
  return (
    settings.darks === DEFAULT_PARAMETRIC_CURVE_SETTINGS.darks &&
    settings.shadows === DEFAULT_PARAMETRIC_CURVE_SETTINGS.shadows &&
    settings.lights === DEFAULT_PARAMETRIC_CURVE_SETTINGS.lights &&
    settings.highlights === DEFAULT_PARAMETRIC_CURVE_SETTINGS.highlights &&
    settings.whiteLevel === DEFAULT_PARAMETRIC_CURVE_SETTINGS.whiteLevel &&
    settings.blackLevel === DEFAULT_PARAMETRIC_CURVE_SETTINGS.blackLevel &&
    settings.split1 === DEFAULT_PARAMETRIC_CURVE_SETTINGS.split1 &&
    settings.split2 === DEFAULT_PARAMETRIC_CURVE_SETTINGS.split2 &&
    settings.split3 === DEFAULT_PARAMETRIC_CURVE_SETTINGS.split3
  );
}

function getSplitterGradient(channel: ActiveChannel) {
  switch (channel) {
    case ActiveChannel.Luma:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(64, 64, 64, 0.8) 25%, rgba(105, 101, 101, 0.8) 50%, rgba(158, 154, 154, 0.8) 75%, rgba(198, 195, 197, 0.8) 100%)';
    case ActiveChannel.Red:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(64, 0, 0, 0.8) 25%, rgba(105, 50, 50, 0.8) 50%, rgba(158, 100, 100, 0.8) 75%, rgba(255, 107, 107, 0.8) 100%)';
    case ActiveChannel.Green:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(0, 64, 0, 0.8) 25%, rgba(50, 105, 50, 0.8) 50%, rgba(100, 158, 100, 0.8) 75%, rgba(107, 203, 119, 0.8) 100%)';
    case ActiveChannel.Blue:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 64, 0.8) 25%, rgba(50, 50, 105, 0.8) 50%, rgba(100, 100, 158, 0.8) 75%, rgba(77, 150, 255, 0.8) 100%)';
    default:
      return 'linear-gradient(to right, rgba(0, 0, 0, 0.8) 0%, rgba(64, 64, 64, 0.8) 25%, rgba(105, 101, 101, 0.8) 50%, rgba(158, 154, 154, 0.8) 75%, rgba(198, 195, 197, 0.8) 100%)';
  }
}

function convertParametricToPoints(settings: ParametricCurveSettings): Array<Coord> {
  return buildParametricPoints(settings);
}

function hasTouches(event: PointerInputEvent): event is TouchEvent | ReactTouchEvent {
  return 'touches' in event;
}

function hasButton(event: PointerInputEvent): event is globalThis.MouseEvent | ReactMouseEvent {
  return 'button' in event;
}

function getEventPoint(event: PointerInputEvent): { clientX: number; clientY: number } | null {
  if (hasTouches(event) && event.touches.length > 0) {
    const touch = event.touches[0];
    if (!touch) return null;
    return { clientX: touch.clientX, clientY: touch.clientY };
  }

  if ('clientX' in event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    return { clientX: event.clientX, clientY: event.clientY };
  }

  return null;
}

interface CurveRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function clientPointToCurvePoint(clientX: number, clientY: number, rect: CurveRect): Coord {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.max(0, Math.min(255, ((clientX - rect.left) / rect.width) * 255)),
    y: Math.max(0, Math.min(255, 255 - ((clientY - rect.top) / rect.height) * 255)),
  };
}

export function constrainCurvePoint(points: Array<Coord>, index: number, nextPoint: Coord): Coord {
  const previousX = index > 0 ? (points[index - 1]?.x ?? 0) : 0;
  const followingX = index < points.length - 1 ? (points[index + 1]?.x ?? 255) : 255;
  const minX = index === 0 ? 0 : previousX + 0.01;
  const maxX = index === points.length - 1 ? 255 : followingX - 0.01;
  let x = Math.max(0, Math.min(255, nextPoint.x));

  if (x < 5) x = 0;
  if (x > 250) x = 255;

  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(0, Math.min(255, nextPoint.y)),
  };
}

export function constrainParametricSplit(
  settings: ParametricCurveSettings,
  key: 'split1' | 'split2' | 'split3',
  value: number,
): number {
  const nextValue = Math.max(0, Math.min(100, value));
  if (key === 'split1') return Math.max(10, Math.min(nextValue, settings.split2 - 10));
  if (key === 'split2') return Math.max(settings.split1 + 10, Math.min(nextValue, settings.split3 - 10));
  return Math.max(settings.split2 + 10, Math.min(nextValue, 90));
}

export default function CurveGraph({
  adjustments,
  setAdjustments,
  histogram,
  theme,
  onDragStateChange,
}: CurveGraphProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const [curveMode, setCurveMode] = useState<'point' | 'parametric'>(adjustments.curveMode || 'point');
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>(ActiveChannel.Luma);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const [draggingSplitKey, setDraggingSplitKey] = useState<'split1' | 'split2' | 'split3' | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [localPoints, setLocalPoints] = useState<Array<Coord> | null>(null);
  const [localParametricSettings, setLocalParametricSettings] = useState<ParametricCurveSettings | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const splitterContainerRef = useRef<HTMLDivElement>(null);
  const activeChannelRef = useRef(activeChannel);
  const draggingIndexRef = useRef<number | null>(null);
  const localPointsRef = useRef<Array<Coord> | null>(null);
  const localParametricSettingsRef = useRef<ParametricCurveSettings | null>(null);
  const pointDragStartRef = useRef<{ channel: ActiveChannel; points: Array<Coord> } | null>(null);
  const parametricDragStartRef = useRef<{
    channel: ActiveChannel;
    settings: ParametricCurveSettings;
  } | null>(null);
  const isParametricMode = curveMode === 'parametric';
  const curvesRef = useRef(adjustments.curves);

  const parametricCurves: Record<ActiveChannel, ParametricCurveSettings> =
    adjustments.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
  const parametricCurvesRef = useRef(parametricCurves);

  useEffect(() => {
    parametricCurvesRef.current = parametricCurves;
  }, [parametricCurves]);

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      setCurveMode(adjustments.curveMode || 'point');
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [adjustments.curveMode]);

  useEffect(() => {
    curvesRef.current = adjustments.curves;
  }, [adjustments.curves]);

  const activeParametricSettings =
    (draggingSplitKey ? localParametricSettings : null) ?? parametricCurves[activeChannel];

  const handleToggleMode = (newMode: 'point' | 'parametric') => {
    if (newMode === curveMode) return;
    setCurveMode(newMode);
    setSelectedPointIndex(null);

    setAdjustments((prev: Adjustments) => {
      if (newMode === 'parametric') {
        const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
        return {
          ...prev,
          curveMode: 'parametric',
          pointCurves: prev.curves,
          curves: {
            luma: buildParametricPoints(pC.luma),
            red: buildParametricPoints(pC.red),
            green: buildParametricPoints(pC.green),
            blue: buildParametricPoints(pC.blue),
          },
        };
      } else {
        const restoredPointCurves = prev.pointCurves || DEFAULT_POINT_CURVES;
        return {
          ...prev,
          curveMode: 'point',
          curves: restoredPointCurves,
        };
      }
    });
  };

  const updateParametricValue = useCallback(
    (key: keyof ParametricCurveSettings, value: number) => {
      setAdjustments((prev: Adjustments) => {
        const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
        const updatedSettings = { ...pC[activeChannel], [key]: value };
        const newPoints = buildParametricPoints(updatedSettings);

        return {
          ...prev,
          parametricCurve: {
            ...pC,
            [activeChannel]: updatedSettings,
          },
          curves: {
            ...prev.curves,
            [activeChannel]: newPoints,
          },
        };
      });
    },
    [activeChannel, setAdjustments],
  );

  useEffect(() => {
    activeChannelRef.current = activeChannel;
    const resetTimer = setTimeout(() => {
      setLocalPoints(null);
      setDraggingPointIndex(null);
      setLocalParametricSettings(null);
      setDraggingSplitKey(null);
      setSelectedPointIndex(null);
    }, 0);

    return () => {
      clearTimeout(resetTimer);
    };
  }, [activeChannel]);

  const activeCurve = adjustments.curves[activeChannel];

  useEffect(() => {
    if (draggingPointIndex === null) {
      localPointsRef.current = null;
      const resetTimer = setTimeout(() => {
        setLocalPoints(null);
      }, 0);

      return () => {
        clearTimeout(resetTimer);
      };
    }
    return undefined;
  }, [activeCurve, draggingPointIndex]);

  useEffect(() => {
    const isDragging = draggingPointIndex !== null || draggingSplitKey !== null;
    onDragStateChange?.(isDragging);
    draggingIndexRef.current = draggingPointIndex;
  }, [draggingPointIndex, draggingSplitKey, onDragStateChange]);

  useEffect(() => {
    const handleMove = (e: globalThis.MouseEvent | TouchEvent) => {
      if (isParametricMode && draggingSplitKey) {
        const container = splitterContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const eventPoint = getEventPoint(e);
        if (!eventPoint) return;
        const clientX = eventPoint.clientX;
        const rawX = ((clientX - rect.left) / rect.width) * 100;

        const currentSettings =
          localParametricSettingsRef.current || parametricCurvesRef.current[activeChannelRef.current];
        const nextValue = constrainParametricSplit(currentSettings, draggingSplitKey, rawX);

        const newSettings = { ...currentSettings, [draggingSplitKey]: nextValue };
        localParametricSettingsRef.current = newSettings;
        setLocalParametricSettings(newSettings);

        updateParametricValue(draggingSplitKey, nextValue);

        if (e.cancelable) e.preventDefault();
        return;
      }

      if (!isParametricMode && draggingIndexRef.current !== null) {
        const index = draggingIndexRef.current;
        const currentPoints = localPointsRef.current || curvesRef.current[activeChannelRef.current];
        if (index < 0 || index >= currentPoints.length) return;

        const svg = svgRef.current;
        if (!svg) return;

        const eventPoint = getEventPoint(e);
        if (!eventPoint) return;
        const { clientX, clientY } = eventPoint;

        const rect = svg.getBoundingClientRect();
        const nextPoint = clientPointToCurvePoint(clientX, clientY, rect);
        const newPoints = [...currentPoints];
        newPoints[index] = constrainCurvePoint(currentPoints, index, nextPoint);

        localPointsRef.current = newPoints;
        setLocalPoints(newPoints);

        setAdjustments((prev: Adjustments) => ({
          ...prev,
          curves: { ...prev.curves, [activeChannelRef.current]: newPoints },
        }));

        if (e.cancelable) e.preventDefault();
      }
    };

    const handleUp = () => {
      setDraggingPointIndex(null);
      setDraggingSplitKey(null);
      draggingIndexRef.current = null;
      localPointsRef.current = null;
      setLocalParametricSettings(null);
      localParametricSettingsRef.current = null;
      pointDragStartRef.current = null;
      parametricDragStartRef.current = null;
      onDragStateChange?.(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      const pointDragStart = pointDragStartRef.current;
      if (pointDragStart) {
        setSelectedPointIndex(null);
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          curves: { ...prev.curves, [pointDragStart.channel]: pointDragStart.points },
        }));
      }

      const parametricDragStart = parametricDragStartRef.current;
      if (parametricDragStart) {
        setAdjustments((prev: Adjustments) => {
          const parametricCurve = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
          return {
            ...prev,
            parametricCurve: {
              ...parametricCurve,
              [parametricDragStart.channel]: parametricDragStart.settings,
            },
            curves: {
              ...prev.curves,
              [parametricDragStart.channel]: buildParametricPoints(parametricDragStart.settings),
            },
          };
        });
      }

      handleUp();
    };

    if (draggingPointIndex !== null || draggingSplitKey !== null) {
      window.addEventListener('mousemove', handleMove, { passive: false });
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleUp);
      window.addEventListener('touchcancel', handleUp);
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
      window.removeEventListener('touchcancel', handleUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    draggingPointIndex,
    draggingSplitKey,
    isParametricMode,
    onDragStateChange,
    setAdjustments,
    updateParametricValue,
  ]);

  const isLightTheme = theme === Theme.Light || theme === Theme.Arctic;
  const histogramOpacity = isLightTheme ? 0.6 : 0.15;

  const channelConfig: ChannelConfig = useMemo(
    () => ({
      luma: { color: 'var(--color-accent)', data: histogram?.luma.data },
      red: { color: '#FF6B6B', data: histogram?.red.data },
      green: { color: '#6BCB77', data: histogram?.green.data },
      blue: { color: '#4D96FF', data: histogram?.blue.data },
    }),
    [histogram],
  );

  const activePoints = isParametricMode
    ? buildParametricPoints(activeParametricSettings)
    : (localPoints ?? adjustments.curves[activeChannel]);

  const { color, data: histogramData } = channelConfig[activeChannel];
  const activeChannelLabel = t(`adjustments.curves.channels.${activeChannel}`, {
    defaultValue: CURVE_CHANNEL_LABEL_FALLBACKS[activeChannel],
  });
  const activeModeLabel = t(isParametricMode ? 'adjustments.curves.parametricCurve' : 'adjustments.curves.pointCurve');
  const xAxisLabel = t('modals.transform.xAxis');
  const yAxisLabel = t('modals.transform.yAxis');
  const selectedPoint = selectedPointIndex === null ? null : (activePoints[selectedPointIndex] ?? null);

  const updatePoint = useCallback(
    (index: number, nextPoint: Coord) => {
      const currentPoints = localPointsRef.current || curvesRef.current[activeChannelRef.current];
      if (index < 0 || index >= currentPoints.length) return;
      const newPoints = [...currentPoints];
      newPoints[index] = constrainCurvePoint(currentPoints, index, nextPoint);
      localPointsRef.current = newPoints;
      setLocalPoints(newPoints);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        curves: { ...prev.curves, [activeChannelRef.current]: newPoints },
      }));
    },
    [setAdjustments],
  );

  const removePoint = useCallback(
    (index: number) => {
      const currentPoints = localPointsRef.current || curvesRef.current[activeChannelRef.current];
      if (index <= 0 || index >= currentPoints.length - 1) return;
      const newPoints = currentPoints.filter((_, pointIndex) => pointIndex !== index);
      localPointsRef.current = newPoints;
      setLocalPoints(newPoints);
      setSelectedPointIndex(Math.min(index, newPoints.length - 1));
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        curves: { ...prev.curves, [activeChannelRef.current]: newPoints },
      }));
    },
    [setAdjustments],
  );

  const handlePointStart = (
    e: ReactMouseEvent<SVGCircleElement> | ReactTouchEvent<SVGCircleElement>,
    index: number,
  ) => {
    if (isParametricMode || (hasButton(e) && e.button === 2)) return;
    if (!hasTouches(e)) e.preventDefault();
    e.stopPropagation();

    onDragStateChange?.(true);
    setLocalPoints(activePoints);
    localPointsRef.current = activePoints;
    pointDragStartRef.current = { channel: activeChannel, points: activePoints.map((point) => ({ ...point })) };
    setSelectedPointIndex(index);
    setDraggingPointIndex(index);
    draggingIndexRef.current = index;
  };

  const handlePointContextMenu = (e: ReactMouseEvent<SVGCircleElement>, index: number) => {
    if (isParametricMode) return;
    if (index <= 0 || index >= activePoints.length - 1) return;
    e.preventDefault();
    e.stopPropagation();
    removePoint(index);
  };

  const handlePointKeyDown = (event: ReactKeyboardEvent<SVGCircleElement>, index: number) => {
    setSelectedPointIndex(index);
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removePoint(index);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;

    event.preventDefault();
    const point = activePoints[index];
    if (!point) return;
    const step = event.shiftKey ? 10 : 1;
    const xDelta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const yDelta = event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0;
    updatePoint(index, { x: point.x + xDelta, y: point.y + yDelta });
  };

  const handleContainerStart = (e: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => {
    const target = e.target instanceof Element ? e.target : null;
    if (isParametricMode || (hasButton(e) && e.button !== 0) || target?.tagName.toLowerCase() === 'circle') return;
    onDragStateChange?.(true);

    const svg = svgRef.current;
    if (!svg) return;
    const eventPoint = getEventPoint(e);
    if (!eventPoint) return;
    const { clientX, clientY } = eventPoint;
    const rect = svg.getBoundingClientRect();
    const { x, y } = clientPointToCurvePoint(clientX, clientY, rect);

    const newPoints = [...activePoints, { x, y }].sort((a: Coord, b: Coord) => a.x - b.x);
    const newPointIndex = newPoints.findIndex((p: Coord) => p.x === x && p.y === y);

    setLocalPoints(newPoints);
    localPointsRef.current = newPoints;
    pointDragStartRef.current = {
      channel: activeChannel,
      points: activePoints.map((point) => ({ ...point })),
    };
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      curves: { ...prev.curves, [activeChannel]: newPoints },
    }));
    setDraggingPointIndex(newPointIndex);
    setSelectedPointIndex(newPointIndex);
    draggingIndexRef.current = newPointIndex;
  };

  const resetActiveCurve = () => {
    if (isParametricMode) {
      const defaultSettings = { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS };
      setAdjustments((prev: Adjustments) => {
        const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
        return {
          ...prev,
          parametricCurve: { ...pC, [activeChannel]: defaultSettings },
          curves: { ...prev.curves, [activeChannel]: buildParametricPoints(defaultSettings) },
        };
      });
    } else {
      const defaultPoints = [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ];
      setLocalPoints(defaultPoints);
      localPointsRef.current = defaultPoints;
      setSelectedPointIndex(null);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        curves: { ...prev.curves, [activeChannel]: defaultPoints },
      }));
    }
  };

  const handleSelectedPointInputBlur = (event: ReactFocusEvent<HTMLInputElement>, axis: 'x' | 'y') => {
    if (selectedPointIndex === null || !selectedPoint) return;
    const parsedValue = Number(event.currentTarget.value);
    if (!Number.isFinite(parsedValue)) {
      event.currentTarget.value = String(Math.round(selectedPoint[axis]));
      return;
    }
    if (parsedValue === Math.round(selectedPoint[axis])) return;
    updatePoint(selectedPointIndex, { ...selectedPoint, [axis]: parsedValue });
  };

  const handleSelectedPointInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, axis: 'x' | 'y') => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (selectedPoint) event.currentTarget.value = String(Math.round(selectedPoint[axis]));
      event.currentTarget.blur();
    }
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const channelLabel = t(`adjustments.curves.channels.${activeChannel}`, {
      defaultValue: CURVE_CHANNEL_LABEL_FALLBACKS[activeChannel],
    });

    if (isParametricMode) {
      const handleCopyParametric = () => {
        parametricClipboard = { ...activeParametricSettings };
      };

      const handlePasteParametric = () => {
        if (!parametricClipboard) return;
        const clipboard = parametricClipboard;
        setAdjustments((prev: Adjustments) => {
          const pC = prev.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
          return {
            ...prev,
            parametricCurve: { ...pC, [activeChannel]: { ...clipboard } },
            curves: { ...prev.curves, [activeChannel]: buildParametricPoints(clipboard) },
          };
        });
      };

      const handleResetAllParametric = () => {
        setLocalParametricSettings(null);
        localParametricSettingsRef.current = null;
        setAdjustments((prev: Adjustments) => {
          return {
            ...prev,
            parametricCurve: {
              luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
              red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
              green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
              blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
            },
            curves: {
              luma: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
              red: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
              green: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
              blue: buildParametricPoints(DEFAULT_PARAMETRIC_CURVE_SETTINGS),
            },
          };
        });
      };

      const areOtherParametricCurvesDirty = [
        ActiveChannel.Luma,
        ActiveChannel.Red,
        ActiveChannel.Green,
        ActiveChannel.Blue,
      ].some((channel) => channel !== activeChannel && !isDefaultParametricCurve(parametricCurves[channel]));

      const options = [
        {
          label: t('adjustments.curves.copyParametric', { channel: channelLabel }),
          icon: Copy,
          onClick: handleCopyParametric,
        },
        {
          label: t('adjustments.curves.pasteParametric'),
          icon: ClipboardPaste,
          onClick: handlePasteParametric,
          disabled: !parametricClipboard,
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('adjustments.curves.resetParametric', { channel: channelLabel }),
          icon: RotateCcw,
          onClick: resetActiveCurve,
        },
      ];

      if (areOtherParametricCurvesDirty) {
        options.push({
          label: t('adjustments.curves.resetAllParametric'),
          icon: RotateCcw,
          onClick: handleResetAllParametric,
        });
      }

      showContextMenu(e.clientX, e.clientY, options);
      return;
    }

    const handleCopy = () => {
      curveClipboard = activePoints.map((p) => ({ ...p }));
    };

    const handlePaste = () => {
      if (!curveClipboard) return;
      const newPoints = curveClipboard.map((p) => ({ ...p }));
      setLocalPoints(newPoints);
      localPointsRef.current = newPoints;
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        curves: { ...prev.curves, [activeChannel]: newPoints },
      }));
    };

    const handlePasteFromParametric = () => {
      if (!parametricClipboard) return;
      const newPoints = convertParametricToPoints(parametricClipboard);
      setLocalPoints(newPoints);
      localPointsRef.current = newPoints;
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        curves: { ...prev.curves, [activeChannel]: newPoints },
      }));
    };

    const handleResetAllPoint = () => {
      const defaultPoints = [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ];
      setLocalPoints(defaultPoints);
      localPointsRef.current = defaultPoints;
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        curves: {
          [ActiveChannel.Luma]: [...defaultPoints],
          [ActiveChannel.Red]: [...defaultPoints],
          [ActiveChannel.Green]: [...defaultPoints],
          [ActiveChannel.Blue]: [...defaultPoints],
        },
      }));
    };

    const areOtherPointCurvesDirty = [
      ActiveChannel.Luma,
      ActiveChannel.Red,
      ActiveChannel.Green,
      ActiveChannel.Blue,
    ].some((channel) => channel !== activeChannel && !isDefaultCurve(adjustments.curves[channel]));

    const options = [
      {
        label: t('adjustments.curves.copyPoint', { channel: channelLabel }),
        icon: Copy,
        onClick: handleCopy,
      },
      {
        label: t('adjustments.curves.pastePoint'),
        icon: ClipboardPaste,
        onClick: handlePaste,
        disabled: !curveClipboard,
      },
      {
        label: t('adjustments.curves.pasteFromParametric'),
        icon: ClipboardPaste,
        onClick: handlePasteFromParametric,
        disabled: !parametricClipboard,
      },
      { type: OPTION_SEPARATOR },
      {
        label: t('adjustments.curves.resetPoint', { channel: channelLabel }),
        icon: RotateCcw,
        onClick: resetActiveCurve,
      },
    ];

    if (areOtherPointCurvesDirty) {
      options.push({
        label: t('adjustments.curves.resetAllPoint'),
        icon: RotateCcw,
        onClick: handleResetAllPoint,
      });
    }

    showContextMenu(e.clientX, e.clientY, options);
  };

  const splitPositions = useMemo(
    () => [
      { key: 'split1' as const, value: activeParametricSettings.split1 },
      { key: 'split2' as const, value: activeParametricSettings.split2 },
      { key: 'split3' as const, value: activeParametricSettings.split3 },
    ],
    [activeParametricSettings.split1, activeParametricSettings.split2, activeParametricSettings.split3],
  );

  return (
    <div className="select-none touch-none pt-1" ref={containerRef} data-testid="curves-editor">
      <div className="mb-1.5 flex items-center gap-1">
        <div
          className="flex min-w-0 flex-1 items-center rounded bg-surface-secondary p-0.5"
          role="group"
          aria-label={`${t('adjustments.curves.pointCurve')} / ${t('adjustments.curves.parametricCurve')}`}
        >
          <button
            className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
              !isParametricMode
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => {
              handleToggleMode('point');
            }}
            aria-pressed={!isParametricMode}
            type="button"
          >
            <Spline aria-hidden="true" size={13} />
            <span className="truncate">{t('adjustments.curves.pointCurve')}</span>
          </button>
          <button
            className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
              isParametricMode
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => {
              handleToggleMode('parametric');
            }}
            aria-pressed={isParametricMode}
            type="button"
          >
            <Settings2 aria-hidden="true" size={13} />
            <span className="truncate">{t('adjustments.curves.parametricCurve')}</span>
          </button>
        </div>
        <button
          aria-label={t(isParametricMode ? 'adjustments.curves.resetParametric' : 'adjustments.curves.resetPoint', {
            channel: activeChannelLabel,
          })}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:opacity-40"
          data-tooltip={t(isParametricMode ? 'adjustments.curves.resetParametric' : 'adjustments.curves.resetPoint', {
            channel: activeChannelLabel,
          })}
          disabled={
            isParametricMode
              ? isDefaultParametricCurve(activeParametricSettings)
              : isDefaultCurve(adjustments.curves[activeChannel])
          }
          onClick={resetActiveCurve}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} />
        </button>
        <button
          aria-label={`${activeModeLabel} - ${t('settings.title')}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
          data-tooltip={`${activeModeLabel} - ${t('settings.title')}`}
          onClick={handleContextMenu}
          type="button"
        >
          <Settings2 aria-hidden="true" size={14} />
        </button>
      </div>

      <div
        className="mb-1.5 grid grid-cols-4 rounded border border-editor-divider bg-surface-secondary p-0.5"
        role="group"
        aria-label={t('adjustments.curves.channelTitle', { channel: activeChannelLabel })}
      >
        {CURVE_CHANNELS.map((channel) => {
          const selected = activeChannel === channel;
          const channelLabel = t(`adjustments.curves.channels.${channel}`, {
            defaultValue: CURVE_CHANNEL_LABEL_FALLBACKS[channel],
          });
          return (
            <button
              key={channel}
              aria-pressed={selected}
              className={`flex h-7 min-w-0 items-center justify-center gap-1 rounded px-1 text-[11px] font-semibold transition-colors ${
                selected ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
              onClick={() => {
                setActiveChannel(channel);
              }}
              type="button"
              title={t('adjustments.curves.channelTitle', { channel: channelLabel })}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full border border-black/20"
                style={{ backgroundColor: channelConfig[channel].color }}
              />
              <span className="truncate">{channelLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <div
          aria-label={`${activeChannelLabel} - ${activeModeLabel}`}
          className="relative aspect-square w-full touch-none overflow-hidden rounded border border-white/15 bg-[#15171a]"
          role="region"
          onMouseDown={handleContainerStart}
          onTouchStart={handleContainerStart}
          onDoubleClick={resetActiveCurve}
          onContextMenu={handleContextMenu}
        >
          {!histogramData && (
            <span className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/65">
              {t('adjustments.curves.curveDataUnavailable')}
            </span>
          )}
          <svg ref={svgRef} viewBox="0 0 255 255" className="h-full w-full overflow-hidden">
            <path
              d={
                isParametricMode
                  ? 'M 0,63.75 H 255 M 0,127.5 H 255 M 0,191.25 H 255'
                  : 'M 63.75,0 V 255 M 127.5,0 V 255 M 191.25,0 V 255 M 0,63.75 H 255 M 0,127.5 H 255 M 0,191.25 H 255'
              }
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="0.5"
            />
            <AnimatePresence>
              {histogramData && (
                <motion.path
                  key={activeChannel}
                  fill={color}
                  initial={{ d: getZeroHistogramPath(histogramData), opacity: 0 }}
                  animate={{
                    d: getHistogramPath(histogramData),
                    opacity: histogramOpacity,
                    transition: { d: { duration: 0.5, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 1 } },
                  }}
                  exit={{
                    d: getZeroHistogramPath(histogramData),
                    opacity: 0,
                    transition: { d: { duration: 0.3, ease: [0.55, 0, 0.78, 0.34] }, opacity: { duration: 1 } },
                  }}
                />
              )}
            </AnimatePresence>
            <line
              x1="0"
              y1="255"
              x2="255"
              y2="0"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />

            {isParametricMode &&
              splitPositions.map(({ key, value }) => {
                const x = (value / 100) * 255;
                return <line key={key} x1={x} y1="0" x2={x} y2="255" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />;
              })}

            <path d={getCurvePath(activePoints)} fill="none" stroke={color} strokeWidth="2.5" />

            {histogramData?.[0] ? <path d="M 0 0 L 10 0 L 0 10 Z" fill={color} opacity="0.9" /> : null}
            {histogramData?.[histogramData.length - 1] ? (
              <path d="M 255 0 L 245 0 L 255 10 Z" fill={color} opacity="0.9" />
            ) : null}

            {isParametricMode && activePoints.length >= 2 && (
              <>
                <circle
                  cx={activePoints[0]?.x || 0}
                  cy={255 - (activePoints[0]?.y || 0)}
                  fill={color}
                  r="6"
                  stroke="#1e1e1e"
                  strokeWidth="2"
                />
                <circle
                  cx={activePoints[activePoints.length - 1]?.x || 255}
                  cy={255 - (activePoints[activePoints.length - 1]?.y || 255)}
                  fill={color}
                  r="6"
                  stroke="#1e1e1e"
                  strokeWidth="2"
                />
              </>
            )}

            {!isParametricMode &&
              activePoints.map((p: Coord, i: number) => {
                const selected = selectedPointIndex === i;
                return (
                  <g key={`${String(i)}-${String(p.x)}`}>
                    <circle
                      aria-label={`${activeChannelLabel} ${String(i + 1)} - ${xAxisLabel} ${String(
                        Math.round(p.x),
                      )}, ${yAxisLabel} ${String(Math.round(p.y))}`}
                      className="cursor-grab outline-none focus-visible:stroke-white"
                      cx={p.x}
                      cy={255 - p.y}
                      fill="transparent"
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removePoint(i);
                      }}
                      onFocus={() => {
                        setSelectedPointIndex(i);
                      }}
                      onKeyDown={(event) => {
                        handlePointKeyDown(event, i);
                      }}
                      onMouseDown={(event) => {
                        handlePointStart(event, i);
                      }}
                      onTouchStart={(event) => {
                        handlePointStart(event, i);
                      }}
                      onContextMenu={(event) => {
                        handlePointContextMenu(event, i);
                      }}
                      r="11"
                      role="button"
                      stroke="transparent"
                      strokeWidth="1"
                      tabIndex={0}
                    />
                    <circle
                      cx={p.x}
                      cy={255 - p.y}
                      fill={selected ? '#ffffff' : color}
                      pointerEvents="none"
                      r={selected ? 5.5 : 4.5}
                      stroke={selected ? color : '#15171a'}
                      strokeWidth={selected ? 2.5 : 2}
                    />
                  </g>
                );
              })}
          </svg>
        </div>
      </div>

      {!isParametricMode && selectedPoint && selectedPointIndex !== null && (
        <div className="mt-1.5 flex items-center justify-end gap-2 text-[10px] text-text-secondary">
          {(['x', 'y'] as const).map((axis) => (
            <label className="flex items-center gap-1" key={axis}>
              <span>{axis === 'x' ? xAxisLabel : yAxisLabel}</span>
              <input
                aria-label={axis === 'x' ? xAxisLabel : yAxisLabel}
                className="h-6 w-12 rounded border border-editor-divider bg-surface px-1 text-right text-[11px] tabular-nums text-text-primary outline-none focus:border-accent"
                defaultValue={Math.round(selectedPoint[axis])}
                key={`${axis}-${String(selectedPoint[axis])}`}
                max={255}
                min={0}
                onBlur={(event) => {
                  handleSelectedPointInputBlur(event, axis);
                }}
                onKeyDown={(event) => {
                  handleSelectedPointInputKeyDown(event, axis);
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                step={1}
                type="number"
              />
            </label>
          ))}
        </div>
      )}

      <AnimatePresence initial={false}>
        {isParametricMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden origin-top"
          >
            <div className="flex flex-col gap-2 pb-1 pt-2" onContextMenu={handleContextMenu}>
              <div className="px-1">
                <div className="relative" ref={splitterContainerRef}>
                  <div className="relative h-6 overflow-hidden rounded-md bg-surface">
                    <div
                      className="absolute inset-0"
                      style={{
                        background: getSplitterGradient(activeChannel),
                      }}
                    />
                    {splitPositions.map(({ key, value }) => (
                      <button
                        key={key}
                        aria-label={`${t('adjustments.curves.parametricCurve')} ${String(
                          Number(key.slice(-1)),
                        )}: ${String(Math.round(value))}%`}
                        className="group absolute top-0 bottom-0 w-3 -translate-x-1/2 cursor-ew-resize"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          localParametricSettingsRef.current = { ...activeParametricSettings };
                          parametricDragStartRef.current = {
                            channel: activeChannel,
                            settings: { ...activeParametricSettings },
                          };
                          setDraggingSplitKey(key);
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          localParametricSettingsRef.current = { ...activeParametricSettings };
                          parametricDragStartRef.current = {
                            channel: activeChannel,
                            settings: { ...activeParametricSettings },
                          };
                          setDraggingSplitKey(key);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                          event.preventDefault();
                          const step = event.shiftKey ? 10 : 1;
                          const direction = event.key === 'ArrowLeft' ? -1 : 1;
                          updateParametricValue(
                            key,
                            constrainParametricSplit(activeParametricSettings, key, value + direction * step),
                          );
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          updateParametricValue(key, DEFAULT_PARAMETRIC_CURVE_SETTINGS[key]);
                        }}
                        style={{ left: formatPercent(value) }}
                        type="button"
                      >
                        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/70 group-hover:bg-white" />
                        <div className="absolute left-1/2 top-1/2 h-3.5 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white/60 bg-white/80 group-hover:border-white group-hover:bg-white" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.curves.params.whiteLevel')}
                  min={-100}
                  max={0}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.whiteLevel}
                  onValueChange={(value) => {
                    updateParametricValue('whiteLevel', value);
                  }}
                  onDragStateChange={onDragStateChange}
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.curves.params.highlights')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.highlights}
                  onValueChange={(value) => {
                    updateParametricValue('highlights', value);
                  }}
                  onDragStateChange={onDragStateChange}
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.curves.params.lights')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.lights}
                  onValueChange={(value) => {
                    updateParametricValue('lights', value);
                  }}
                  onDragStateChange={onDragStateChange}
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.curves.params.darks')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.darks}
                  onValueChange={(value) => {
                    updateParametricValue('darks', value);
                  }}
                  onDragStateChange={onDragStateChange}
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.curves.params.shadows')}
                  min={-100}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.shadows}
                  onValueChange={(value) => {
                    updateParametricValue('shadows', value);
                  }}
                  onDragStateChange={onDragStateChange}
                />
                <AdjustmentSlider
                  density="compact"
                  label={t('adjustments.curves.params.blackLevel')}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={0}
                  value={activeParametricSettings.blackLevel}
                  onValueChange={(value) => {
                    updateParametricValue('blackLevel', value);
                  }}
                  onDragStateChange={onDragStateChange}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
