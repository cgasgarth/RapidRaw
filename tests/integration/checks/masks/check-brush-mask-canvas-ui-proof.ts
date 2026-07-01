#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/proofs/layers-masks/brush-mask-canvas-ui-proof-2026-06-22.json';
const FINAL_SCREENSHOT_PATH = 'artifacts/visual-smoke/brush-mask-canvas-ui.png';
const PAINT_SCREENSHOT_PATH = 'artifacts/visual-smoke/brush-mask-canvas-paint.png';

const pngDimensionsSchema = z.object({ height: z.literal(960), width: z.literal(1440) }).strict();
const reportSchema = z
  .object({
    changedMaskIds: z.array(z.string().min(1)).min(1),
    commandHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    commandType: z.literal('layerMask.createBrushMask'),
    coordinateSpace: z.literal('normalized_image'),
    dryRunMaskHash: z.string().min(1),
    finalCoverage: z.number().positive(),
    finalMaskHash: z.string().min(1),
    issue: z.literal(2996),
    lastStrokeMode: z.literal('erase'),
    lastStrokePointCount: z.number().int().min(2),
    paintCoverage: z.number().positive(),
    paintMaskHash: z.string().min(1),
    paintScreenshot: z.literal(PAINT_SCREENSHOT_PATH),
    pointCounts: z.array(z.number().int().min(2)).length(2),
    pressureApplyMaskHash: z.string().min(1),
    pressureCoverage: z.number().positive(),
    pressureDryRunMaskHash: z.string().min(1),
    pressureMaskHash: z.string().min(1),
    pressurePointCount: z.number().int().min(1),
    pressureUsed: z.literal(true),
    refineBrushFeather: z.literal(64),
    refineBrushSize: z.literal(96),
    schemaVersion: z.literal(1),
    screenshot: z.literal(FINAL_SCREENSHOT_PATH),
    strokeCount: z.literal(2),
    toolOrder: z.tuple([z.literal('brush'), z.literal('eraser')]),
    validationMode: z.literal('brush_mask_canvas_ui_drag_to_runtime_output_proof'),
  })
  .strict();

const report = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (report.finalCoverage >= report.paintCoverage) {
  throw new Error(`Expected eraser to reduce alpha coverage: ${report.paintCoverage} -> ${report.finalCoverage}`);
}
if (report.finalMaskHash === report.paintMaskHash) {
  throw new Error('Expected final mask hash to differ from paint-only hash.');
}
if (report.pressureCoverage >= report.paintCoverage) {
  throw new Error(
    `Expected pressure replay to reduce alpha coverage: ${report.paintCoverage} -> ${report.pressureCoverage}`,
  );
}
if (report.pressureDryRunMaskHash !== report.pressureApplyMaskHash) {
  throw new Error('Expected pressure dry-run/apply mask hashes to match.');
}
if (report.pressureMaskHash !== report.pressureDryRunMaskHash) {
  throw new Error('Expected pressure render hash to match dry-run artifact hash.');
}

pngDimensionsSchema.parse(await readPngDimensions(FINAL_SCREENSHOT_PATH));
pngDimensionsSchema.parse(await readPngDimensions(PAINT_SCREENSHOT_PATH));

console.log(`brush mask canvas UI proof ok (${report.strokeCount} strokes)`);

async function readPngDimensions(path: string): Promise<{ height: number; width: number }> {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }
  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}
