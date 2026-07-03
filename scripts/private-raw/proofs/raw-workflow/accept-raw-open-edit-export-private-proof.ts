#!/usr/bin/env bun

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRawOpenEditExportProofManifest } from '../../../../src/schemas/rawOpenEditExportProofSchemas.ts';
import { parseRawOpenEditExportRunReportCollection } from '../../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const args = process.argv.slice(2);
const selfTest = args.includes('--self-test');
const runReportsPath = valueAfter('--run-reports');
const manifestPath =
  valueAfter('--manifest') ?? 'fixtures/validation/raw-open-edit-export/raw-open-edit-export-proof.json';
const outputPath = valueAfter('--output');

if (selfTest) {
  await runSelfTest();
  process.exit(0);
}

if (runReportsPath === undefined) {
  console.error(
    'Missing --run-reports <path>. Generate a private report first; committed run-report fixtures are not used.',
  );
  process.exit(1);
}

const manifest = parseRawOpenEditExportProofManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
const reports = parseRawOpenEditExportRunReportCollection(JSON.parse(await readFile(runReportsPath, 'utf8')));
const accepted = acceptPrivateReports(manifest, reports);

if (outputPath) {
  await writeFile(outputPath, `${JSON.stringify(accepted.manifest, null, 2)}\n`);
}

console.log(`raw open/edit/export private proof acceptance ok (${accepted.acceptedCount} accepted case(s))`);

function acceptPrivateReports(
  manifest: ReturnType<typeof parseRawOpenEditExportProofManifest>,
  reports: ReturnType<typeof parseRawOpenEditExportRunReportCollection>,
): { acceptedCount: number; manifest: ReturnType<typeof parseRawOpenEditExportProofManifest> } {
  const reportsByFixtureId = new Map(reports.reports.map((report) => [report.fixtureId, report]));
  let acceptedCount = 0;

  const updated = {
    ...manifest,
    proofCases: manifest.proofCases.map((proofCase) => {
      const report = reportsByFixtureId.get(proofCase.fixtureId);
      if (!report) return proofCase;

      acceptedCount += 1;
      return {
        ...proofCase,
        artifacts: report.artifacts,
        editGraphRevision: report.editGraphRevision,
        status: 'accepted_private_asset' as const,
      };
    }),
  };

  return { acceptedCount, manifest: parseRawOpenEditExportProofManifest(updated) };
}

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runSelfTest(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'rawengine-proof-acceptance-'));
  try {
    const manifestFile = join(directory, 'manifest.json');
    const reportsFile = join(directory, 'reports.json');
    await writeFile(manifestFile, JSON.stringify(sampleManifest(), null, 2));
    await writeFile(reportsFile, JSON.stringify(sampleReports(), null, 2));

    const manifest = parseRawOpenEditExportProofManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
    const reports = parseRawOpenEditExportRunReportCollection(JSON.parse(await readFile(reportsFile, 'utf8')));
    const accepted = acceptPrivateReports(manifest, reports);
    if (accepted.acceptedCount !== 1 || accepted.manifest.proofCases[0]?.status !== 'accepted_private_asset') {
      throw new Error('expected one accepted private RAW proof case');
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }

  console.log('raw open/edit/export private proof acceptance self-test ok');
}

function sampleManifest(): unknown {
  return {
    $schema: 'https://rawengine.dev/schemas/raw-open-edit-export-proof-v1.json',
    issue: 1376,
    proofCases: [
      {
        artifacts: sampleArtifacts(null),
        editGraphRevision: 'graph-rev.raw-open-edit-export.sample.v1',
        evidenceId: 'raw-evidence.detail.sample.v1',
        expectedMetrics: [
          { name: 'previewExportMeanAbsDelta', required: true, threshold: 0.015 },
          { name: 'softProofExportRgb8MeanAbsDelta', required: true, threshold: 0 },
          { name: 'sidecarReloadRevisionMatch', required: true, threshold: 1 },
          { name: 'sourceHashUnchanged', required: true, threshold: 1 },
        ],
        fixtureId: 'validation.raw-open-edit-export.sample.v1',
        localRelativePath: 'private-fixtures/detail/sample.cr3',
        notes: 'Self-test proof case.',
        status: 'pending_private_asset',
        trackingIssue: 1376,
        workflowSteps: [
          'open_raw',
          'apply_edit_graph',
          'render_preview',
          'export_image',
          'write_sidecar',
          'reload_sidecar',
        ],
      },
    ],
    schemaVersion: 1,
    snapshotDate: '2026-06-17',
    validationMode: 'schema_public_assets_private',
  };
}

