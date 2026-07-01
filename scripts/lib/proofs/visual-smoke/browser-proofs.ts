import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

import { layerMaskExportParityReceiptSchema } from '../../../../src/utils/layers/layerMaskExportParityReceipt.ts';
import { readJpegDataUrl, readLayerMaskPreviewDataUrl, readPngDataUrl, sha256File } from './capture-plumbing.ts';

export interface SrPrivateRawBrowserProof {
  artifactRoot: string;
  detailGainRatio: string;
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  exportReviewHash: string;
  fixtureId: string;
  outputArtifactScore: string;
  outputHeight: string;
  outputPixelCount: string;
  outputScale: string;
  outputWidth: string;
  previewArtifact: string;
  previewDataUrl: string;
  previewHash: string;
  privateRunReportPath: string;
  reconstructionPath: string;
  reconstructionHash: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  resultReviewHash: string;
  sourceCoverageRatio: string;
  sourceCount: string;
  sourceHashes: string;
  sourceHeights: string;
  sourcePaths: string;
  sourceWidths: string;
}

export interface FocusPrivateRawBrowserProof {
  artifactRoot: string;
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  fixtureId: string;
  previewArtifact: string;
  previewDataUrl: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  sourceCount: string;
  stackHash: string;
  stackPath: string;
}

export interface HdrPrivateRawBrowserProof {
  afterArtifact: string;
  afterDataUrl: string;
  beforeArtifact: string;
  beforeDataUrl: string;
  exportArtifact: string;
  fixtureId: string;
  mergeArtifact: string;
  previewArtifact: string;
  previewDataUrl: string;
  sourceCount: string;
}

export interface PanoramaPrivateRawBrowserProof {
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  fixtureId: string;
  panoramaPath: string;
  previewArtifact: string;
  previewDataUrl: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  sourceCount: string;
}

export interface LayerMaskPrivateRawBrowserProof {
  changedPixelRatio: string;
  exportArtifact: string;
  exportParityReceipt: z.infer<typeof layerMaskExportParityReceiptSchema>;
  finalExportHash: string;
  fixtureId: string;
  metricCount: string;
  refinedMaskContentHash: string;
  refinedPreviewArtifact: string;
  refinedPreviewDataUrl: string;
  refinedPreviewHash: string;
  sourceGraphRevision: string;
  unmaskedPreviewArtifact: string;
  unmaskedPreviewDataUrl: string;
  unmaskedPreviewHash: string;
  unrefinedPreviewArtifact: string;
  unrefinedPreviewDataUrl: string;
  unrefinedPreviewHash: string;
}

export interface NegativeLabPublicExportBrowserProof {
  appliedProfileClaimPolicy: string;
  appliedProfileDisplayName: string;
  appliedProfilePresetId: string;
  appliedProfileProvenanceHash: string;
  baseFogSample: string;
  baseFogStrength: string;
  changedPixelRatio: string;
  densityWeights: string;
  exportPlanId: string;
  fixtureId: string;
  outputDataUrl: string;
  outputFormat: string;
  outputPath: string;
  runtimeStatus: string;
  sourceDataUrl: string;
  sourcePath: string;
}

export interface NegativeLabRealRawPrivateBrowserProof {
  changedPixelRatio: string;
  fixtureId: string;
  inputToOutputMeanAbsDelta: string;
  outputDataUrl: string;
  outputFormat: string;
  outputPath: string;
  proofBoundary: string;
  proofStatus: string;
  sourceIsRaw: string;
  sourcePath: string;
}

