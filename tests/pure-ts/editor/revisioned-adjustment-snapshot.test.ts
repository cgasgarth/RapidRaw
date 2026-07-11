import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { prepareAdjustmentPayloadForBackend } from '../../../src/schemas/adjustmentPayloadSchemas.ts';
import { PatchResidencyTracker, publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { PreparedAdjustmentPayloadCache } from '../../../src/utils/preparedAdjustmentPayloadCache.ts';

const adjustments = () => structuredClone(INITIAL_ADJUSTMENTS);

test('published adjustment snapshots are immutable and preserve prior revisions', () => {
  const firstValue = adjustments();
  const first = publishAdjustmentSnapshot(null, firstValue);
  const second = publishAdjustmentSnapshot(first, { ...firstValue, exposure: firstValue.exposure + 1 });

  expect(first.value.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
  expect(second.adjustmentRevision).toBe(first.adjustmentRevision + 1);
  expect(second.geometryRevision).toBe(first.geometryRevision);
  expect(Object.isFrozen(first.value)).toBe(true);
  expect(() => ((first.value as { exposure: number }).exposure = 99)).toThrow();
});

test('queued scheduler values retain their exact snapshot reference after a later edit', async () => {
  const first = publishAdjustmentSnapshot(null, adjustments());
  const second = publishAdjustmentSnapshot(first, { ...first.value, exposure: 2 });
  const queued = { snapshot: first };
  await Promise.resolve();

  expect(queued.snapshot).toBe(first);
  expect(queued.snapshot.value.exposure).not.toBe(second.value.exposure);
});

test('payload preparation accepts frozen input without mutation', () => {
  const value = adjustments();
  value.aiPatches = [
    { id: 'patch-1', isLoading: false, patchData: { pixels: 'large' }, subMasks: [] },
  ] as typeof value.aiPatches;
  const snapshot = publishAdjustmentSnapshot(null, value);
  const prepared = prepareAdjustmentPayloadForBackend(snapshot.value, new Set(['patch-1']));

  expect(prepared.payload.aiPatches?.[0]?.patchData).toBeNull();
  expect(snapshot.value.aiPatches[0]?.patchData).toEqual({ pixels: 'large' });
});

test('prepared payload cache is revision-keyed, ROI-independent, bounded, and session-safe', () => {
  const tracker = new PatchResidencyTracker(7);
  const cache = new PreparedAdjustmentPayloadCache(2);
  const first = publishAdjustmentSnapshot(null, adjustments());

  expect(cache.prepare(first, tracker.snapshot())).toBe(cache.prepare(first, tracker.snapshot()));
  expect(cache.metrics).toMatchObject({ hits: 1, misses: 1 });
  tracker.markResident(7, ['patch-1']);
  cache.prepare(first, tracker.snapshot());
  const second = publishAdjustmentSnapshot(first, { ...first.value, exposure: 1 });
  cache.prepare(second, tracker.snapshot());
  expect(cache.size).toBe(2);
  tracker.reset(8);
  expect(tracker.markResident(7, ['stale'])).toBe(false);
  expect(tracker.snapshot().residentIds.has('stale')).toBe(false);
});

test('preview dispatch contains no defensive clone or whole-object identity serialization', () => {
  const source = readFileSync(new URL('../../../src/hooks/editor/useImageProcessing.ts', import.meta.url), 'utf8');
  const schedulingPath = source.slice(
    source.indexOf('const executeApplyAdjustments'),
    source.indexOf('const generateUncroppedPreview'),
  );
  expect(schedulingPath).not.toContain('structuredClone');
  expect(schedulingPath).not.toContain('JSON.stringify');
});
