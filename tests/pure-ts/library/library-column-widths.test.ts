import { describe, expect, test } from 'bun:test';
import {
  CORE_LIBRARY_COLUMN_KEYS,
  LIBRARY_COLUMN_KEYS,
  normalizedColumnPercentages,
  resizeAdjacentColumns,
} from '../../../src/components/panel/library/libraryColumnWidths';
import type { ColumnWidths } from '../../../src/components/panel/MainLibrary';

const widths: ColumnWidths = {
  thumbnail: 4,
  name: 20,
  date: 15,
  rating: 8,
  color: 8,
  shutter: 10,
  aperture: 10,
  iso: 10,
  focal: 15,
};

const constraints = { minPercentByColumn: { thumbnail: 1, name: 1 }, visibleColumns: LIBRARY_COLUMN_KEYS };

describe('library column width math', () => {
  test('preserves the pair total and unrelated columns', () => {
    const resized = resizeAdjacentColumns(widths, 'thumbnail', 'name', 7.25, constraints);
    expect(resized.thumbnail + resized.name).toBe(24);
    expect(resized.thumbnail).toBe(11.25);
    expect(resized.date).toBe(widths.date);
  });

  test('enforces both minima for extreme deltas', () => {
    const leftBound = resizeAdjacentColumns(widths, 'thumbnail', 'name', -Infinity, constraints);
    const rightBound = resizeAdjacentColumns(widths, 'thumbnail', 'name', Number.MAX_VALUE, constraints);
    expect(leftBound.thumbnail).toBe(4);
    expect(rightBound.thumbnail).toBe(23);
    expect(rightBound.name).toBe(1);
    expect(Object.values(rightBound).every(Number.isFinite)).toBe(true);
  });

  test('ignores hidden columns and excludes them from normalization', () => {
    expect(
      resizeAdjacentColumns(widths, 'color', 'shutter', 5, {
        ...constraints,
        visibleColumns: CORE_LIBRARY_COLUMN_KEYS,
      }),
    ).toEqual(widths);
    const percentages = normalizedColumnPercentages(widths, CORE_LIBRARY_COLUMN_KEYS);
    expect(percentages.shutter).toBe(0);
    expect(CORE_LIBRARY_COLUMN_KEYS.reduce((sum, key) => sum + percentages[key], 0)).toBeCloseTo(100, 10);
  });

  test('is stable across repeated resize and reverse operations', () => {
    let current = widths;
    for (let index = 0; index < 1_000; index++) {
      current = resizeAdjacentColumns(current, 'name', 'date', 0.01, {
        ...constraints,
        minPercentByColumn: { name: 1, date: 1 },
      });
      current = resizeAdjacentColumns(current, 'name', 'date', -0.01, {
        ...constraints,
        minPercentByColumn: { name: 1, date: 1 },
      });
    }
    expect(current.name).toBeCloseTo(widths.name, 10);
    expect(current.date).toBeCloseTo(widths.date, 10);
  });

  test('sanitizes non-finite widths and zero-total normalization', () => {
    const malformed = { ...widths, thumbnail: Number.NaN, name: Infinity };
    const resized = resizeAdjacentColumns(malformed, 'thumbnail', 'name', 10, constraints);
    expect(Object.values(resized).every(Number.isFinite)).toBe(true);
    expect(
      Object.values(
        normalizedColumnPercentages(
          { ...widths, thumbnail: 0, name: 0, date: 0, rating: 0, color: 0 },
          CORE_LIBRARY_COLUMN_KEYS,
        ),
      ).every(Number.isFinite),
    ).toBe(true);
  });
});
