import { describe, expect, test } from 'bun:test';

import { createFocusRetouchCommandService } from '../../../src/components/panel/editor/focusRetouchCommandService';

const request = {
  expectedRevisionId: 'revision-1',
  packagePath: '/private/focus.stack',
  stroke: {
    hardnessU16: 32768,
    pointsFixed1256Px: [{ x: 120, y: 240 }],
    radiusFixed1256Px: 768,
    sourceIndex: 2,
    strokeId: 'stroke-1',
  },
};

describe('focus retouch command service', () => {
  test('validates native sessions before returning them to the view', async () => {
    const service = createFocusRetouchCommandService(async (received) => ({
      packagePath: received.packagePath,
      revision: {
        affectedBounds: [{ height: 1, width: 1, x: 0, y: 0 }],
        baseFocusArtifactHash: 'base',
        blendPolicyHash: 'blend',
        changedSourceIndices: [2],
        changedTileIndexHash: 'tiles',
        contentHash: 'content',
        orderedSourceHashes: ['source-a', 'source-b'],
        overrideMapHash: 'overrides',
        parentRevisionId: 'revision-1',
        revisionId: 'revision-2',
        schemaVersion: 1,
        skippedPixelCount: 0,
      },
      sourceStatuses: ['current'],
      canUndo: true,
      canRedo: false,
      renderStatus: 'saved',
    }));
    await expect(service.applyStroke(request)).resolves.toMatchObject({ revision: { revisionId: 'revision-2' } });
  });

  test('rejects malformed native responses at the command boundary', async () => {
    const service = createFocusRetouchCommandService(async () => ({ invalid: true }));
    await expect(service.applyStroke(request)).rejects.toThrow();
  });
});
