#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

import Color from 'colorjs.io';
import { z } from 'zod';

import { parseRawOpenEditExportRunReportCollection } from '../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const REPORT_PATH = 'docs/validation/proofs/color/gamut-mapping-real-raw-comparison-2026-06-26.json';
const PRIVATE_ROOT = '/tmp/rawengine-gamut-mapping-v4-real-raw-proof';
const PERCEPTUAL_REPORT_PATH = `${PRIVATE_ROOT}/raw-open-edit-export-run-reports.json`;
const RELATIVE_REPORT_PATH = `${PRIVATE_ROOT}/raw-open-edit-export-relative-run-reports.json`;
const PERCEPTUAL_FIXTURE_ID = 'validation.raw-open-edit-export.professional-color.v1';
const RELATIVE_FIXTURE_ID = 'validation.raw-open-edit-export.professional-color-relative.v1';
const DELTA_HEATMAP_PATH = 'private-artifacts/validation/open-edit-export/gamut-mapping-delta-heatmap.png';
const PRIVATE_SOURCE = '/Users/cgas/Pictures/Capture One/Alaska';
const PERCEPTUAL_COMMAND = `RAWENGINE_PRIVATE_RAW_SOURCE="${PRIVATE_SOURCE}" bun scripts/private-raw/proofs/raw-workflow/run-raw-color-management-private-proof.ts --request fixtures/validation/raw-open-edit-export/raw-open-edit-export-srgb-perceptual-proof-request.json --root ${PRIVATE_ROOT} --output ${PERCEPTUAL_REPORT_PATH} --require-assets`;
const RELATIVE_COMMAND = `RAWENGINE_PRIVATE_RAW_SOURCE="${PRIVATE_SOURCE}" bun scripts/private-raw/proofs/raw-workflow/run-raw-color-management-private-proof.ts --request fixtures/validation/raw-open-edit-export/raw-open-edit-export-srgb-relative-proof-request.json --root ${PRIVATE_ROOT} --output ${RELATIVE_REPORT_PATH} --require-assets`;
const UPDATE_REPORT = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');
const allowFreshHashes = process.argv.includes('--allow-fresh-hashes');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? PRIVATE_ROOT;
const hasExplicitRunReports =
  process.argv.includes('--perceptual-run-reports') || process.argv.includes('--relative-run-reports');
const perceptualRunReportsPath = valueAfter('--perceptual-run-reports') ?? PERCEPTUAL_REPORT_PATH;
const relativeRunReportsPath = valueAfter('--relative-run-reports') ?? RELATIVE_REPORT_PATH;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const metricSetSchema = z
  .object({
    max: z.number().nonnegative(),
    p50: z.number().nonnegative(),
    p95: z.number().nonnegative(),
  })
  .strict();
const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.literal('changed_pixel_heatmap_private'),
    path: z.literal(DELTA_HEATMAP_PATH),
    publicRepoAllowed: z.literal(false),
  })
  .strict();
const mapperCoverageSchema = z
  .object({
    changedPixelRatio: z.number().min(0).max(1),
    inputPixelRatio: z.number().min(0).max(1),
    postMapOutOfGamutPixelRatio: z.number().min(0).max(1),
    preMapMaxLinearRgb: z.number(),
    preMapMinLinearRgb: z.number(),
    preMapOutOfGamutChannelRatio: z.number().min(0).max(1),
    preMapOutOfGamutPixelRatio: z.number().min(0).max(1),
  })
  .strict();
