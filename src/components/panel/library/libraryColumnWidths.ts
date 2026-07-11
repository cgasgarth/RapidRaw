import type { CSSProperties } from 'react';
import type { ColumnWidths } from '../MainLibrary';

export type ColumnWidthKey = keyof ColumnWidths;

export interface ColumnResizeConstraints {
  minPercentByColumn: Partial<Record<ColumnWidthKey, number>>;
  visibleColumns: readonly ColumnWidthKey[];
}

export const LIBRARY_COLUMN_KEYS: readonly ColumnWidthKey[] = [
  'thumbnail',
  'name',
  'date',
  'rating',
  'color',
  'shutter',
  'aperture',
  'iso',
  'focal',
];

export const CORE_LIBRARY_COLUMN_KEYS = LIBRARY_COLUMN_KEYS.slice(0, 5);
export const LIBRARY_COLUMN_RESIZE_EPSILON = 0.001;

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

const finiteWidths = (widths: ColumnWidths): ColumnWidths => ({
  thumbnail: Math.max(0, finiteOr(widths.thumbnail, 0)),
  name: Math.max(0, finiteOr(widths.name, 0)),
  date: Math.max(0, finiteOr(widths.date, 0)),
  rating: Math.max(0, finiteOr(widths.rating, 0)),
  color: Math.max(0, finiteOr(widths.color, 0)),
  shutter: Math.max(0, finiteOr(widths.shutter, 0)),
  aperture: Math.max(0, finiteOr(widths.aperture, 0)),
  iso: Math.max(0, finiteOr(widths.iso, 0)),
  focal: Math.max(0, finiteOr(widths.focal, 0)),
});

export function resizeAdjacentColumns(
  initial: ColumnWidths,
  left: ColumnWidthKey,
  right: ColumnWidthKey,
  deltaPercent: number,
  constraints: ColumnResizeConstraints,
): ColumnWidths {
  const safeInitial = finiteWidths(initial);
  if (!constraints.visibleColumns.includes(left) || !constraints.visibleColumns.includes(right)) return safeInitial;

  const initialLeft = safeInitial[left];
  const initialRight = safeInitial[right];
  const pairTotal = initialLeft + initialRight;
  const leftMin = Math.max(0, finiteOr(constraints.minPercentByColumn[left] ?? 1, 1));
  const rightMin = Math.max(0, finiteOr(constraints.minPercentByColumn[right] ?? 1, 1));
  const effectiveLeftMin = Math.min(leftMin, pairTotal);
  const effectiveRightMin = Math.min(rightMin, Math.max(0, pairTotal - effectiveLeftMin));
  const safeDelta = finiteOr(deltaPercent, 0);
  const nextLeft = Math.min(pairTotal - effectiveRightMin, Math.max(effectiveLeftMin, initialLeft + safeDelta));
  const nextRight = pairTotal - nextLeft;

  return { ...safeInitial, [left]: nextLeft, [right]: nextRight };
}

export const columnWidthVariable = (key: ColumnWidthKey) => `--library-col-${key}`;

export function normalizedColumnPercentages(
  widths: ColumnWidths,
  visibleColumns: readonly ColumnWidthKey[],
): Record<ColumnWidthKey, number> {
  const visible = new Set(visibleColumns);
  const total = visibleColumns.reduce((sum, key) => sum + Math.max(0, finiteOr(widths[key], 0)), 0);
  const denominator = total > 0 ? total : 1;
  return Object.fromEntries(
    LIBRARY_COLUMN_KEYS.map((key) => [
      key,
      visible.has(key) ? (Math.max(0, finiteOr(widths[key], 0)) / denominator) * 100 : 0,
    ]),
  ) as Record<ColumnWidthKey, number>;
}

export function applyColumnWidthVariables(
  element: HTMLElement,
  widths: ColumnWidths,
  visibleColumns: readonly ColumnWidthKey[],
): void {
  const percentages = normalizedColumnPercentages(widths, visibleColumns);
  for (const key of LIBRARY_COLUMN_KEYS) element.style.setProperty(columnWidthVariable(key), `${percentages[key]}%`);
}

export function columnWidthStyle(key: ColumnWidthKey): CSSProperties {
  return { width: `var(${columnWidthVariable(key)}, 0%)` };
}

export function columnWidthsEqual(left: ColumnWidths, right: ColumnWidths, epsilon = LIBRARY_COLUMN_RESIZE_EPSILON) {
  return LIBRARY_COLUMN_KEYS.every((key) => Math.abs(left[key] - right[key]) <= epsilon);
}
