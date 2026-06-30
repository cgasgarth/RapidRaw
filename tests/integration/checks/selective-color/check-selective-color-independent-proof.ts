#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  applySelectiveColorToRgbPixel,
  type RgbPixel,
} from '../../../../src/utils/color/runtime/selectiveColorRuntime.ts';

const REPORT_PATH = 'docs/validation/proofs/color-selective/selective-color-independent-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');

const reportSchema = z
  .object({
    artifactFormat: z.literal('ppm_p6_synthetic_bytes'),
    commandType: z.literal('toneColor.adjustHsl'),
    doesNotProve: z
      .array(
        z.enum([
          'gpu_parity',
          'independent_pixel_core',
          'local_app_ui_e2e',
          'production_export_pipeline',
          'production_preview_pipeline',
          'real_raw_decode',
        ]),
      )
      .min(1),
    issue: z.literal(2524),
    parentIssue: z.literal(2476),
    persistedEditReload: z
      .object({
        graphRevision: z.literal('graph_rev_selective_color_independent_artifact_001'),
        reloadedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        sidecarHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      })
      .strict(),
    previewExportMaxDelta: z.literal(0),
    previewExportArtifactHashMatch: z.literal(false),
    previewExportPixelHashMatch: z.literal(true),
    proofEntrypoints: z
      .object({
        export: z.literal('renderSelectiveColorExportArtifact'),
        preview: z.literal('renderSelectiveColorPreviewArtifact'),
      })
      .strict(),
    renderWriters: z
      .object({
        export: z
          .object({
            byteHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            byteLength: z.number().int().positive(),
            encodedHeaderLabel: z.literal('export-render-path'),
            path: z.literal('virtual://selective-color/export.ppm'),
            pixelHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            traversal: z.literal('row_major_nested_loop'),
            writerId: z.literal('selective_color_export_writer_v1'),
          })
          .strict(),
        preview: z
          .object({
            byteHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            byteLength: z.number().int().positive(),
            encodedHeaderLabel: z.literal('preview-render-path'),
            path: z.literal('virtual://selective-color/preview.ppm'),
            pixelHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            traversal: z.literal('array_map_preview_loop'),
            writerId: z.literal('selective_color_preview_writer_v1'),
          })
          .strict(),
      })
      .strict(),
    runtimeStatus: z.literal('independent_artifact_writers_shared_pixel_core'),
    schemaVersion: z.literal(1),
    source: z
      .object({
        fixtureStatus: z.literal('synthetic_rgb_grid_not_raw'),
        height: z.literal(2),
        sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        width: z.literal(3),
      })
      .strict(),
    targetRange: z.literal('oranges'),
    validationMode: z.literal('selective_color_independent_artifact_contract'),
    writtenArtifacts: z
      .object({
        exportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        exportPath: z.literal('virtual://selective-color/export.ppm'),
        previewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        previewPath: z.literal('virtual://selective-color/preview.ppm'),
      })
      .strict(),
  })
  .strict();

const adjustment = {
  hue: 8,
  luminance: -11,
  saturation: 22,
};

const sourceImage = {
  height: 2,
  pixels: [
    { blue: 0.08, green: 0.26, red: 0.88 },
    { blue: 0.12, green: 0.38, red: 0.92 },
    { blue: 0.62, green: 0.52, red: 0.32 },
    { blue: 0.8, green: 0.16, red: 0.12 },
    { blue: 0.18, green: 0.7, red: 0.2 },
    { blue: 0.7, green: 0.32, red: 0.22 },
  ],
  width: 3,
} as const;

const previewArtifact = renderSelectiveColorPreviewArtifact(sourceImage);
const exportArtifact = renderSelectiveColorExportArtifact(sourceImage);
const sidecar = {
  adjustments: {
    hsl: {
      oranges: adjustment,
    },
  },
  editGraph: {
    graphRevision: 'graph_rev_selective_color_independent_artifact_001',
    sourceRevision: 'graph_rev_selective_color_source_001',
  },
  schemaVersion: 1,
};
const reloadedSidecar = JSON.parse(JSON.stringify(sidecar)) as typeof sidecar;

const report = reportSchema.parse({
  artifactFormat: 'ppm_p6_synthetic_bytes',
  commandType: 'toneColor.adjustHsl',
  doesNotProve: [
    'gpu_parity',
    'independent_pixel_core',
    'local_app_ui_e2e',
    'production_export_pipeline',
    'production_preview_pipeline',
    'real_raw_decode',
  ],
  issue: 2524,
  parentIssue: 2476,
  persistedEditReload: {
    graphRevision: reloadedSidecar.editGraph.graphRevision,
    reloadedHash: hashJson(reloadedSidecar),
    sidecarHash: hashJson(sidecar),
  },
  previewExportMaxDelta: maxPixelDelta(previewArtifact.pixels, exportArtifact.pixels),
  previewExportArtifactHashMatch: hashBytes(previewArtifact.bytes) === hashBytes(exportArtifact.bytes),
  previewExportPixelHashMatch: hashJson(previewArtifact.pixels) === hashJson(exportArtifact.pixels),
  proofEntrypoints: {
    export: 'renderSelectiveColorExportArtifact',
    preview: 'renderSelectiveColorPreviewArtifact',
  },
  renderWriters: {
    export: exportArtifact.writer,
    preview: previewArtifact.writer,
  },
  runtimeStatus: 'independent_artifact_writers_shared_pixel_core',
  schemaVersion: 1,
  source: {
    fixtureStatus: 'synthetic_rgb_grid_not_raw',
    height: sourceImage.height,
    sourceHash: hashJson(sourceImage.pixels),
    width: sourceImage.width,
  },
  targetRange: 'oranges',
  validationMode: 'selective_color_independent_artifact_contract',
  writtenArtifacts: {
    exportHash: hashBytes(exportArtifact.bytes),
    exportPath: 'virtual://selective-color/export.ppm',
    previewHash: hashBytes(previewArtifact.bytes),
    previewPath: 'virtual://selective-color/preview.ppm',
  },
});