const negativeLabPublicExportReportSchema = z
  .object({
    appliedProfile: z
      .object({
        claimPolicy: z.literal('generic_starting_point_no_stock_claim'),
        displayName: z.literal('C-41 Portrait'),
        presetId: z.literal('negative_lab.generic.c41.portrait.v1'),
        profileProvenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      })
      .passthrough(),
    controlSurface: z
      .object({
        baseFog: z
          .object({
            sampleRect: z.object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() }).passthrough(),
            strength: z.number(),
          })
          .passthrough(),
        density: z
          .object({
            blueWeight: z.number(),
            greenWeight: z.number(),
            redWeight: z.number(),
          })
          .passthrough(),
        export: z
          .object({
            acceptedDryRunPlanId: z.string().trim().min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

declare global {
  interface Window {
    __RAWENGINE_FOCUS_PRIVATE_RAW_PROOF__?: FocusPrivateRawBrowserProof;
    __RAWENGINE_HDR_PRIVATE_RAW_PROOF__?: HdrPrivateRawBrowserProof;
    __RAWENGINE_LAYER_MASK_PRIVATE_RAW_PROOF__?: LayerMaskPrivateRawBrowserProof;
    __RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF__?: NegativeLabPublicExportBrowserProof;
    __RAWENGINE_NEGATIVE_LAB_REAL_RAW_PRIVATE_PROOF__?: NegativeLabRealRawPrivateBrowserProof;
    __RAWENGINE_PANORAMA_PRIVATE_RAW_PROOF__?: PanoramaPrivateRawBrowserProof;
    __RAWENGINE_SR_PRIVATE_RAW_PROOF__?: SrPrivateRawBrowserProof;
  }
}

const privateArtifactSchema = z
  .object({
    hash: z
      .string()
      .trim()
      .regex(/^sha256:[a-f0-9]{64}$/u),
    kind: z.string().trim().min(1),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .passthrough();

const privateScreenshotArtifactSchema = z
  .object({
    hash: z
      .string()
      .trim()
      .regex(/^sha256:[a-f0-9]{64}$/u),
    label: z.string().trim().min(1),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .passthrough();

const srPrivateRunReportSchema = z
  .object({
    reports: z
      .array(
        z
          .object({
            acceptanceStatus: z.literal('runtime_apply_capable'),
            artifacts: z.array(privateArtifactSchema),
            fixtureId: z.literal('validation.computational-merge.super-resolution-subpixel.v1'),
            runId: z.string().trim().min(1),
            screenshotArtifacts: z.array(privateScreenshotArtifactSchema),
            sourceHashes: z
              .array(
                z
                  .object({
                    hash: z
                      .string()
                      .trim()
                      .regex(/^sha256:[a-f0-9]{64}$/u),
                    localRelativePath: z.string().trim().min(1),
                    path: z.string().trim().min(1),
                    publicRepoAllowed: z.literal(false),
                  })
                  .passthrough(),
              )
              .length(4),
            superResolutionQualityReadout: z
              .object({
                artifactScore: z.number().min(0),
                detailGainRatio: z.number().min(0),
                outputArtifactHash: z
                  .string()
                  .trim()
                  .regex(/^sha256:[a-f0-9]{64}$/u),
                outputArtifactPath: z.string().trim().min(1),
                outputPixelCount: z.number().int().positive(),
                registrationResidualPx: z.number().min(0),
                sourceCount: z.number().int().min(2),
                sourceCoverageRatio: z.number().min(0).max(1),
              })
              .strict(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const srDecodeReportSchema = z
  .object({
    decodedSources: z
      .array(
        z
          .object({
            contentHash: z
              .string()
              .trim()
              .regex(/^sha256:[a-f0-9]{64}$/u),
            height: z.number().int().positive(),
            localRelativePath: z.string().trim().min(1),
            width: z.number().int().positive(),
          })
          .passthrough(),
      )
      .length(4),
    fixtureId: z.literal('validation.computational-merge.super-resolution-subpixel.v1'),
  })
  .passthrough();

const srRegistrationReportSchema = z
  .object({
    fixtureId: z.literal('validation.computational-merge.super-resolution-subpixel.v1'),
    frames: z.array(z.object({ sourceIndex: z.number().int().nonnegative() }).passthrough()).length(4),
    outputHeight: z.number().int().positive(),
    outputScale: z.number().min(1.1).max(4),
    outputWidth: z.number().int().positive(),
  })
  .passthrough();

const srAppServerProofSchema = z
  .object({
    fixtureId: z.literal('validation.computational-merge.super-resolution-subpixel.v1'),
    runtimeStatus: z.literal('apply_rendered'),
    sourceCount: z.literal(4),
  })
  .passthrough();

async function readJpegDataUrl(path) {
  const buffer = await readFile(path);
  if (buffer.toString('hex', 0, 2) !== 'ffd8') {
    throw new Error(`${path} is not a JPEG file.`);
  }
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

export async function loadSrPrivateRawProof(): Promise<SrPrivateRawBrowserProof> {
  const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root';
  const artifactRoot = `${privateRoot}/private-artifacts/validation/computational-merge`;
  const privateRunReportPath = `${artifactRoot}/sr-subpixel-private-run-report.json`;
  await ensureSrPrivateQualityReadout(privateRoot, privateRunReportPath);
  const privateRunReport = srPrivateRunReportSchema.parse(JSON.parse(await readFile(privateRunReportPath, 'utf8')));
  const report = privateRunReport.reports[0];
  if (report === undefined) throw new Error('SR private run report did not include a report.');
  const decodeReport = srDecodeReportSchema.parse(
    JSON.parse(await readFile(`${artifactRoot}/sr-subpixel-decode-report.json`, 'utf8')),
  );
  const registrationReport = srRegistrationReportSchema.parse(
    JSON.parse(await readFile(`${artifactRoot}/sr-subpixel-registration.json`, 'utf8')),
  );
  srAppServerProofSchema.parse(
    JSON.parse(await readFile(`${artifactRoot}/sr-subpixel-app-server-runtime-proof.json`, 'utf8')),
  );

  const sourcePaths = decodeReport.decodedSources.map((source) => source.localRelativePath);
  const sourceHashes = decodeReport.decodedSources.map((source) => source.contentHash);
  const sourceHashesFromRun = report.sourceHashes.map((source) => source.hash);
  if (new Set(sourcePaths).size !== 4 || new Set(sourceHashes).size !== 4) {
    throw new Error('SR private proof expected four unique decoded sources.');
  }
  if (sourceHashes.some((hash, index) => hash !== sourceHashesFromRun[index])) {
    throw new Error('SR private decode hashes do not match private run source hashes.');
  }

  const artifactByKind = new Map(report.artifacts.map((artifact) => [artifact.kind, artifact]));
  const screenshotByLabel = new Map(report.screenshotArtifacts.map((artifact) => [artifact.label, artifact]));
  const reconstructionArtifact = artifactByKind.get('merge_output_private');
  const previewArtifactReport = artifactByKind.get('preview_after_private');
  const resultReviewArtifactReport = screenshotByLabel.get('result_review');
  const exportReviewArtifactReport = screenshotByLabel.get('export_review');
  if (
    reconstructionArtifact === undefined ||
    previewArtifactReport === undefined ||
    resultReviewArtifactReport === undefined ||
    exportReviewArtifactReport === undefined
  ) {
    throw new Error('SR private proof report is missing required reconstruction/review artifacts.');
  }

  const previewArtifact = `${artifactRoot}/sr-subpixel-preview.png`;
  const resultReviewArtifact = `${artifactRoot}/sr-subpixel-result-review.png`;
  const exportReviewArtifact = `${artifactRoot}/sr-subpixel-export-review.png`;
  const reconstructionPath = `${artifactRoot}/sr-subpixel-reconstruction.tiff`;
  const previewHash = await sha256File(previewArtifact);
  const resultReviewHash = await sha256File(resultReviewArtifact);
  const exportReviewHash = await sha256File(exportReviewArtifact);
  const reconstructionHash = await sha256File(reconstructionPath);
  if (
    previewHash !== previewArtifactReport.hash ||
    resultReviewHash !== resultReviewArtifactReport.hash ||
    exportReviewHash !== exportReviewArtifactReport.hash ||
    reconstructionHash !== reconstructionArtifact.hash
  ) {
    throw new Error('SR private proof artifact hashes do not match the private run report.');
  }
  if (
    report.superResolutionQualityReadout.outputArtifactHash !== reconstructionArtifact.hash ||
    report.superResolutionQualityReadout.outputArtifactPath !== reconstructionArtifact.path
  ) {
    throw new Error('SR private proof quality readout is not tied to the reconstruction artifact.');
  }
  const qualityReadout = report.superResolutionQualityReadout;

  return {
    artifactRoot,
    detailGainRatio: String(qualityReadout.detailGainRatio),
    exportReviewArtifact,
    exportReviewDataUrl: await readPngDataUrl(exportReviewArtifact),
    exportReviewHash,
    fixtureId: 'validation.computational-merge.super-resolution-subpixel.v1',
    outputArtifactScore: String(qualityReadout.artifactScore),
    outputHeight: String(registrationReport.outputHeight),
    outputPixelCount: String(qualityReadout.outputPixelCount),
    outputScale: String(registrationReport.outputScale),
    outputWidth: String(registrationReport.outputWidth),
    previewArtifact,
    previewDataUrl: await readPngDataUrl(previewArtifact),
    previewHash,
    privateRunReportPath,
    reconstructionHash,
    reconstructionPath,
    resultReviewArtifact,
    resultReviewDataUrl: await readPngDataUrl(resultReviewArtifact),
    resultReviewHash,
    sourceCoverageRatio: String(qualityReadout.sourceCoverageRatio),
    sourceCount: '4',
    sourceHashes: sourceHashes.join(','),
    sourceHeights: decodeReport.decodedSources.map((source) => String(source.height)).join(','),
    sourcePaths: sourcePaths.join(','),
    sourceWidths: decodeReport.decodedSources.map((source) => String(source.width)).join(','),
  };
}

async function ensureSrPrivateQualityReadout(privateRoot: string, privateRunReportPath: string): Promise<void> {
  const privateRunReport = JSON.parse(await readFile(privateRunReportPath, 'utf8'));
  if (privateRunReport?.reports?.[0]?.superResolutionQualityReadout !== undefined) return;

  await new Promise<void>((resolveProof, rejectProof) => {
    const child = spawn('bun', ['run', 'check:sr-real-raw-private-app-server-proof'], {
      env: { ...process.env, RAWENGINE_PRIVATE_RAW_ROOT: privateRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const captureOutput = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-2_000);
    };
    child.stdout.on('data', captureOutput);
    child.stderr.on('data', captureOutput);
    child.once('error', rejectProof);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveProof();
        return;
      }

      rejectProof(
        new Error(
          `SR private app-server proof could not upgrade ${privateRunReportPath}: ${output.trim() || `exit ${code}`}`,
        ),
      );
    });
  });
}

export async function loadFocusPrivateRawProof(): Promise<FocusPrivateRawBrowserProof> {
  const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root';
  const artifactRoot = `${privateRoot}/private-artifacts/validation/computational-merge`;
  const previewArtifact = `${artifactRoot}/focus-plane-preview.png`;
  const resultReviewArtifact = `${artifactRoot}/focus-plane-result-review.png`;
  const exportReviewArtifact = `${artifactRoot}/focus-plane-export-review.png`;
  return {
    artifactRoot,
    exportReviewArtifact,
    exportReviewDataUrl: await readPngDataUrl(exportReviewArtifact),
    fixtureId: 'validation.computational-merge.focus-plane-transition.v1',
    previewArtifact,
    previewDataUrl: await readPngDataUrl(previewArtifact),
    resultReviewArtifact,
    resultReviewDataUrl: await readPngDataUrl(resultReviewArtifact),
    sourceCount: '3',
    stackHash: await sha256File(`${artifactRoot}/focus-plane-merge.tiff`),
    stackPath: `${artifactRoot}/focus-plane-merge.tiff`,
  };
}

export async function loadHdrPrivateRawProof(): Promise<HdrPrivateRawBrowserProof> {
  const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root';
  const artifactRoot = `${privateRoot}/private-artifacts/validation/computational-merge`;
  const beforeArtifact = `${artifactRoot}/hdr-bracket-modal-before.png`;
  const afterArtifact = `${artifactRoot}/hdr-bracket-modal-after.png`;
  const previewArtifact = `${artifactRoot}/hdr-bracket-preview.png`;
  return {
    afterArtifact,
    afterDataUrl: await readPngDataUrl(afterArtifact),
    beforeArtifact,
    beforeDataUrl: await readPngDataUrl(beforeArtifact),
    exportArtifact: `${artifactRoot}/hdr-bracket-export.tiff`,
    fixtureId: 'validation.computational-merge.hdr-bracket-alignment.v1',
    mergeArtifact: `${artifactRoot}/hdr-bracket-merge.tiff`,
    previewArtifact,
    previewDataUrl: await readPngDataUrl(previewArtifact),
    sourceCount: '3',
  };
}

export async function loadPanoramaPrivateRawProof(): Promise<PanoramaPrivateRawBrowserProof> {
  const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root';
  const artifactRoot = `${privateRoot}/private-artifacts/validation/computational-merge`;
  const previewArtifact = `${artifactRoot}/panorama-overlap-preview.png`;
  const resultReviewArtifact = `${artifactRoot}/panorama-overlap-result-review.png`;
  const exportReviewArtifact = `${artifactRoot}/panorama-overlap-export-review.png`;
  return {
    exportReviewArtifact,
    exportReviewDataUrl: await readPngDataUrl(exportReviewArtifact),
    fixtureId: 'validation.computational-merge.panorama-overlap.v1',
    panoramaPath: `${artifactRoot}/panorama-overlap-merge.tiff`,
    previewArtifact,
    previewDataUrl: await readPngDataUrl(previewArtifact),
    resultReviewArtifact,
    resultReviewDataUrl: await readPngDataUrl(resultReviewArtifact),
    sourceCount: '3',
  };
}

export async function loadLayerMaskPrivateRawProof(): Promise<LayerMaskPrivateRawBrowserProof> {
  const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root';
  const runtimeReport = z
    .object({
      exportParityReceipt: layerMaskExportParityReceiptSchema,
    })
    .passthrough()
    .parse(
      JSON.parse(
        await readFile('docs/validation/proofs/layers-masks/layer-mask-real-raw-proof-2026-06-18.json', 'utf8'),
      ),
    );
  const { exportParityReceipt } = runtimeReport;
  const unmaskedPreviewArtifact =
    'private-artifacts/validation/layer-mask-real-raw/alaska-layer-mask-v1-unmasked-preview.png';
  const unrefinedPreviewArtifact =
    'private-artifacts/validation/layer-mask-real-raw/alaska-layer-mask-v1-unrefined-preview.png';
  const refinedPreviewArtifact = exportParityReceipt.refinedPreviewArtifactPath;
  return {
    changedPixelRatio: String(exportParityReceipt.changedPixelRatio),
    exportArtifact: exportParityReceipt.exportArtifactPath,
    exportParityReceipt,
    finalExportHash: exportParityReceipt.finalExportHash,
    fixtureId: exportParityReceipt.fixtureId,
    metricCount: String(exportParityReceipt.metricCount),
    refinedMaskContentHash: exportParityReceipt.refinedMaskContentHash,
    refinedPreviewArtifact,
    refinedPreviewDataUrl: await readLayerMaskPreviewDataUrl(resolve(privateRoot, refinedPreviewArtifact)),
    refinedPreviewHash: exportParityReceipt.refinedPreviewHash,
    sourceGraphRevision: exportParityReceipt.sourceGraphRevision,
    unmaskedPreviewArtifact,
    unmaskedPreviewDataUrl: await readLayerMaskPreviewDataUrl(resolve(privateRoot, unmaskedPreviewArtifact)),
    unmaskedPreviewHash: exportParityReceipt.unmaskedPreviewHash,
    unrefinedPreviewArtifact,
    unrefinedPreviewDataUrl: await readLayerMaskPreviewDataUrl(resolve(privateRoot, unrefinedPreviewArtifact)),
    unrefinedPreviewHash: exportParityReceipt.unrefinedPreviewHash,
  };
}

export async function loadNegativeLabPublicExportProof(): Promise<NegativeLabPublicExportBrowserProof> {
  const sourcePath = 'fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg';
  const outputPath =
    'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg';
  const report = negativeLabPublicExportReportSchema.parse(
    JSON.parse(
      await readFile('docs/validation/proofs/negative-lab/negative-lab-public-export-proof-2026-06-20.json', 'utf8'),
    ),
  );
  return {
    appliedProfileClaimPolicy: report.appliedProfile.claimPolicy,
    appliedProfileDisplayName: report.appliedProfile.displayName,
    appliedProfilePresetId: report.appliedProfile.presetId,
    appliedProfileProvenanceHash: report.appliedProfile.profileProvenanceHash,
    baseFogSample: `${report.controlSurface.baseFog.sampleRect.x},${report.controlSurface.baseFog.sampleRect.y},${report.controlSurface.baseFog.sampleRect.width},${report.controlSurface.baseFog.sampleRect.height}`,
    baseFogStrength: String(report.controlSurface.baseFog.strength),
    changedPixelRatio: '1',
    densityWeights: `${report.controlSurface.density.redWeight},${report.controlSurface.density.greenWeight},${report.controlSurface.density.blueWeight}`,
    exportPlanId: report.controlSurface.export.acceptedDryRunPlanId,
    fixtureId: 'negative_lab.real.public.cc0_110_ericht_negative_001',
    outputDataUrl: await readJpegDataUrl(outputPath),
    outputFormat: 'jpeg_proof',
    outputPath,
    runtimeStatus: 'public_negative_scan_positive_export_rendered',
    sourceDataUrl: await readJpegDataUrl(sourcePath),
    sourcePath,
  };
}

export async function loadNegativeLabRealRawPrivateProof(): Promise<NegativeLabRealRawPrivateBrowserProof> {
  const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-negative-lab-alaska-proof';
  const report = z
    .object({
      fixtureId: z.literal('validation.negative-lab-real-raw.alaska.v1'),
      localRawRuntime: z
        .object({
          metrics: z
            .object({
              changedPixelRatio: z.number().gt(0.05),
              inputToOutputMeanAbsDelta: z.number().gt(0.01),
            })
            .passthrough(),
        })
        .passthrough(),
      proofBoundary: z.literal('private_raw_negative_lab_runtime_not_final_negative_quality'),
      proofStatus: z.literal('private_raw_negative_lab_positive_export_rendered'),
      sourceRaw: z
        .object({
          localPath: z.literal('private-fixtures/negative-lab/alaska-negative-lab-v1.arw'),
        })
        .passthrough(),
      workflowArtifacts: z
        .array(
          z
            .object({
              kind: z.enum([
                'source_raw_private',
                'positive_jpeg_private',
                'sidecar_private',
                'conversion_bundle_private',
              ]),
              path: z.string().trim().min(1),
            })
            .passthrough(),
        )
        .length(4),
    })
    .parse(
      JSON.parse(
        await readFile(
          'docs/validation/proofs/negative-lab/negative-lab-real-raw-private-proof-2026-06-22.json',
          'utf8',
        ),
      ),
    );
  const outputArtifact = report.workflowArtifacts.find((artifact) => artifact.kind === 'positive_jpeg_private');
  if (outputArtifact === undefined) throw new Error('Negative Lab private RAW output artifact missing.');
  return {
    changedPixelRatio: String(report.localRawRuntime.metrics.changedPixelRatio),
    fixtureId: report.fixtureId,
    inputToOutputMeanAbsDelta: String(report.localRawRuntime.metrics.inputToOutputMeanAbsDelta),
    outputDataUrl: await readJpegDataUrl(resolve(privateRoot, outputArtifact.path)),
    outputFormat: 'jpeg_proof',
    outputPath: outputArtifact.path,
    proofBoundary: report.proofBoundary,
    proofStatus: report.proofStatus,
    sourceIsRaw: 'true',
    sourcePath: report.sourceRaw.localPath,
  };
}
