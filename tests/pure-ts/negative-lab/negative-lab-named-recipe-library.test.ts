import { describe, expect, test } from 'bun:test';
import { createDefaultNegativeLabModalSession } from '../../../src/utils/negative-lab/negativeLabModalSession';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../src/utils/negative-lab/negativeLabPresetCatalog';
import {
  applyNegativeLabNamedRecipe,
  createNegativeLabNamedRecipe,
  deleteNegativeLabNamedRecipe,
  EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY,
  loadNegativeLabNamedRecipeLibrary,
  persistNegativeLabNamedRecipeLibrary,
  renameNegativeLabNamedRecipe,
  resolveNegativeLabRecipeScope,
  saveNegativeLabNamedRecipe,
} from '../../../src/utils/negative-lab/negativeLabRecipeLibrary';

const input = (overrides: Partial<Parameters<typeof createNegativeLabNamedRecipe>[0]> = {}) => ({
  name: 'Portra daylight',
  params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
  profileSnapshot: { process: 'c41_color_negative', transform: 'density_rgb_v1' },
  saveOptions: { outputFormat: 'tiff16', suffix: 'Positive', writeConversionBundle: true } as const,
  selectedAcquisitionProfileId: 'camera_raw_linear_v1' as const,
  selectedPresetId: DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId,
  sourceSessionId: 'negative_lab_modal_session_test',
  ...overrides,
});

describe('negative lab named recipe library', () => {
  test('creates a versioned content-addressed recipe and round-trips lifecycle operations', () => {
    const recipe = createNegativeLabNamedRecipe(input(), new Date('2026-01-01T00:00:00.000Z'));
    const saved = saveNegativeLabNamedRecipe(EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY, recipe);
    expect(recipe.id).toMatch(/^negative_lab\.recipe\.[0-9a-f]{8}\.v1$/u);
    expect(recipe.contentHash).toBe(`fnv1a32:${recipe.id.split('.')[2]}`);
    expect(renameNegativeLabNamedRecipe(saved, recipe.id, ' Portra  daylight ').recipes[0]?.name).toBe(
      'Portra daylight',
    );
    expect(deleteNegativeLabNamedRecipe(saved, recipe.id)).toEqual(EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY);
  });

  test('rejects duplicate names and ids without mutating the source library', () => {
    const recipe = createNegativeLabNamedRecipe(input());
    const saved = saveNegativeLabNamedRecipe(EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY, recipe);
    expect(() => saveNegativeLabNamedRecipe(saved, recipe)).toThrow('negative_lab.recipe_id_exists');
    expect(() =>
      saveNegativeLabNamedRecipe(
        saved,
        createNegativeLabNamedRecipe({
          ...input({ name: ' PORTRA daylight ' }),
          params: {
            ...DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
            exposure: DEFAULT_NEGATIVE_LAB_UI_PRESET.params.exposure + 0.1,
          },
        }),
      ),
    ).toThrow('negative_lab.recipe_name_exists');
    expect(saved.recipes).toHaveLength(1);
  });

  test('loads malformed app data as an empty library and writes atomically', async () => {
    let written = 0;
    let value: unknown = { version: 1, recipes: [{ malformed: true }] };
    const store = {
      read: async () => value,
      write: async (next: unknown) => {
        written += 1;
        value = next;
      },
    };
    expect(await loadNegativeLabNamedRecipeLibrary(store)).toEqual(EMPTY_NEGATIVE_LAB_NAMED_RECIPE_LIBRARY);
    const recipe = createNegativeLabNamedRecipe(input());
    const next = await persistNegativeLabNamedRecipeLibrary(store, (library) =>
      saveNegativeLabNamedRecipe(library, recipe),
    );
    expect(next.recipes).toHaveLength(1);
    expect(written).toBe(1);
  });

  test('resolves active, all, included, and ready scopes without changing frame decisions', () => {
    const snapshot = createDefaultNegativeLabModalSession(['a.raw', 'b.raw', 'c.raw']);
    const frame = (path: string) =>
      snapshot.session.frameStateByPath[path] ?? {
        cropStatus: null,
        exposureOffset: null,
        included: true,
        qcDecision: null,
        rgbBalanceOffset: null,
      };
    const withDecisions = {
      ...snapshot,
      session: {
        ...snapshot.session,
        activePath: 'b.raw',
        frameStateByPath: {
          ...snapshot.session.frameStateByPath,
          'b.raw': { ...frame('b.raw'), included: false },
          'c.raw': { ...frame('c.raw'), qcDecision: 'rejected' as const },
        },
      },
    };
    expect(resolveNegativeLabRecipeScope(withDecisions, 'active')).toEqual(['b.raw']);
    expect(resolveNegativeLabRecipeScope(withDecisions, 'all')).toEqual(['a.raw', 'b.raw', 'c.raw']);
    expect(resolveNegativeLabRecipeScope(withDecisions, 'included')).toEqual(['a.raw', 'c.raw']);
    expect(resolveNegativeLabRecipeScope(withDecisions, 'ready')).toEqual(['a.raw']);
  });

  test('blocks acquisition mismatch before mutating the session', () => {
    const snapshot = createDefaultNegativeLabModalSession(['a.raw']);
    const recipe = createNegativeLabNamedRecipe(input({ selectedAcquisitionProfileId: 'dng_linear_camera_v1' }));
    const result = applyNegativeLabNamedRecipe(snapshot, recipe, 'active', {
      selectedAcquisitionProfileId: 'camera_raw_linear_v1',
      selectedPresetId: DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId,
    });
    expect(result.compatibility).toEqual({ blocked: true, reasons: ['acquisition_profile_mismatch'] });
    expect(result.affectedPaths).toEqual([]);
    expect(result.snapshot).toBe(snapshot);
  });

  test('applies to a scope, preserves frame decisions, and invalidates accepted plans', () => {
    const snapshot = createDefaultNegativeLabModalSession(['a.raw', 'b.raw']);
    const frame = (path: string) =>
      snapshot.session.frameStateByPath[path] ?? {
        cropStatus: null,
        exposureOffset: null,
        included: true,
        qcDecision: null,
        rgbBalanceOffset: null,
      };
    const recipe = createNegativeLabNamedRecipe(input());
    const planned = {
      ...snapshot,
      planState: { ...snapshot.planState, acceptedApplyPlanFingerprint: 'stale', acceptedSessionRevision: 0 },
      session: {
        ...snapshot.session,
        planState: { ...snapshot.session.planState, acceptedApplyPlanFingerprint: 'stale', acceptedSessionRevision: 0 },
        frameStateByPath: {
          ...snapshot.session.frameStateByPath,
          'a.raw': { ...frame('a.raw'), included: false, exposureOffset: 0.25 },
        },
      },
    };
    const result = applyNegativeLabNamedRecipe(planned, recipe, 'ready', {
      selectedAcquisitionProfileId: 'camera_raw_linear_v1',
      selectedPresetId: DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId,
    });
    expect(result.affectedPaths).toEqual(['b.raw']);
    expect(result.snapshot.session.recipeState.params).toEqual(recipe.params);
    expect(result.snapshot.session.frameStateByPath['a.raw']?.exposureOffset).toBe(0.25);
    expect(result.snapshot.planState.acceptedApplyPlanFingerprint).toBeNull();
    expect(result.snapshot.session.planState.acceptedApplyPlanFingerprint).toBeNull();
  });
});
