#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { maskOverlayModeSchema, maskOverlaySettingsSchema } from '../../../src/schemas/maskOverlaySchemas.ts';
import { evaluateMaskOverlayColor, normalizeMaskOverlaySettings } from '../../../src/utils/maskOverlayModes.ts';
import {
  MASK_OVERLAY_HOTKEY_MODES,
  loadMaskOverlaySettingsPreference,
  nextMaskOverlayHotkeySettings,
  saveMaskOverlaySettingsPreference,
} from '../../../src/utils/maskOverlayPreferences.ts';

const colorSchema = z
  .object({
    a: z.number().min(0).max(1),
    b: z.number().min(0).max(255),
    g: z.number().min(0).max(255),
    r: z.number().min(0).max(255),
  })
  .strict();

const looseSettingsSchema = z
  .object({
    edgeThreshold: z.number().optional(),
    mode: maskOverlayModeSchema.optional(),
    opacity: z.number().optional(),
  })
  .strict();

const fixtureSchema = z
  .object({
    expected: maskOverlaySettingsSchema,
    id: z.string().trim().min(1),
    input: looseSettingsSchema,
    samples: z
      .array(
        z
          .object({
            color: colorSchema,
            weight: z.number(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const invalidFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    payload: z.unknown(),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/mask-overlay-modes.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid-mask-overlay-modes.json'), 'utf8')));
const rustMaskGenerationSource = readFileSync(resolve('src-tauri/src/mask_generation.rs'), 'utf8');
const overlayControlsSource = readFileSync(resolve('src/components/panel/right/MaskOverlayReviewControls.tsx'), 'utf8');
const masksPanelSource = readFileSync(resolve('src/components/panel/right/MasksPanel.tsx'), 'utf8');
const editorStoreSource = readFileSync(resolve('src/store/useEditorStore.ts'), 'utf8');

for (const fixture of fixtures) {
  const actual = normalizeMaskOverlaySettings(fixture.input);
  if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
    console.error(`${fixture.id}: mask overlay normalization mismatch`);
    process.exit(1);
  }

  for (const sample of fixture.samples) {
    const color = evaluateMaskOverlayColor(sample.weight, actual);
    if (JSON.stringify(color) !== JSON.stringify(sample.color)) {
      console.error(`${fixture.id}: mask overlay color mismatch`);
      console.error('Expected:', JSON.stringify(sample.color));
      console.error('Actual:', JSON.stringify(color));
      process.exit(1);
    }
  }
}

for (const fixture of invalidFixtures) {
  const result = maskOverlaySettingsSchema.safeParse(fixture.payload);
  if (result.success) {
    console.error(`${fixture.id}: expected mask overlay schema rejection`);
    process.exit(1);
  }
}

const requiredRustFragments = [
  'pub enum MaskOverlayMode',
  'pub struct MaskOverlaySettings',
  'overlay_settings: Option<MaskOverlaySettings>',
  'MaskOverlayMode::Hidden',
  'MaskOverlayMode::Rubylith',
  'MaskOverlayMode::Green',
  'MaskOverlayMode::Blue',
  'MaskOverlayMode::White',
  'MaskOverlayMode::Black',
  'MaskOverlayMode::Grayscale',
  'MaskOverlayMode::Inverse',
  'MaskOverlayMode::Edges',
];

for (const fragment of requiredRustFragments) {
  if (!rustMaskGenerationSource.includes(fragment)) {
    console.error(`Missing Rust mask overlay runtime fragment: ${fragment}`);
    process.exit(1);
  }
}

const requiredUiFragments = [
  'data-testid="mask-overlay-review-controls"',
  'data-mask-overlay-mode={settings.mode}',
  'data-mask-overlay-opacity={settings.opacity.toFixed(2)}',
  'data-mask-overlay-hotkey={hotkeyHint}',
  'data-testid={`mask-overlay-mode-${option.mode}`}',
  'data-testid="mask-overlay-opacity-control"',
  'data-testid="mask-overlay-edge-threshold-control"',
];

for (const fragment of requiredUiFragments) {
  if (!overlayControlsSource.includes(fragment)) {
    console.error(`Missing mask overlay UI contract: ${fragment}`);
    process.exit(1);
  }
}

const requiredPanelFragments = [
  'saveMaskOverlaySettingsPreference(settings)',
  'nextMaskOverlayHotkeySettings(useEditorStore.getState().maskOverlaySettings)',
  "event.code !== 'KeyO'",
  'hotkeyHint="Shift+O"',
];

for (const fragment of requiredPanelFragments) {
  if (!masksPanelSource.includes(fragment)) {
    console.error(`Missing mask overlay panel behavior: ${fragment}`);
    process.exit(1);
  }
}

if (!editorStoreSource.includes('maskOverlaySettings: loadMaskOverlaySettingsPreference()')) {
  console.error('Editor store must initialize mask overlay settings from persisted preference.');
  process.exit(1);
}

if (MASK_OVERLAY_HOTKEY_MODES.length < 4 || !MASK_OVERLAY_HOTKEY_MODES.includes('edges')) {
  console.error('Mask overlay hotkey cycle must expose review-focused modes.');
  process.exit(1);
}

const hotkeyInitial = normalizeMaskOverlaySettings({ mode: 'rubylith' });
const hotkeyNext = nextMaskOverlayHotkeySettings(hotkeyInitial);
if (hotkeyNext.mode !== 'inverse') {
  console.error(`Mask overlay hotkey cycle expected inverse after rubylith, got ${hotkeyNext.mode}.`);
  process.exit(1);
}

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }

  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.entries.delete(key);
  }

  setItem(key: string, value: string) {
    this.entries.set(key, value);
  }
}

const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

const persisted = saveMaskOverlaySettingsPreference({ edgeThreshold: 0.6, mode: 'edges', opacity: 0.8 });
const loaded = loadMaskOverlaySettingsPreference();
if (JSON.stringify(persisted) !== JSON.stringify(loaded)) {
  console.error('Mask overlay preference did not round-trip through localStorage.');
  process.exit(1);
}

if (previousLocalStorage === undefined) {
  delete globalThis.localStorage;
} else {
  Object.defineProperty(globalThis, 'localStorage', previousLocalStorage);
}

console.log(`Validated ${fixtures.length} mask overlay fixtures and ${invalidFixtures.length} invalid cases.`);
