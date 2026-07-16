import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { PatchResidencyTracker, publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';
import {
  PreparedAdjustmentPayloadCache,
  prepareEditDocumentPayloadForBackend,
} from '../../../src/utils/preparedAdjustmentPayloadCache.ts';

const document = () => createDefaultEditDocumentV2();

test('published current-document snapshots are immutable and preserve prior values', () => {
  const first = publishAdjustmentSnapshot(null, document());
  const secondDocument = patchEditDocumentV2Node(first.editDocumentV2, 'scene_global_color_tone', { exposure: 1 });
  const second = publishAdjustmentSnapshot(first, secondDocument);
  const geometryDocument = patchEditDocumentV2Node(second.editDocumentV2, 'geometry', { aspectRatio: 4 / 3 });
  const geometry = publishAdjustmentSnapshot(second, geometryDocument);

  expect(first.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0);
  expect(second.geometryRevision).toBe(first.geometryRevision);
  expect(geometry.geometryRevision).toBe(second.geometryRevision + 1);
  expect(Object.isFrozen(first.editDocumentV2)).toBeTrue();
  expect(() => {
    first.editDocumentV2.geometry.rotation = 12;
  }).toThrow();
});

test('queued scheduler values retain their exact snapshot reference after a later edit', async () => {
  const first = publishAdjustmentSnapshot(null, document());
  const second = publishAdjustmentSnapshot(
    first,
    patchEditDocumentV2Node(first.editDocumentV2, 'scene_global_color_tone', { exposure: 2 }),
  );
  const queued = { snapshot: first };
  await Promise.resolve();

  expect(queued.snapshot).toBe(first);
  expect(queued.snapshot.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).not.toBe(
    second.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure'],
  );
});

test('backend payload preparation preserves source authority while honoring patch residency', () => {
  const sourcePatch = {
    id: 'patch-1',
    invert: false,
    isLoading: false,
    name: 'Repair',
    patchData: { pixels: 'large' },
    prompt: 'remove object',
    subMasks: [],
    visible: true,
  };
  const current = patchEditDocumentV2Node(document(), 'source_artifacts', { aiPatches: [sourcePatch] });
  const prepared = prepareEditDocumentPayloadForBackend(current, new Set(['patch-1']));

  expect(current.sourceArtifacts.aiPatches[0]?.patchData).toEqual({ pixels: 'large' });
  expect(prepared.payload.sourceArtifacts.aiPatches[0]?.patchData).toBeNull();
  expect(prepared.payload.nodes['source_artifacts']!.params).toEqual(prepared.payload.sourceArtifacts);
});

test('prepared payload cache is revision-keyed, bounded, and session-safe', () => {
  const tracker = new PatchResidencyTracker(7);
  const cache = new PreparedAdjustmentPayloadCache(2);
  const first = publishAdjustmentSnapshot(null, document());

  expect(cache.prepare(first, tracker.snapshot())).toBe(cache.prepare(first, tracker.snapshot()));
  expect(cache.metrics).toMatchObject({ hits: 1, misses: 1 });
  tracker.markResident(7, ['patch-1']);
  cache.prepare(first, tracker.snapshot());
  const second = publishAdjustmentSnapshot(
    first,
    patchEditDocumentV2Node(first.editDocumentV2, 'scene_global_color_tone', { exposure: 1 }),
  );
  cache.prepare(second, tracker.snapshot());
  expect(cache.size).toBe(2);
  tracker.reset(8);
  expect(tracker.markResident(7, ['stale'])).toBeFalse();
});

test('preview dispatch contains no defensive clone or whole-document identity serialization', () => {
  const source = readFileSync(new URL('../../../src/hooks/editor/useImageProcessing.ts', import.meta.url), 'utf8');
  const schedulingPath = source.slice(
    source.indexOf('const captureSchedulingSnapshot'),
    source.indexOf('const originalScope'),
  );
  expect(schedulingPath).not.toContain('structuredClone');
  expect(schedulingPath).not.toContain('JSON.stringify');
});
