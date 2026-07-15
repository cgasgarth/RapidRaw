import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { exportRecipeV1Schema } from '../../../packages/rawengine-schema/src/exportRecipeSchemas.ts';
import {
  buildCurrentExportRecipe,
  type ExportRecipe,
  type ExportRecipeSettings,
  exportRecipeSchema,
  findCurrentExportRecipe,
  withoutExportRecipeId,
} from '../../../src/schemas/export/exportRecipeSchemas.ts';
import { buildExportRecipeUiRows } from '../../../src/schemas/export/exportRecipeUiSchemas.ts';

const settings: ExportRecipeSettings = {
  blackPointCompensation: false,
  colorProfile: 'srgb',
  dontEnlarge: true,
  enableResize: true,
  enableWatermark: false,
  exportMasks: false,
  fileFormat: 'jpeg',
  filenameTemplate: '{original_filename}_current',
  jpegQuality: 93,
  keepMetadata: true,
  outputSharpening: null,
  preserveFolders: true,
  preserveTimestamps: true,
  renderingIntent: 'relativeColorimetric',
  resizeMode: 'longEdge',
  resizeValue: 3200,
  stripGps: true,
  watermarkAnchor: 'bottomRight',
  watermarkOpacity: 75,
  watermarkPath: null,
  watermarkScale: 10,
  watermarkSpacing: 5,
};

const currentRecipe: ExportRecipe = buildCurrentExportRecipe({
  id: 'current-custom',
  lastExportPath: '/tmp/current-export',
  name: 'Current custom',
  settings,
});

const requiredFields = Object.keys(currentRecipe).filter((field) => field !== 'lastExportPath');

test('current export schemas reject every missing current field', () => {
  for (const field of requiredFields) {
    const incomplete: Record<string, unknown> = structuredClone(currentRecipe);
    delete incomplete[field];

    expect(exportRecipeSchema.safeParse(incomplete).success).toBe(false);
    expect(exportRecipeV1Schema.safeParse(incomplete).success).toBe(false);
    expect(incomplete[field]).toBeUndefined();
  }
});

test('application and shared current schemas enforce the same sharpening contract', () => {
  for (const outputSharpening of [
    { amount: 50, radiusPx: 0.2, target: 'screen', threshold: 0.1 },
    { amount: 50, radiusPx: 0.5, target: 'print', threshold: 0.1 },
    { amount: 0, radiusPx: 1, target: 'screen', threshold: 0.1 },
  ]) {
    const candidate = { ...currentRecipe, outputSharpening };
    expect(exportRecipeSchema.safeParse(candidate).success).toBe(false);
    expect(exportRecipeV1Schema.safeParse(candidate).success).toBe(false);
  }
});

test('current constructors emit complete deterministic custom, duplicate, last-used, and resolver records', () => {
  for (const identity of [
    { id: 'created', name: 'Created' },
    { id: 'duplicated', name: 'Duplicated' },
    { id: '__last_used__', lastExportPath: '/tmp/exported', name: '__last_used__' },
    { id: 'internal-soft-proof-export-resolver', name: 'Proof resolver' },
  ]) {
    const recipe = buildCurrentExportRecipe({ ...identity, settings });
    expect(exportRecipeSchema.parse(recipe)).toEqual(recipe);
    expect(exportRecipeV1Schema.parse(recipe)).toEqual(recipe);
    expect(Object.keys(recipe).sort()).toEqual(
      [...requiredFields, ...(identity.lastExportPath === undefined ? [] : ['lastExportPath'])].sort(),
    );
  }

  for (const fileFormat of ['avif', 'cube', 'jxl', 'png', 'tiff', 'webp'] as const) {
    const nonJpeg = buildCurrentExportRecipe({
      id: `${fileFormat}-current`,
      name: `${fileFormat} current`,
      settings: { ...settings, fileFormat },
    });
    expect(nonJpeg.jpegQuality).toBe(100);
    expect(exportRecipeV1Schema.safeParse(nonJpeg).success).toBe(true);
  }
});

test('invalid persisted rows remain invalid and unchanged until explicit replacement', () => {
  const incomplete = {
    fileFormat: 'jpeg',
    id: 'incomplete-current-recipe',
    name: 'Needs review',
  };
  const original = structuredClone(incomplete);

  expect(findCurrentExportRecipe([incomplete], incomplete.id)).toBeNull();
  expect(buildExportRecipeUiRows([incomplete])).toEqual([
    expect.objectContaining({
      id: incomplete.id,
      isValidRecipe: false,
      settings: original,
      subtitle: 'Custom recipe needs review',
    }),
  ]);
  expect(incomplete).toEqual(original);

  const repaired = buildCurrentExportRecipe({ id: incomplete.id, name: incomplete.name, settings });
  expect(findCurrentExportRecipe([repaired], incomplete.id)).toEqual(repaired);
});

test('identity replacement removes valid and invalid prior rows without touching unrelated state', () => {
  const invalidLastUsed = { id: '__last_used__', name: 'Incomplete' };
  const unrelated = { customState: true };
  const values = [invalidLastUsed, currentRecipe, unrelated];

  expect(withoutExportRecipeId(values, '__last_used__')).toEqual([currentRecipe, unrelated]);
  expect(values).toEqual([invalidLastUsed, currentRecipe, unrelated]);
});

test('all persisted fixture recipes satisfy both current schemas', async () => {
  const fixture: unknown = JSON.parse(await readFile('fixtures/export/export-recipes.json', 'utf8'));
  const values = Array.isArray(fixture) ? fixture : [];

  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    expect(exportRecipeSchema.safeParse(value).success).toBe(true);
    expect(exportRecipeV1Schema.safeParse(value).success).toBe(true);
  }
});
