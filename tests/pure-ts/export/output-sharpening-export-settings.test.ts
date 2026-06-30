import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  FileFormats,
  WatermarkAnchor,
} from '../../../src/components/ui/ExportImportProperties';
import { useExportSettings } from '../../../src/hooks/export/useExportSettings';
import { parseExportRecipe } from '../../../src/schemas/exportRecipeSchemas';
import type { OutputSharpeningSettings } from '../../../src/schemas/outputSharpeningSchemas';

type ExportSettingsHookState = ReturnType<typeof useExportSettings>;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedHook: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedHook !== null) {
    act(() => {
      renderedHook?.root.unmount();
    });
    renderedHook.container.remove();
    renderedHook = null;
  }
});

test('export settings preserve output sharpening through defaults, updates, and presets', async () => {
  const hook = await renderExportSettingsHook();

  expect(hook.current.outputSharpening).toBeNull();
  expect(hook.current.currentSettingsObject.outputSharpening).toBeNull();

  act(() => {
    hook.current.enableDefaultOutputSharpening();
  });

  expect(hook.current.outputSharpening).toEqual({
    amount: 35,
    radiusPx: 0.7,
    target: 'screen',
    threshold: 0.02,
  });

  act(() => {
    hook.current.updateOutputSharpening({
      amount: 62,
      radiusPx: 1.2,
      target: 'print',
      threshold: 0.04,
    });
  });

  const updatedOutputSharpening = {
    amount: 62,
    radiusPx: 1.2,
    target: 'print',
    threshold: 0.04,
  } satisfies OutputSharpeningSettings;
  expect(hook.current.outputSharpening).toEqual(updatedOutputSharpening);
  expect(hook.current.currentSettingsObject.outputSharpening).toEqual(updatedOutputSharpening);

  const preset = buildExportPreset({
    id: 'print-output-sharpening',
    name: 'Print output sharpening',
    outputSharpening: updatedOutputSharpening,
  });
  act(() => {
    hook.current.handleApplyPreset(preset);
  });

  expect(hook.current.outputSharpening).toEqual(updatedOutputSharpening);

  act(() => {
    hook.current.handleApplyPreset(buildExportPreset({ id: 'legacy-preset', name: 'Legacy preset' }));
  });

  expect(hook.current.outputSharpening).toBeNull();
});

test('export recipe serialization keeps output sharpening settings instead of dropping them', () => {
  const outputSharpening = {
    amount: 48,
    radiusPx: 0.8,
    target: 'print',
    threshold: 0.03,
  } satisfies OutputSharpeningSettings;

  const recipe = parseExportRecipe({
    blackPointCompensation: true,
    colorProfile: ExportColorProfile.DisplayP3,
    dontEnlarge: true,
    enableResize: true,
    enableWatermark: false,
    fileFormat: FileFormats.Jpeg,
    filenameTemplate: '{original_filename}_print',
    id: 'recipe-with-output-sharpening',
    jpegQuality: 92,
    keepMetadata: true,
    name: 'Recipe with output sharpening',
    outputSharpening,
    renderingIntent: ExportRenderingIntent.Perceptual,
    resizeMode: 'longEdge',
    resizeValue: 3600,
    stripGps: false,
    watermarkAnchor: WatermarkAnchor.BottomRight,
    watermarkOpacity: 75,
    watermarkPath: null,
    watermarkScale: 10,
    watermarkSpacing: 5,
  });

  expect(recipe.outputSharpening).toEqual(outputSharpening);
  expect(JSON.parse(JSON.stringify(recipe)).outputSharpening).toEqual(outputSharpening);
});

async function renderExportSettingsHook(): Promise<{ current: ExportSettingsHookState }> {
  installDom();
  const latest: { current: ExportSettingsHookState | null } = { current: null };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(ExportSettingsHookHarness, { latest }));
    await flushPromises();
  });

  renderedHook = { container, root };
  return latest as { current: ExportSettingsHookState };
}

function ExportSettingsHookHarness({
  latest,
}: {
  latest: {
    current: ExportSettingsHookState | null;
  };
}) {
  latest.current = useExportSettings();
  return null;
}

function buildExportPreset(overrides: Partial<ExportPreset>): ExportPreset {
  return {
    dontEnlarge: true,
    enableResize: false,
    enableWatermark: false,
    fileFormat: FileFormats.Jpeg,
    filenameTemplate: '{original_filename}_edited',
    id: 'preset',
    jpegQuality: 90,
    keepMetadata: true,
    name: 'Preset',
    preserveTimestamps: false,
    resizeMode: 'longEdge',
    resizeValue: 2048,
    stripGps: true,
    watermarkAnchor: WatermarkAnchor.BottomRight,
    watermarkOpacity: 75,
    watermarkPath: null,
    watermarkScale: 10,
    watermarkSpacing: 5,
    ...overrides,
  };
}

function installDom() {
  const window = new Window({ url: 'http://localhost/output-sharpening-export-settings' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
