#!/usr/bin/env bun

import { runExportUiCheck } from '../../../../scripts/lib/proofs/export-ui-check.ts';

await runExportUiCheck({
  label: 'export built-in preset readiness',
  settings: {
    exportPresets: [
      {
        blackPointCompensation: false,
        colorProfile: 'srgb',
        dontEnlarge: true,
        enableResize: false,
        enableWatermark: false,
        exportMasks: false,
        fileFormat: 'jpeg',
        filenameTemplate: '{original_filename}',
        id: 'default-hq',
        jpegQuality: 95,
        keepMetadata: true,
        name: 'High Quality',
        outputSharpening: null,
        preserveFolders: false,
        preserveTimestamps: false,
        renderingIntent: 'relativeColorimetric',
        resizeMode: 'longEdge',
        resizeValue: 2048,
        stripGps: false,
        watermarkAnchor: 'bottomRight',
        watermarkOpacity: 75,
        watermarkPath: null,
        watermarkScale: 10,
        watermarkSpacing: 5,
      },
      {
        blackPointCompensation: false,
        colorProfile: 'srgb',
        dontEnlarge: true,
        enableResize: true,
        enableWatermark: false,
        exportMasks: false,
        fileFormat: 'jpeg',
        filenameTemplate: '{original_filename}_web',
        id: 'default-fast',
        jpegQuality: 80,
        keepMetadata: false,
        name: 'Fast (Web)',
        outputSharpening: null,
        preserveFolders: false,
        preserveTimestamps: false,
        renderingIntent: 'relativeColorimetric',
        resizeMode: 'width',
        resizeValue: 2048,
        stripGps: true,
        watermarkAnchor: 'bottomRight',
        watermarkOpacity: 75,
        watermarkPath: null,
        watermarkScale: 10,
        watermarkSpacing: 5,
      },
    ],
  },
  run: async (page) => {
    await page.getByTestId('export-recipe-readiness-summary').waitFor({ timeout: 10_000 });
    const summary = await page.getByTestId('export-recipe-readiness-summary').innerText();
    if (!summary.includes('2 recipes') || !summary.includes('2 valid') || !summary.includes('2 built-in')) {
      throw new Error(`Unexpected built-in recipe summary: ${summary}`);
    }

    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes('Custom recipe needs review')) {
      throw new Error('Valid built-in export presets were labeled as custom-review warnings.');
    }
  },
});
