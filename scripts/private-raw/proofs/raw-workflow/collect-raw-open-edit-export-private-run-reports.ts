#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { parseRawOpenEditExportRunReportCollection } from '../../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const REPORT_ROOT = 'private-artifacts/validation/open-edit-export';
const REPORT_SUFFIX = '-workflow-report.json';

const args = new Set(process.argv.slice(2));
const requireRoot = args.has('--require-root');
const selfTest = args.has('--self-test');
const rootArgIndex = process.argv.indexOf('--root');
const explicitRoot = rootArgIndex >= 0 ? process.argv[rootArgIndex + 1] : undefined;
const fixtureIdFilter = valueAfter('--fixture-id');
const outputPath = valueAfter('--output');

if (selfTest) {
  await runSelfTest();
  process.exit(0);
}

const privateRoot = explicitRoot ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (!privateRoot) {
  if (requireRoot) {
    console.error('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-root.');
    process.exit(1);
  }
  console.log('raw open/edit/export private report collection skipped (RAWENGINE_PRIVATE_RAW_ROOT unset)');
  process.exit(0);
}

const collection = await collectPrivateRunReports(privateRoot);
if (outputPath !== undefined) {
  await writeFile(outputPath, `${JSON.stringify(collection, null, 2)}\n`);
}
console.log(`raw open/edit/export private reports ok (${collection.reports.length} report(s))`);

async function collectPrivateRunReports(
  privateRoot: string,
): Promise<ReturnType<typeof parseRawOpenEditExportRunReportCollection>> {
  const root = resolve(privateRoot);
  const reportPaths = await findReportFiles(join(root, REPORT_ROOT));
  const reports = [];

  for (const reportPath of reportPaths) {
    const relativeReportPath = relative(root, reportPath).split(sep).join('/');
    const raw = await readFile(reportPath);
    const report = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    reports.push(normalizeWorkflowReport(report, relativeReportPath, sha256(raw)));
  }

  return parseRawOpenEditExportRunReportCollection({
    $schema: 'https://rawengine.dev/schemas/raw-open-edit-export-run-reports-v1.json',
    issue: 1829,
    reports: fixtureIdFilter === undefined ? reports : reports.filter((report) => report.fixtureId === fixtureIdFilter),
    schemaVersion: 1,
    snapshotDate: new Date().toISOString().slice(0, 10),
    validationMode: 'public_schema_private_reports',
  });
}

async function findReportFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const reports = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      reports.push(...(await findReportFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(REPORT_SUFFIX)) {
      reports.push(path);
    }
  }
  return reports.sort();
}