const reportSchema = z
  .object({
    artifacts: z.object({ deltaHeatmap: artifactSchema }).strict(),
    caveats: z.array(z.string().min(1)).min(5),
    comparisonBasis: z.literal('soft_proof_rgb8_perceptual_vs_relative_colorimetric'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(3238),
    metrics: z
      .object({
        affectedDeltaE00VsRelativeClip: metricSetSchema,
        affectedHueAngleDriftDegVsRelativeClip: metricSetSchema,
        affectedPixelCount: z.number().int().positive(),
        changedPixelRatio: z.number().min(0).max(1),
        deltaE00VsRelativeClip: metricSetSchema,
        hueAngleDriftDegVsRelativeClip: metricSetSchema,
        maxAbsRgb8Delta: z.number().int().min(0).max(255),
        meanAbsRgb8Delta: z.number().min(0).max(255),
        neutralAxisDriftP95: z.number().nonnegative(),
        perceptualDeltaE00VsUnmappedDestinationLab: z.null(),
        perceptualMapperCoverage: mapperCoverageSchema,
        pixelCount: z.number().int().positive(),
        saturationMonotonicViolationCount: z.number().int().nonnegative(),
      })
      .strict(),
    perceptualRun: z
      .object({
        fixtureId: z.literal(PERCEPTUAL_FIXTURE_ID),
        gamutMapping: z.literal('rawengine.gamut.srgb-oklab-chroma-reduce.v4'),
        reportPath: z.string().trim().min(1),
        softProofHash: hashSchema,
        softProofPath: z.string().trim().min(1),
      })
      .strict(),
    relativeRun: z
      .object({
        fixtureId: z.literal(RELATIVE_FIXTURE_ID),
        gamutMapping: z.literal('not_proven'),
        reportPath: z.string().trim().min(1),
        softProofHash: hashSchema,
        softProofPath: z.string().trim().min(1),
      })
      .strict(),
    schemaVersion: z.literal(1),
    validationCommands: z.array(z.enum([PERCEPTUAL_COMMAND, RELATIVE_COMMAND])).length(2),
    validationMode: z.literal('local_alaska_raw_srgb_perceptual_vs_relative_comparison'),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.metrics.deltaE00VsRelativeClip.p50 > report.metrics.deltaE00VsRelativeClip.p95) {
      context.addIssue({ code: 'custom', message: 'DeltaE00 p50 must not exceed p95.' });
    }
    if (report.metrics.deltaE00VsRelativeClip.p95 > report.metrics.deltaE00VsRelativeClip.max) {
      context.addIssue({ code: 'custom', message: 'DeltaE00 p95 must not exceed max.' });
    }
    if (report.metrics.changedPixelRatio <= 0) {
      context.addIssue({ code: 'custom', message: 'changedPixelRatio must prove visible output changed.' });
    }
    if (report.metrics.affectedPixelCount <= 0) {
      context.addIssue({ code: 'custom', message: 'affectedPixelCount must prove visible output changed.' });
    }
    if (report.metrics.maxAbsRgb8Delta <= 0) {
      context.addIssue({ code: 'custom', message: 'maxAbsRgb8Delta must prove visible output changed.' });
    }
    if (report.metrics.perceptualMapperCoverage.inputPixelRatio <= 0) {
      context.addIssue({ code: 'custom', message: 'perceptual mapper must receive input pixels.' });
    }
    if (report.metrics.perceptualMapperCoverage.changedPixelRatio <= 0) {
      context.addIssue({ code: 'custom', message: 'perceptual mapper must change at least one pixel.' });
    }
    if (report.metrics.perceptualMapperCoverage.preMapOutOfGamutPixelRatio <= 0) {
      context.addIssue({ code: 'custom', message: 'perceptual mapper must receive out-of-gamut pixels.' });
    }
    if (report.metrics.perceptualMapperCoverage.postMapOutOfGamutPixelRatio !== 0) {
      context.addIssue({ code: 'custom', message: 'perceptual mapper output must be in gamut.' });
    }
  });

const failures: Array<string> = [];
let report: z.infer<typeof reportSchema>;

if (UPDATE_REPORT || (allowFreshHashes && hasExplicitRunReports)) {
  report = reportSchema.parse(await buildReport());
  if (UPDATE_REPORT) {
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }
} else {
  report = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
}

