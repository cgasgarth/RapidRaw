import { describe, expect, test } from 'bun:test';
import { PresentedPreviewReleaseCoordinator } from '../../../src/utils/presentedPreviewReleaseCoordinator';

describe('presented preview release coordinator', () => {
  test('retains the old URL through delayed successor load and releases it exactly once on acknowledgement', () => {
    const coordinator = new PresentedPreviewReleaseCoordinator();
    const released: string[] = [];
    const release = (url: string) => released.push(url);

    coordinator.defer('blob:presented-old', 'base', 'blob:successor-delayed');
    expect(coordinator.pendingCount()).toBe(1);
    expect(released).toEqual([]);
    expect(coordinator.acknowledge('base', 'blob:unrelated', release)).toEqual([]);
    expect(released).toEqual([]);

    expect(coordinator.acknowledge('base', 'blob:successor-delayed', release)).toEqual(['blob:presented-old']);
    expect(coordinator.pendingCount()).toBe(0);
    expect(coordinator.acknowledge('base', 'blob:successor-delayed', release)).toEqual([]);
    expect(released).toEqual(['blob:presented-old']);
  });

  test('rebinds a delayed replacement chain and drains outstanding ownership on surface cancellation', () => {
    const coordinator = new PresentedPreviewReleaseCoordinator();
    const released: string[] = [];
    const release = (url: string) => released.push(url);

    coordinator.defer('blob:presented-old', 'base', 'blob:failed-successor');
    coordinator.defer('blob:failed-successor', 'base', 'blob:terminal-successor');
    expect(coordinator.acknowledge('base', 'blob:failed-successor', release)).toEqual([]);
    expect(coordinator.acknowledge('base', 'blob:terminal-successor', release)).toEqual([
      'blob:presented-old',
      'blob:failed-successor',
    ]);
    coordinator.defer('blob:cancelled-old', 'base', 'blob:never-loaded');
    expect(coordinator.cancel(release)).toEqual(['blob:cancelled-old']);
    expect(coordinator.cancel(release)).toEqual([]);
    expect(released).toEqual(['blob:presented-old', 'blob:failed-successor', 'blob:cancelled-old']);
  });

  test('A to B to exact A reuse keeps current A alive and channels cannot release each other', () => {
    const coordinator = new PresentedPreviewReleaseCoordinator();
    const released: string[] = [];
    const release = (url: string) => released.push(url);

    coordinator.defer('blob:A', 'base', 'blob:B');
    coordinator.defer('blob:B', 'base', 'blob:A');
    coordinator.defer('blob:original-A', 'original', 'blob:A');
    expect(coordinator.acknowledge('base', 'blob:A', release)).toEqual(['blob:B']);
    expect(released).toEqual(['blob:B']);
    expect(coordinator.pendingCount()).toBe(1);
    expect(coordinator.acknowledge('original', 'blob:A', release)).toEqual(['blob:original-A']);
    expect(released).toEqual(['blob:B', 'blob:original-A']);
    expect(released).not.toContain('blob:A');
  });
});