function sampleReports(): unknown {
  const hash = `sha256:${'0'.repeat(64)}`;
  const artifacts = sampleArtifacts(hash);
  return {
    $schema: 'https://rawengine.dev/schemas/raw-open-edit-export-run-reports-v1.json',
    issue: 1829,
    reports: [
      {
        artifacts,
        colorManagement: sampleColorManagementProof(),
        editCommandId: 'command.raw-open-edit-export.basic-tone.v1',
        editGraphRevision: 'graph-rev.raw-open-edit-export.sample.v1',
        fixtureId: 'validation.raw-open-edit-export.sample.v1',
        generatedAt: '2026-06-17T00:00:00Z',
        metrics: [
          { name: 'changedPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 0.1 },
          {
            name: 'previewExportMeanAbsDelta',
            passed: true,
            source: 'private_raw_report',
            threshold: 0.015,
            value: 0.01,
          },
          {
            name: 'softProofExportRgb8MeanAbsDelta',
            passed: true,
            source: 'private_raw_report',
            threshold: 0,
            value: 0,
          },
          {
            name: 'finalFileBlackPointCompensationApplied',
            passed: true,
            source: 'private_raw_report',
            threshold: 0,
            value: 0,
          },
          { name: 'finalFileReopenSucceeded', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'finalFileBitDepth', passed: true, source: 'private_raw_report', threshold: 16, value: 16 },
          { name: 'finalFileColorEngineLcms2', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'finalFileIccProfileEmbedded', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'finalFileMetadataRetained', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'finalFileTimestampsPreserved', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'finalFileGpsStripped', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'finalFileTransformApplied', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'gamutMapperChangedPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
          { name: 'gamutMapperInputPixelRatio', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
          {
            name: 'gamutPostMapOutOfGamutPixelRatio',
            passed: true,
            source: 'private_raw_report',
            threshold: 0,
            value: 0,
          },
          { name: 'gamutPreMapMaxLinearRgb', passed: true, source: 'private_raw_report', threshold: 0, value: 1 },
          { name: 'gamutPreMapMinLinearRgb', passed: true, source: 'private_raw_report', threshold: 0, value: 0 },
          {
            name: 'gamutPreMapOutOfGamutChannelRatio',
            passed: true,
            source: 'private_raw_report',
            threshold: 0,
            value: 0,
          },
          {
            name: 'gamutPreMapOutOfGamutPixelRatio',
            passed: true,
            source: 'private_raw_report',
            threshold: 0,
            value: 0,
          },
          {
            name: 'finalFileSoftProofRgb8MeanAbsDelta',
            passed: true,
            source: 'private_raw_report',
            threshold: 0,
            value: 0,
          },
          {
            name: 'finalFileSoftProofRgb8MaxAbsDelta',
            passed: true,
            source: 'private_raw_report',
            threshold: 0,
            value: 0,
          },
          { name: 'sidecarReloadRevisionMatch', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
          { name: 'sourceHashUnchanged', passed: true, source: 'private_raw_report', threshold: 1, value: 1 },
        ],
        finalFile: {
          bitDepth: 16,
          blackPointCompensation: 'unsupported',
          cmm: 'lcms2',
          embeddedIccProfileHash: hash,
          expectedOutputProfileHash: hash,
          finalFileFormat: 'tiff',
          gpsStripped: true,
          metadataRetained: true,
          outputProfile: 'display_p3',
          pixelMaxAbsDelta: 0,
          pixelMeanAbsDelta: 0,
          reopenedDimensions: { height: 100, width: 100 },
          timestampsPreserved: true,
          transformApplied: true,
          transformPolicyFingerprint: hash,
          writerId: 'export_processing::save_image_with_metadata',
        },
        previewAfter: hashedPath(artifacts[2]),
        previewBefore: hashedPath(artifacts[1]),
        reportId: 'raw-open-edit-export-run.sample.v1',
        sidecarAfter: hashedPath(artifacts[4]),
        sourceRaw: hashedPath(artifacts[0]),
        trackingIssue: 1376,
      },
    ],
    schemaVersion: 1,
    snapshotDate: '2026-06-17',
    validationMode: 'public_schema_private_reports',
  };
}

function sampleArtifacts(hash: string | null): Array<Record<string, unknown>> {
  const asset = (kind: string, path: string) => ({ hash, kind, path, publicRepoAllowed: false });
  return [
    asset('source_raw_private', 'private-fixtures/detail/sample.cr3'),
    asset('preview_before_private', 'private-artifacts/validation/open-edit-export/sample-preview-before.png'),
    asset('preview_after_private', 'private-artifacts/validation/open-edit-export/sample-preview-after.png'),
    asset('export_after_private', 'private-artifacts/validation/open-edit-export/sample-export-after.tiff'),
    asset('sidecar_after_private', 'private-artifacts/validation/open-edit-export/sample-after.rrdata'),
    asset('workflow_report_private', 'private-artifacts/validation/open-edit-export/sample-workflow-report.json'),
  ];
}

function hashedPath(artifact: Record<string, unknown>): Record<string, unknown> {
  return {
    hash: artifact.hash,
    path: artifact.path,
    publicRepoAllowed: artifact.publicRepoAllowed,
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
      transferStatus: 'moxcms_rgb16_display_p3_final_file',
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