function normalizeWorkflowReport(
  report: Record<string, unknown>,
  relativeReportPath: string,
  reportHash: string,
): Record<string, unknown> {
  const artifacts = Array.isArray(report.artifacts) ? [...report.artifacts] : [];
  const hasWorkflowArtifact = artifacts.some(
    (artifact) =>
      typeof artifact === 'object' &&
      artifact !== null &&
      'kind' in artifact &&
      artifact.kind === 'workflow_report_private',
  );

  if (!hasWorkflowArtifact) {
    artifacts.push({
      hash: reportHash,
      kind: 'workflow_report_private',
      path: relativeReportPath,
      publicRepoAllowed: false,
    });
  }

  return { ...report, artifacts };
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function runSelfTest(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rawengine-private-reports-'));
  try {
    const reportDir = join(root, REPORT_ROOT);
    const reportPath = join(reportDir, 'sample-v1-workflow-report.json');
    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(sampleReport(), null, 2));
    const collection = await collectPrivateRunReports(root);
    if (collection.reports.length !== 1) {
      throw new Error(`expected 1 collected report, found ${collection.reports.length}`);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  console.log('raw open/edit/export private report collector self-test ok');
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sampleReport(): Record<string, unknown> {
  const hash = `sha256:${'0'.repeat(64)}`;
  const asset = (path: string) => ({ hash, path, publicRepoAllowed: false });
  const sourceRaw = asset('private-fixtures/detail/sample.cr3');
  const previewBefore = asset(`${REPORT_ROOT}/sample-v1-preview-before.png`);
  const previewAfter = asset(`${REPORT_ROOT}/sample-v1-preview-after.png`);
  const exportAfter = asset(`${REPORT_ROOT}/sample-v1-export-after.tiff`);
  const sidecarAfter = asset(`${REPORT_ROOT}/sample-v1-after.rrdata`);

  return {
    artifacts: [
      { ...sourceRaw, kind: 'source_raw_private' },
      { ...previewBefore, kind: 'preview_before_private' },
      { ...previewAfter, kind: 'preview_after_private' },
      { ...exportAfter, kind: 'export_after_private' },
      { ...sidecarAfter, kind: 'sidecar_after_private' },
    ],
    colorManagement: sampleColorManagementProof(),
    editCommandId: 'command.raw-open-edit-export.basic-tone.v1',
    editGraphRevision: 'graph-rev.raw-open-edit-export.sample.v1',
    fixtureId: 'validation.raw-open-edit-export.sample.v1',
    generatedAt: '2026-06-17T00:00:00Z',
    metrics: [
      { name: 'changedPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 0.1 },
      {
        name: 'finalFileBlackPointCompensationApplied',
        passed: true,
        source: 'private_raw_report',
        threshold: 1,
        value: 1,
      },
      { name: 'previewExportMeanAbsDelta', passed: true, source: 'private_raw_report', threshold: 0.015, value: 0.01 },
      { name: 'softProofExportRgb8MeanAbsDelta', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
      { name: 'gamutMapperInputPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 1 },
      { name: 'gamutMapperChangedPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 0.02 },
      {
        name: 'gamutPreMapOutOfGamutPixelRatio',
        passed: true,
        source: 'private_raw_report',
        threshold: 0,
        value: 0.02,
      },
      {
        name: 'gamutPreMapOutOfGamutChannelRatio',
        passed: true,
        source: 'private_raw_report',
        threshold: 0,
        value: 0.01,
      },
      {
        name: 'gamutPostMapOutOfGamutPixelRatio',
        passed: true,
        source: 'private_raw_report',
        threshold: 0,
        value: 0,
      },
      { name: 'gamutPreMapMinLinearRgb', passed: true, source: 'private_raw_report', threshold: 0, value: -0.01 },
      { name: 'gamutPreMapMaxLinearRgb', passed: true, source: 'private_raw_report', threshold: 1, value: 1.1 },
      { name: 'finalFileReopenSucceeded', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
      { name: 'finalFileBitDepth', passed: true, source: 'private_raw_report', threshold: 16, value: 16 },
      { name: 'finalFileColorEngineLcms2', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
      { name: 'finalFileIccProfileEmbedded', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
      {
        name: 'finalFileSoftProofRgb8MeanAbsDelta',
        passed: true,
        source: 'private_raw_report',
        threshold: 0,
        value: 0,
      },
      { name: 'finalFileSoftProofRgb8MaxAbsDelta', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
      { name: 'finalFileTransformApplied', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
      { name: 'sidecarReloadRevisionMatch', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
      { name: 'sourceHashUnchanged', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
    ],
    finalFile: {
      bitDepth: 16,
      blackPointCompensation: 'Enabled via LittleCMS relative colorimetric transform',
      cmm: 'lcms2',
      embeddedIccProfileHash: hash,
      expectedOutputProfileHash: hash,
      finalFileFormat: 'tiff',
      outputProfile: 'display_p3',
      pixelMaxAbsDelta: 0,
      pixelMeanAbsDelta: 0,
      reopenedDimensions: { height: 100, width: 100 },
      transformApplied: true,
      transformPolicyFingerprint: hash,
      writerId: 'export_processing::save_image_with_metadata',
    },
    previewAfter,
    previewBefore,
    reportId: 'raw-open-edit-export-run.sample.v1',
    sidecarAfter,
    sourceRaw,
    trackingIssue: 1376,
  };
}

function sampleColorManagementProof(): Record<string, unknown> {
  return {
    conformance: 'partial',
    decoderTrace: {
      cameraCalibration: {
        applied: 'not_surfaced_by_current_decoder_trace',
        presence: 'not_surfaced_by_current_decoder_trace',
        source: 'raw_open_edit_export_validation_spine',
      },
      cameraMake: 'Synthetic',
      cameraModel: 'Synthetic RAW',
      decodedDimensions: { height: 100, width: 100 },
      privacySafeCameraId: 'camera.raw-open-edit-export.sample.v1',
      rawFormat: 'cr3',
      sourceHash: `sha256:${'0'.repeat(64)}`,
      whiteBalance: {
        applied: 'not_surfaced_by_current_decoder_trace',
        presence: 'not_surfaced_by_current_decoder_trace',
        source: 'raw_open_edit_export_validation_spine',
      },
    },
    doesNotProve: [
      'acescg_working_space',
      'bradford_chromatic_adaptation',
      'camera_profile_quality',
      'capture_one_class_quality',
      'display_device_visual_match',
      'gpu_color_parity',
      'icc_colorimetric_accuracy',
    ],
    observedColorPipeline: {
      bitDepth: 16,
      cmmUsed: true,
      displayProfileCorrectness: 'not_proven',
      exportColorEncoding: 'display_p3_rgb16_tiff',
      exportFormat: 'tiff',
      gamutMapping: 'not_proven',
      iccProfileEmbedded: true,
      inputDomain: 'decoder_camera_rgb_observed',
      operationDomain: 'linear_srgb_d65_observed',
      outputProfile: 'display_p3',
      renderingIntentApplied: true,
      sceneToDisplayTransform: 'rawengine_agx_v1',
      transferStatus: 'lcms2_bpc_rgb16_display_p3_final_file',
      viewTransform: 'rawengine_agx_v1',
      workingBuffer: 'linear_srgb_d65_observed',
    },
    proofLevel: 'private_raw_runtime_color_management_metadata',
    requestedColorPipeline: {
      chromaticAdaptation: {
        method: 'bradford_v1',
        sourceWhitePoint: { x: 0.3457, y: 0.3585 },
        status: 'math_validated',
        targetWhitePoint: { x: 0.32168, y: 0.33767 },
        warnings: [],
      },
      inputDomain: 'camera_linear_rgb',
      operationDomain: 'acescg_linear_v1',
      renderTarget: {
        bitDepth: 16,
        embedIcc: true,
        intent: 'relative_colorimetric',
        outputProfile: 'display_p3',
        viewTransform: 'rawengine_agx_v1',
      },
      sceneToDisplayTransform: 'rawengine_agx_v1',
      workingSpace: 'acescg_linear_v1',
    },
    runtimeEnvironment: {
      wgpuAdapter: 'not_surfaced_by_current_proof',
      wgpuBackend: 'not_surfaced_by_current_proof',
    },
    trackingIssue: 2308,
    warnings: [
      'Final TIFF proof verifies Display P3 ICC embedding and RGB16 file reopen, but not full chart-based colorimetric accuracy.',
      'Black-point compensation remains unsupported by the active CMM path and is not claimed.',
    ],
  };
}
