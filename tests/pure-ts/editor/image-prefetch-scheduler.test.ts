import { describe, expect, test } from 'bun:test';
import { ImagePrefetchScheduler } from '../../../src/utils/imagePrefetchScheduler';

describe('directional image prefetch scheduler', () => {
  test('prioritizes forward neighbors then one item behind', () => {
    const scheduler = new ImagePrefetchScheduler();
    expect(
      scheduler.schedule({
        currentPath: 'b',
        memoryPressure: false,
        now: 1_000,
        orderedPaths: ['a', 'b', 'c', 'd'],
        workloadBusy: false,
      }).candidates,
    ).toEqual(['c', 'd', 'a']);
  });

  test('reverse navigation immediately reprioritizes the previous direction', () => {
    const scheduler = new ImagePrefetchScheduler();
    const paths = ['a', 'b', 'c', 'd'];
    scheduler.schedule({
      currentPath: 'c',
      memoryPressure: false,
      now: 1_000,
      orderedPaths: paths,
      workloadBusy: false,
    });
    expect(
      scheduler.schedule({
        currentPath: 'b',
        memoryPressure: false,
        now: 1_050,
        orderedPaths: paths,
        workloadBusy: false,
      }).candidates,
    ).toEqual(['a']);
  });

  test('memory pressure and workload contention shrink lookahead', () => {
    const scheduler = new ImagePrefetchScheduler();
    expect(
      scheduler.schedule({
        currentPath: 'b',
        memoryPressure: true,
        now: 1_000,
        orderedPaths: ['a', 'b', 'c', 'd'],
        workloadBusy: true,
      }).candidates,
    ).toEqual(['c']);
  });

  test('collection replacement advances generation and drops old direction state', () => {
    const scheduler = new ImagePrefetchScheduler();
    const first = scheduler.schedule({
      currentPath: 'b',
      memoryPressure: false,
      now: 1_000,
      orderedPaths: ['a', 'b', 'c'],
      workloadBusy: false,
    });
    const second = scheduler.schedule({
      currentPath: 'y',
      memoryPressure: false,
      now: 1_100,
      orderedPaths: ['x', 'y', 'z'],
      workloadBusy: false,
    });
    expect(second.collectionGeneration).toBeGreaterThan(first.collectionGeneration);
    expect(second.candidates).toEqual(['z', 'x']);
  });

  test('deterministic 100-image benchmark removes sequential decode stalls after warmup', () => {
    const paths = Array.from({ length: 100 }, (_, index) => `image-${index}`);
    const scheduler = new ImagePrefetchScheduler();
    const warmed = new Set<string>();
    const stagedStalls: number[] = [];
    const serialStalls: number[] = [];

    for (let index = 0; index < paths.length; index += 1) {
      stagedStalls.push(warmed.has(paths[index]) ? 0 : 80);
      serialStalls.push(80);
      const request = scheduler.schedule({
        currentPath: paths[index],
        memoryPressure: false,
        now: index * 500,
        orderedPaths: paths,
        workloadBusy: false,
      });
      request.candidates.forEach((path) => warmed.add(path));
    }

    const percentile95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    expect(percentile95(stagedStalls)).toBe(0);
    expect(percentile95(serialStalls)).toBe(80);
    expect(stagedStalls.reduce((sum, value) => sum + value, 0)).toBeLessThan(
      serialStalls.reduce((sum, value) => sum + value, 0) / 10,
    );
  });
});
