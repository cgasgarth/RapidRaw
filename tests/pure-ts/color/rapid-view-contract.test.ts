import { expect, test } from 'bun:test';

import { rawOpenEditExportProofRequestSchema } from '../../../src/schemas/rawOpenEditExportCommandSchemas.ts';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments.ts';

test('Rapid View request identity is replayable and rejects mixed process versions', async () => {
  const fixture = await Bun.file(
    'fixtures/validation/raw-open-edit-export/raw-open-edit-export-proof-request.json',
  ).json();
  fixture.editCommand.colorPipeline.sceneToDisplayTransform = 'rawengine_rapid_view_v1';
  fixture.editCommand.colorPipeline.renderTarget.viewTransform = 'rawengine_rapid_view_v1';
  expect(rawOpenEditExportProofRequestSchema.safeParse(fixture).success).toBe(true);

  fixture.editCommand.colorPipeline.renderTarget.viewTransform = 'rawengine_basic_v1';
  expect(rawOpenEditExportProofRequestSchema.safeParse(fixture).success).toBe(false);
});

test('new recipes use Rapid View while legacy sidecars retain their process', () => {
  expect(INITIAL_ADJUSTMENTS.toneMapper).toBe('rapidView');
  expect(normalizeLoadedAdjustments({}).toneMapper).toBe('basic');
  expect(normalizeLoadedAdjustments({ toneMapper: 'agx' }).toneMapper).toBe('agx');

  const reopened = normalizeLoadedAdjustments({
    toneMapper: 'rapidView',
    viewTransform: { ...INITIAL_ADJUSTMENTS.viewTransform, contrast: 1.31 },
  });
  expect(reopened.viewTransform.contrast).toBe(1.31);
});