if (requireAssets) {
  await verifyArtifact(report.perceptualRun.softProofPath, report.perceptualRun.softProofHash);
  await verifyArtifact(report.relativeRun.softProofPath, report.relativeRun.softProofHash);
  await verifyArtifact(report.artifacts.deltaHeatmap.path, report.artifacts.deltaHeatmap.hash);
}

if (failures.length > 0) {
  console.error('gamut mapping real RAW comparison failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`gamut mapping real RAW comparison ok (${requireAssets ? 'assets verified' : 'schema verified'})`);

async function buildReport() {
  const perceptual = await loadRun(perceptualRunReportsPath, PERCEPTUAL_FIXTURE_ID);
  const relative = await loadRun(relativeRunReportsPath, RELATIVE_FIXTURE_ID);
  const perceptualPng = readPngRgb8(await readFile(resolve(privateRoot, perceptual.softProofPath)));
  const relativePng = readPngRgb8(await readFile(resolve(privateRoot, relative.softProofPath)));
  if (perceptualPng.width !== relativePng.width || perceptualPng.height !== relativePng.height) {
    throw new Error('soft proof dimensions differ');
  }

  const deltas: Array<number> = [];
  const affectedDeltas: Array<number> = [];
  const hueDeltas: Array<number> = [];
  const affectedHueDeltas: Array<number> = [];
  const neutralDrifts: Array<number> = [];
  let changed = 0;
  let maxAbs = 0;
  let sumAbs = 0;
  let saturationMonotonicViolationCount = 0;
  const pixelCount = perceptualPng.width * perceptualPng.height;
  const deltaHeatmap = new Uint8Array(pixelCount * 3);

  for (let index = 0; index < perceptualPng.rgb.length; index += 3) {
    const perceptualRgb = [
      perceptualPng.rgb[index],
      perceptualPng.rgb[index + 1],
      perceptualPng.rgb[index + 2],
    ] as const;
    const relativeRgb = [relativePng.rgb[index], relativePng.rgb[index + 1], relativePng.rgb[index + 2]] as const;
    const channelDeltas = perceptualRgb.map((value, channel) => Math.abs(value - relativeRgb[channel]));
    const pixelChanged = channelDeltas.some((value) => value > 0);
    if (pixelChanged) changed += 1;
    maxAbs = Math.max(maxAbs, ...channelDeltas);
    sumAbs += channelDeltas[0] + channelDeltas[1] + channelDeltas[2];
    const heat = Math.min(255, Math.max(...channelDeltas) * 16);
    deltaHeatmap[index] = heat;
    deltaHeatmap[index + 1] = pixelChanged ? 32 : 0;
    deltaHeatmap[index + 2] = pixelChanged ? 255 - heat : 0;

    const perceptualLab = rgb8ToLab(perceptualRgb);
    const relativeLab = rgb8ToLab(relativeRgb);
    const deltaE00 = Color.deltaE(perceptualLab, relativeLab, '2000');
    deltas.push(deltaE00);

    const perceptualOklch = perceptualLab.to('oklch').coords;
    const relativeOklch = relativeLab.to('oklch').coords;
    const hueDelta = hueAngleDeltaDeg(perceptualOklch[2], relativeOklch[2]);
    hueDeltas.push(hueDelta);
    if (pixelChanged) {
      affectedDeltas.push(deltaE00);
      affectedHueDeltas.push(hueDelta);
    }
    if ((relativeOklch[1] ?? 0) <= 0.02) {
      neutralDrifts.push(Math.max(...channelDeltas));
    }
    if ((perceptualOklch[1] ?? 0) > (relativeOklch[1] ?? 0) + 0.001) {
      saturationMonotonicViolationCount += 1;
    }
  }
  const deltaHeatmapHash = await writePngArtifact(
    DELTA_HEATMAP_PATH,
    deltaHeatmap,
    perceptualPng.width,
    perceptualPng.height,
  );

  return {
    artifacts: {
      deltaHeatmap: {
        hash: deltaHeatmapHash,
        kind: 'changed_pixel_heatmap_private',
        path: DELTA_HEATMAP_PATH,
        publicRepoAllowed: false,
      },
    },
    caveats: [
      'DeltaE00 is a pairwise guardrail, not a final image-quality score.',
      'The comparison uses soft-proof RGB8 artifacts because the runtime report proves soft proof and TIFF export parity.',
      'perceptualDeltaE00VsRelativeClip compares against relative colorimetric clipping, not a ground-truth visual target.',
      'perceptualDeltaE00VsUnmappedDestinationLab is null because the current private report does not persist pre-map destination-space pixels.',
      'This report does not prove Capture One-class visual quality, display-device matching, camera-profile accuracy, or final mapper tuning.',
    ],
    comparisonBasis: 'soft_proof_rgb8_perceptual_vs_relative_colorimetric',
    generatedAt: new Date().toISOString(),
    issue: 3238,
    metrics: {
      affectedDeltaE00VsRelativeClip: metricSet(affectedDeltas),
      affectedHueAngleDriftDegVsRelativeClip: metricSet(affectedHueDeltas),
      affectedPixelCount: changed,
      changedPixelRatio: round(changed / pixelCount),
      deltaE00VsRelativeClip: metricSet(deltas),
      hueAngleDriftDegVsRelativeClip: metricSet(hueDeltas),
      maxAbsRgb8Delta: maxAbs,
      meanAbsRgb8Delta: round(sumAbs / (pixelCount * 3)),
      neutralAxisDriftP95: round(quantile(neutralDrifts, 0.95)),
      perceptualDeltaE00VsUnmappedDestinationLab: null,
      perceptualMapperCoverage: coverageMetrics(perceptual.metrics),
      pixelCount,
      saturationMonotonicViolationCount,
    },
    perceptualRun: {
      fixtureId: PERCEPTUAL_FIXTURE_ID,
      gamutMapping: perceptual.gamutMapping,
      reportPath: perceptualRunReportsPath,
      softProofHash: perceptual.softProofHash,
      softProofPath: perceptual.softProofPath,
    },
    relativeRun: {
      fixtureId: RELATIVE_FIXTURE_ID,
      gamutMapping: relative.gamutMapping,
      reportPath: relativeRunReportsPath,
      softProofHash: relative.softProofHash,
      softProofPath: relative.softProofPath,
    },
    schemaVersion: 1,
    validationCommands: [PERCEPTUAL_COMMAND, RELATIVE_COMMAND],
    validationMode: 'local_alaska_raw_srgb_perceptual_vs_relative_comparison',
  };
}

async function loadRun(runReportsPath: string, fixtureId: string) {
  const collection = parseRawOpenEditExportRunReportCollection(JSON.parse(await readFile(runReportsPath, 'utf8')));
  const runReport = collection.reports.find((candidate) => candidate.fixtureId === fixtureId);
  if (runReport === undefined) throw new Error(`missing run report ${fixtureId}`);
  const softProof = runReport.artifacts.find((artifact) => artifact.kind === 'soft_proof_after_private');
  if (softProof === undefined) throw new Error(`${fixtureId}: missing soft proof artifact`);
  return {
    gamutMapping: runReport.colorManagement.observedColorPipeline.gamutMapping,
    metrics: runReport.metrics,
    softProofHash: softProof.hash,
    softProofPath: softProof.path,
  };
}

function coverageMetrics(metrics: Array<{ name: string; value: number }>) {
  return {
    changedPixelRatio: metricValue(metrics, 'gamutMapperChangedPixelRatio'),
    inputPixelRatio: metricValue(metrics, 'gamutMapperInputPixelRatio'),
    postMapOutOfGamutPixelRatio: metricValue(metrics, 'gamutPostMapOutOfGamutPixelRatio'),
    preMapMaxLinearRgb: metricValue(metrics, 'gamutPreMapMaxLinearRgb'),
    preMapMinLinearRgb: metricValue(metrics, 'gamutPreMapMinLinearRgb'),
    preMapOutOfGamutChannelRatio: metricValue(metrics, 'gamutPreMapOutOfGamutChannelRatio'),
    preMapOutOfGamutPixelRatio: metricValue(metrics, 'gamutPreMapOutOfGamutPixelRatio'),
  };
}

function metricValue(metrics: Array<{ name: string; value: number }>, name: string): number {
  const metric = metrics.find((candidate) => candidate.name === name);
  if (metric === undefined) throw new Error(`missing metric ${name}`);
  return round(metric.value);
}

async function verifyArtifact(path: string, expectedHash: string) {
  const absolutePath = resolve(privateRoot, path);
  try {
    await access(absolutePath);
  } catch {
    failures.push(`missing artifact ${path}`);
    return;
  }
  const actualHash = hashBuffer(await readFile(absolutePath));
  if (!allowFreshHashes && actualHash !== expectedHash) failures.push(`hash mismatch for ${path}`);
}

async function writePngArtifact(path: string, rgb: Uint8Array, width: number, height: number): Promise<string> {
  const absolutePath = resolve(privateRoot, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  const png = encodePngRgb8(rgb, width, height);
  await writeFile(absolutePath, png);
  return hashBuffer(png);
}

function encodePngRgb8(rgb: Uint8Array, width: number, height: number): Buffer {
  const rowBytes = width * 3;
  if (rgb.length !== rowBytes * height) throw new Error('RGB buffer dimensions are invalid');
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (rowBytes + 1);
    scanlines[target] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * rowBytes, rowBytes).copy(scanlines, target + 1);
  }

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr(width, height)),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 2;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readPngRgb8(bytes: Buffer): { height: number; rgb: Uint8Array; width: number } {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Array<Buffer> = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (width <= 0 || height <= 0 || bitDepth !== 8 || channels === 0) {
    throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rowBytes = width * channels;
  const rows = new Uint8Array(height * rowBytes);
  let inputOffset = 0;
  let outputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++];
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputOffset++];
      const left = x >= channels ? rows[outputOffset + x - channels] : 0;
      const up = y > 0 ? rows[outputOffset + x - rowBytes] : 0;
      const upLeft = y > 0 && x >= channels ? rows[outputOffset + x - rowBytes - channels] : 0;
      rows[outputOffset + x] = unfilter(filter, raw, left, up, upLeft);
    }
    outputOffset += rowBytes;
  }

  const rgb = new Uint8Array(width * height * 3);
  for (let source = 0, target = 0; source < rows.length; source += channels, target += 3) {
    rgb[target] = rows[source];
    rgb[target + 1] = rows[source + 1];
    rgb[target + 2] = rows[source + 2];
  }
  return { height, rgb, width };
}

function unfilter(filter: number, raw: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return raw;
  if (filter === 1) return (raw + left) & 0xff;
  if (filter === 2) return (raw + up) & 0xff;
  if (filter === 3) return (raw + Math.floor((left + up) / 2)) & 0xff;
  if (filter === 4) return (raw + paeth(left, up, upLeft)) & 0xff;
  throw new Error(`unsupported PNG filter ${filter}`);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function rgb8ToLab(rgb: readonly [number, number, number]): Color {
  return new Color(
    'srgb',
    rgb.map((component) => component / 255),
  ).to('lab');
}

function metricSet(values: Array<number>) {
  return {
    max: round(maxValue(values)),
    p50: round(quantile(values, 0.5)),
    p95: round(quantile(values, 0.95)),
  };
}

function maxValue(values: Array<number>): number {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
}

function quantile(values: Array<number>, percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))] ?? 0;
}

function hueAngleDeltaDeg(left: unknown, right: unknown): number {
  if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) {
    return 0;
  }
  const rawDelta = Math.abs(left - right) % 360;
  return Math.min(rawDelta, 360 - rawDelta);
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