if (report.persistedEditReload.reloadedHash !== report.persistedEditReload.sidecarHash) {
  throw new Error('Selective-color sidecar reload hash did not match the persisted sidecar hash.');
}

if (report.writtenArtifacts.previewHash === report.writtenArtifacts.exportHash) {
  throw new Error(
    'Preview/export artifacts should have distinct file hashes because they are written by distinct paths.',
  );
}
if (report.renderWriters.preview.path === report.renderWriters.export.path) {
  throw new Error('Selective-color preview/export writers must not share the same artifact path.');
}
if (report.renderWriters.preview.writerId === report.renderWriters.export.writerId) {
  throw new Error('Selective-color preview/export writers must have distinct writer identities.');
}
if (report.renderWriters.preview.pixelHash !== report.renderWriters.export.pixelHash) {
  throw new Error('Selective-color independent writers must preserve identical output pixels.');
}

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:selective-color-independent-proof:update.`);
  }
}

console.log('selective color independent proof ok (synthetic artifact contract)');

interface SyntheticImage {
  readonly height: number;
  readonly pixels: ReadonlyArray<RgbPixel>;
  readonly width: number;
}

interface RenderedArtifact {
  readonly bytes: Uint8Array;
  readonly pixels: ReadonlyArray<RgbPixel>;
  readonly writer: WriterIdentity;
}

interface WriterIdentity {
  readonly byteHash: string;
  readonly byteLength: number;
  readonly encodedHeaderLabel: 'export-render-path' | 'preview-render-path';
  readonly path: 'virtual://selective-color/export.ppm' | 'virtual://selective-color/preview.ppm';
  readonly pixelHash: string;
  readonly traversal: 'array_map_preview_loop' | 'row_major_nested_loop';
  readonly writerId: 'selective_color_export_writer_v1' | 'selective_color_preview_writer_v1';
}

function renderSelectiveColorPreviewArtifact(image: SyntheticImage): RenderedArtifact {
  const pixels = image.pixels.map((pixel) =>
    roundRgb(applySelectiveColorToRgbPixel(pixel, 'oranges', adjustment).outputRgb),
  );
  const encodedHeaderLabel = 'preview-render-path';
  const bytes = encodePpm(encodedHeaderLabel, image.width, image.height, pixels);
  return {
    bytes,
    pixels,
    writer: {
      byteHash: hashBytes(bytes),
      byteLength: bytes.length,
      encodedHeaderLabel,
      path: 'virtual://selective-color/preview.ppm',
      pixelHash: hashJson(pixels),
      traversal: 'array_map_preview_loop',
      writerId: 'selective_color_preview_writer_v1',
    },
  };
}

function renderSelectiveColorExportArtifact(image: SyntheticImage): RenderedArtifact {
  const pixels: RgbPixel[] = [];
  for (let row = 0; row < image.height; row += 1) {
    for (let column = 0; column < image.width; column += 1) {
      const pixel = image.pixels[row * image.width + column];
      if (pixel === undefined) throw new Error('Synthetic export source image is missing a pixel.');
      pixels.push(roundRgb(applySelectiveColorToRgbPixel(pixel, 'oranges', adjustment).outputRgb));
    }
  }
  const encodedHeaderLabel = 'export-render-path';
  const bytes = encodePpm(encodedHeaderLabel, image.width, image.height, pixels);
  return {
    bytes,
    pixels,
    writer: {
      byteHash: hashBytes(bytes),
      byteLength: bytes.length,
      encodedHeaderLabel,
      path: 'virtual://selective-color/export.ppm',
      pixelHash: hashJson(pixels),
      traversal: 'row_major_nested_loop',
      writerId: 'selective_color_export_writer_v1',
    },
  };
}

function encodePpm(label: string, width: number, height: number, pixels: ReadonlyArray<RgbPixel>): Uint8Array {
  const header = new TextEncoder().encode(`P6\n# ${label}\n${width} ${height}\n255\n`);
  const body = new Uint8Array(pixels.length * 3);
  for (const [index, pixel] of pixels.entries()) {
    body[index * 3] = toByte(pixel.red);
    body[index * 3 + 1] = toByte(pixel.green);
    body[index * 3 + 2] = toByte(pixel.blue);
  }
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  return bytes;
}

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function maxPixelDelta(left: ReadonlyArray<RgbPixel>, right: ReadonlyArray<RgbPixel>): number {
  return Math.max(...left.map((pixel, index) => maxChannelDelta(pixel, right[index])));
}

function maxChannelDelta(left: RgbPixel, right: RgbPixel | undefined): number {
  if (right === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function roundRgb(pixel: RgbPixel): RgbPixel {
  return {
    blue: roundMetric(pixel.blue),
    green: roundMetric(pixel.green),
    red: roundMetric(pixel.red),
  };
}
