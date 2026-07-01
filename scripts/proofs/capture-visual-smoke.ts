import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Locator } from '@playwright/test';

import { format } from 'prettier';
import { z } from 'zod';
import {
  BrushMaskCommandRuntime,
  renderBrushMask,
} from '../../packages/rawengine-schema/src/brushMaskCommandRuntime.ts';
import {
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  toneColorCommandEnvelopeV1Schema,
} from '../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleToneColorCommandEnvelopeV1 } from '../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  buildBrushMaskCommandFromParameters,
} from '../../src/utils/mask/brushMaskCommandBridge.ts';
import { NegativeLabAppServerCommandName } from '../../src/utils/negative-lab/app-server/negativeLabAppServerCommandNames.ts';
import {
  VISUAL_SMOKE_PROOF_TEST_IDS,
  VISUAL_SMOKE_SCENARIO_IDS,
  VISUAL_SMOKE_SCENARIOS,
} from '../../src/validation/visual/visualSmokeScenarios.ts';
import {
  agentArtifactReviewProofDatasetSchema,
  agentAuditTranscriptViewerProofDatasetSchema,
  agentChatProofDatasetSchema,
  agentDryRunReviewProofDatasetSchema,
  agentLivePromptComposerProofDatasetSchema,
  agentLivePromptResultProofDatasetSchema,
  agentPrivateRawArtifactsProofDatasetSchema,
  agentReviewHandoffProofDatasetSchema,
  agentSelectedFrameScopeProofDatasetSchema,
  assertFilmLookExportProof,
  assertNegativeLabBaseFogPreviewExportProof,
  assertNegativeLabBatchColorInvokeProof,
  assertNegativeLabInvokeProof,
  blackWhiteMixerParityProofDatasetSchema,
  cameraProfileInputTransformPreviewProofSchema,
  colorBalanceCompareProofDatasetSchema,
  commandPaletteWorkflowProofSchema,
  detailDustSpotProofSchema,
  detailWorkspaceProofSchema,
  focusPrivateRawReviewProofSchema,
  focusReviewWorkspaceProofSchema,
  focusUiSettingsProofSchema,
  hdrBracketSourceRolesProofSchema,
  hdrDeghostReviewGateProofSchema,
  hdrPrivateRawReviewProofSchema,
  hdrReviewWorkspaceProofSchema,
  hdrUiSettingsProofSchema,
  layerMaskPrivateRawReviewProofSchema,
  layerStackExportParityProofSchema,
  layerStackWorkflowProofSchema,
  libraryWorkflowProofSchema,
  maskOverlayRawProofSchema,
  negativeLabPublicExportReviewProofSchema,
  negativeLabRealRawPrivateReviewProofSchema,
  negativeLabRollQueueSummaryProofSchema,
  negativeLabWorkspaceProofDatasetSchema,
  panoramaPrivateRawReviewProofSchema,
  panoramaQualityDiagnosticsProofSchema,
  panoramaReviewWorkspaceProofSchema,
  panoramaSavedReviewProofSchema,
  panoramaUiSettingsProofSchema,
  selectiveColorUiProofDatasetSchema,
  superResolutionPrivateRawReviewProofSchema,
  superResolutionReviewWorkspaceProofSchema,
  superResolutionUiSettingsProofSchema,
} from '../lib/proofs/visual-smoke-proofs.ts';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;
const outputDir = resolve('artifacts/visual-smoke');
const viewport = { width: 1440, height: 960 };
const compactPortraitViewport = { width: 390, height: 844 };
const scenarioArgIndex = process.argv.indexOf('--scenario');
const requestedScenario = scenarioArgIndex >= 0 ? process.argv[scenarioArgIndex + 1] : null;
const scenarios = VISUAL_SMOKE_SCENARIOS.map((scenario) => ({
  ...scenario,
  compactOutputPath: 'compactOutputFile' in scenario ? resolve(outputDir, scenario.compactOutputFile) : undefined,
  outputPath: resolve(outputDir, scenario.outputFile),
}));

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

if (process.argv.includes('--list-scenarios')) {
  printScenarioList();
  process.exit(0);
}

const highDpiTargets = [
  { deviceScaleFactor: 1, name: 'empty-library-1x.png' },
  { deviceScaleFactor: 2, name: 'empty-library-2x.png' },
];
const selectedScenarios =
  requestedScenario === null ? scenarios : scenarios.filter((scenario) => scenario.mode === requestedScenario);
const requiresSrPrivateRawProof = selectedScenarios.some(
  (scenario) =>
    scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi ||
    scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawModalReview,
);
const requiresFocusPrivateRawProof = selectedScenarios.some(
  (scenario) =>
    scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi ||
    scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawModalReview,
);
const requiresHdrPrivateRawProof = selectedScenarios.some(
  (scenario) =>
    scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi ||
    scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawEditorHandoff,
);
const requiresPanoramaPrivateRawProof = selectedScenarios.some(
  (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.PanoramaPrivateRawUi,
);
const requiresLayerMaskPrivateRawProof = selectedScenarios.some(
  (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.LayerMaskPrivateRawUi,
);
const requiresNegativeLabPublicExportProof = selectedScenarios.some(
  (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabPublicExportReview,
);
const requiresNegativeLabRealRawPrivateProof = selectedScenarios.some(
  (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabRealRawPrivateReview,
);

if (selectedScenarios.length === 0) {
  throw new Error(`Unknown visual smoke scenario: ${requestedScenario ?? '<missing>'}`);
}

function printUsage(): void {
  console.log(`Usage: bun scripts/proofs/capture-visual-smoke.ts [--scenario <id>] [--list-scenarios]\n`);
  console.log('Runs browser visual smoke capture for RawEngine UI scenarios.');
  console.log('Use --list-scenarios to print valid scenario IDs without launching a browser.');
}

function printScenarioList(): void {
  for (const scenario of scenarios) {
    console.log(`${scenario.mode}\t${scenario.marker}`);
  }
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function expectDatasetValue(locator: Locator, key: string, value: string): Promise<void> {
  await locator.waitFor({ timeout: 10_000 });
  await locator.page().waitForFunction(
    ({ selector, key: datasetKey, value: expectedValue }) => {
      const element = document.querySelector(selector);
      return element instanceof HTMLElement && element.dataset[datasetKey] === expectedValue;
    },
    { key, selector: `[data-testid="${await locator.getAttribute('data-testid')}"]`, value },
    { timeout: 10_000 },
  );
}

interface SrPrivateRawBrowserProof {
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

interface FocusPrivateRawBrowserProof {
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

interface HdrPrivateRawBrowserProof {
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

interface PanoramaPrivateRawBrowserProof {
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

interface LayerMaskPrivateRawBrowserProof {
  exportArtifact: string;
  fixtureId: string;
  metricCount: string;
  refinedPreviewArtifact: string;
  refinedPreviewDataUrl: string;
  unmaskedPreviewArtifact: string;
  unmaskedPreviewDataUrl: string;
  unrefinedPreviewArtifact: string;
  unrefinedPreviewDataUrl: string;
}

interface NegativeLabPublicExportBrowserProof {
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

interface NegativeLabRealRawPrivateBrowserProof {
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

async function waitForDevServer() {
  const startedAt = Date.now();
  const timeoutMs = 45_000;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

async function stopDevServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) {
    return;
  }

  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveStop) => {
      server.once('exit', resolveStop);
    }),
    sleep(5_000).then(() => {
      server.kill('SIGKILL');
    }),
  ]);
}

async function readPngDimensions(path) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

async function readPngDataUrl(path) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function runSipsPngThumbnail(sourcePath, outputPath, maxDimension) {
  await new Promise((resolveSips, rejectSips) => {
    const child = spawn('sips', ['-Z', String(maxDimension), sourcePath, '--out', outputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-1_000);
    });
    child.once('error', rejectSips);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveSips(undefined);
        return;
      }

      rejectSips(new Error(`sips thumbnail failed for ${sourcePath}: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

async function readLayerMaskPreviewDataUrl(path) {
  const dimensions = await readPngDimensions(path);
  const maxPreviewDimension = 720;
  if (Math.max(dimensions.width, dimensions.height) <= maxPreviewDimension) {
    return readPngDataUrl(path);
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-layer-preview-'));
  const outputPath = join(tempDir, 'preview.png');

  try {
    await runSipsPngThumbnail(path, outputPath, maxPreviewDimension);
    return await readPngDataUrl(outputPath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

const brushMaskCanvasReportPath = 'docs/validation/proofs/layers-masks/brush-mask-canvas-ui-proof-2026-06-22.json';
const brushMaskCanvasPaintReportPath = 'artifacts/visual-smoke/brush-mask-canvas-paint.png';
const brushMaskCanvasFinalReportPath = 'artifacts/visual-smoke/brush-mask-canvas-ui.png';
const brushMaskCanvasPaintPath = resolve(brushMaskCanvasPaintReportPath);

const brushMaskCanvasDatasetSchema = z
  .object({
    imageHeight: z.string().regex(/^\d+$/u),
    imagePath: z.string().min(1),
    imageWidth: z.string().regex(/^\d+$/u),
    linesJson: z.string().min(1),
    maskId: z.string().min(1),
    pointCounts: z.string().min(1),
    refineBrushFeather: z.string().regex(/^\d+$/u),
    refineBrushSize: z.string().regex(/^\d+$/u),
    strokeCount: z.string().regex(/^\d+$/u),
    toolOrder: z.string().min(1),
  })
  .passthrough();

const brushCaptureDatasetSchema = z
  .object({
    brushCommandCoordinateSpace: z.literal(BRUSH_MASK_COMMAND_COORDINATE_SPACE),
    brushCommandId: z.string().min(1),
    brushCommandLastMode: z.enum(['paint', 'erase']),
    brushCommandLastPointCount: z.string().regex(/^\d+$/u),
    brushCommandStrokeCount: z.string().regex(/^\d+$/u),
    brushCommandType: z.literal('layerMask.createBrushMask'),
  })
  .passthrough();

const strokeLineSchema = z
  .object({
    brushSize: z.number().positive(),
    feather: z.number().min(0).max(1).optional(),
    flow: z.number().min(0).max(100).optional(),
    points: z.array(z.object({ x: z.number(), y: z.number() }).strict()).min(2),
    tool: z.enum(['brush', 'eraser']),
  })
  .strict();

async function writeBrushMaskCanvasProof(page): Promise<void> {
  const proofDataset = brushMaskCanvasDatasetSchema.parse(
    await page.getByTestId('brush-mask-canvas-ui-proof').evaluate((element) => ({ ...element.dataset })),
  );
  const captureDataset = brushCaptureDatasetSchema.parse(
    await page.getByTestId('image-canvas-brush-command-capture').evaluate((element) => ({ ...element.dataset })),
  );
  const lines = z
    .array(strokeLineSchema)
    .length(2)
    .parse(JSON.parse(decodeURIComponent(proofDataset.linesJson)));
  const imageSize = {
    height: Number(proofDataset.imageHeight),
    width: Number(proofDataset.imageWidth),
  };
  const context = {
    expectedGraphRevision: 'graph_rev_brush_canvas_ui_proof',
    imagePath: proofDataset.imagePath,
    imageSize,
    maskId: proofDataset.maskId,
    maskName: 'Brush canvas proof',
    operationId: 'brush_canvas_ui_2996',
    sessionId: 'brush-mask-canvas-ui-proof',
  };
  const paintCommand = buildBrushMaskCommandFromParameters({ lines: [lines[0]] }, context, { dryRun: true });
  const dryRunCommand = buildBrushMaskCommandFromParameters({ lines }, context, { dryRun: true });
  const applyCommand = buildBrushMaskCommandFromParameters({ lines }, context, { dryRun: false });
  const renderRequest = {
    baseMask: {
      alpha: new Array<number>(64 * 36).fill(0),
      height: 36,
      maskId: context.maskId,
      width: 64,
    },
    height: 36,
    width: 64,
  };
  const paintRender = renderBrushMask({ ...renderRequest, command: paintCommand });
  const finalRender = renderBrushMask({ ...renderRequest, command: dryRunCommand });
  const runtime = new BrushMaskCommandRuntime();
  const dryRunResult = layerMaskDryRunResultV1Schema.parse(runtime.dispatch(dryRunCommand, renderRequest));
  const applyResult = layerMaskMutationResultV1Schema.parse(runtime.dispatch(applyCommand, renderRequest));
  const paintCoverage = alphaSum(paintRender.alpha);
  const finalCoverage = alphaSum(finalRender.alpha);

  if (lines[0]?.tool !== 'brush' || lines[1]?.tool !== 'eraser') {
    throw new Error(`Expected brush,eraser stroke order; got ${proofDataset.toolOrder}`);
  }
  if (paintCoverage <= 0 || finalCoverage >= paintCoverage) {
    throw new Error(`Expected eraser stroke to reduce coverage: paint=${paintCoverage}, final=${finalCoverage}`);
  }
  if (paintRender.contentHash === finalRender.contentHash) {
    throw new Error('Paint and final brush mask hashes should differ after eraser stroke.');
  }
  if (lines[0]?.brushSize !== Number(proofDataset.refineBrushSize) || lines[0]?.feather !== 0.64) {
    throw new Error('Brush refine controls did not update the live canvas stroke parameters.');
  }
  for (const stroke of dryRunCommand.parameters.strokes) {
    for (const point of stroke.points) {
      if ('pressure' in point) throw new Error('Mouse brush proof must not synthesize pressure.');
    }
  }

  const reportJson = await format(
    JSON.stringify({
      commandHash: hashJson(dryRunCommand),
      commandType: captureDataset.brushCommandType,
      coordinateSpace: captureDataset.brushCommandCoordinateSpace,
      dryRunMaskHash: dryRunResult.maskArtifacts[0]?.contentHash,
      finalCoverage,
      finalMaskHash: finalRender.contentHash,
      issue: 2996,
      lastStrokeMode: captureDataset.brushCommandLastMode,
      lastStrokePointCount: Number(captureDataset.brushCommandLastPointCount),
      paintCoverage,
      paintMaskHash: paintRender.contentHash,
      paintScreenshot: brushMaskCanvasPaintReportPath,
      pointCounts: proofDataset.pointCounts.split(',').map(Number),
      refineBrushFeather: Number(proofDataset.refineBrushFeather),
      refineBrushSize: Number(proofDataset.refineBrushSize),
      schemaVersion: 1,
      screenshot: brushMaskCanvasFinalReportPath,
      strokeCount: Number(proofDataset.strokeCount),
      toolOrder: proofDataset.toolOrder.split(','),
      validationMode: 'brush_mask_canvas_ui_drag_to_runtime_output_proof',
      changedMaskIds: applyResult.changedMaskIds,
    }),
    { parser: 'json' },
  );
  await writeFile(brushMaskCanvasReportPath, reportJson);
}

function alphaSum(alpha: ReadonlyArray<number>): number {
  return Number(alpha.reduce((sum, value) => sum + value, 0).toFixed(6));
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

async function sha256File(path: string): Promise<string> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
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

async function loadSrPrivateRawProof(): Promise<SrPrivateRawBrowserProof> {
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

async function loadFocusPrivateRawProof(): Promise<FocusPrivateRawBrowserProof> {
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

async function loadHdrPrivateRawProof(): Promise<HdrPrivateRawBrowserProof> {
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

async function loadPanoramaPrivateRawProof(): Promise<PanoramaPrivateRawBrowserProof> {
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

async function loadLayerMaskPrivateRawProof(): Promise<LayerMaskPrivateRawBrowserProof> {
  const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? '/tmp/rawengine-private-root';
  const artifactRoot = `${privateRoot}/private-artifacts/validation/layer-mask-real-raw`;
  const unmaskedPreviewArtifact = `${artifactRoot}/alaska-layer-mask-v1-unmasked-preview.png`;
  const unrefinedPreviewArtifact = `${artifactRoot}/alaska-layer-mask-v1-unrefined-preview.png`;
  const refinedPreviewArtifact = `${artifactRoot}/alaska-layer-mask-v1-refined-preview.png`;
  return {
    exportArtifact: `${artifactRoot}/alaska-layer-mask-v1-refined-export.tiff`,
    fixtureId: 'validation.layer-mask-real-raw.alaska-local-adjustment.v1',
    metricCount: '5',
    refinedPreviewArtifact,
    refinedPreviewDataUrl: await readLayerMaskPreviewDataUrl(refinedPreviewArtifact),
    unmaskedPreviewArtifact,
    unmaskedPreviewDataUrl: await readLayerMaskPreviewDataUrl(unmaskedPreviewArtifact),
    unrefinedPreviewArtifact,
    unrefinedPreviewDataUrl: await readLayerMaskPreviewDataUrl(unrefinedPreviewArtifact),
  };
}

async function loadNegativeLabPublicExportProof(): Promise<NegativeLabPublicExportBrowserProof> {
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

async function loadNegativeLabRealRawPrivateProof(): Promise<NegativeLabRealRawPrivateBrowserProof> {
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

async function assertSectionCount(page, minimum) {
  const sectionCount = await page.locator('[data-visual-smoke-section]').count();
  if (sectionCount < minimum) {
    throw new Error(`Expected at least ${minimum} visual smoke sections, found ${sectionCount}`);
  }
}

async function assertAdjustmentsPanelRetune(page) {
  const panel = page.locator('[data-visual-smoke-section="adjustments-panel-retune"]');
  await panel.waitFor({ timeout: 10_000 });

  for (const sectionName of ['basic', 'curves', 'details', 'effects']) {
    await panel.getByTestId(`adjustments-section-${sectionName}`).waitFor({
      timeout: 10_000,
    });
  }

  const colorSectionCount = await panel.getByTestId('adjustments-section-color').count();
  if (colorSectionCount !== 0) {
    throw new Error(`Adjustments panel retune expected no Color section, found ${colorSectionCount}.`);
  }

  await assertAdjustmentSectionHeaderActions(page, panel);

  await panel.getByText('Edited', { exact: true }).first().waitFor({ timeout: 10_000 });
  await panel.getByText('Off', { exact: true }).first().waitFor({ timeout: 10_000 });

  const rawProcessingControl = panel.getByTestId('raw-processing-mode-override-control');
  await rawProcessingControl.waitFor({ timeout: 10_000 });
  const rawProcessingToggle = rawProcessingControl.locator('button[aria-expanded]').first();
  await rawProcessingToggle.waitFor({ timeout: 10_000 });
  const rawExpanded = await rawProcessingToggle.getAttribute('aria-expanded');
  if (rawExpanded !== 'false') {
    throw new Error(`RAW processing utility should be collapsed without RAW attention status, got ${rawExpanded}.`);
  }
  const rawBounds = await rawProcessingControl.boundingBox();
  if (!rawBounds || rawBounds.height > 44) {
    throw new Error(
      `RAW processing utility should remain compact when collapsed, height=${rawBounds?.height ?? 'none'}.`,
    );
  }

  const scopesStrip = await waitForScopesStripState(page, 'adjustments-panel-scopes-strip', 'closed');

  await panel.getByTestId('adjustments-panel-scopes-toggle').click();
  await scopesStrip.waitFor({ state: 'visible', timeout: 10_000 });
  const openState = await scopesStrip.getAttribute('data-state');
  if (openState !== 'open') {
    throw new Error(`Adjustments scopes strip did not open from the shared header action, got ${openState}.`);
  }
  const scopesBounds = await scopesStrip.boundingBox();
  const firstAdjustmentBounds = await panel.getByTestId('adjustments-section-basic').boundingBox();
  if (!scopesBounds || !firstAdjustmentBounds || scopesBounds.y >= firstAdjustmentBounds.y) {
    throw new Error('Adjustments scopes strip should render above the adjustment sections when open.');
  }
  if (scopesBounds.height < 180 || scopesBounds.height > 260) {
    throw new Error(`Adjustments scopes strip should use compact default height, got ${scopesBounds.height}.`);
  }
  await assertPanelScopesStripControls(page, panel, scopesStrip, 'adjustments-panel-scopes-toggle', 'Adjustments');
}

async function assertAdjustmentSectionHeaderActions(page, panel) {
  const section = panel.getByTestId('adjustments-section-basic');
  const header = section.locator('[role="button"][aria-expanded]').first();
  const copyAction = section.getByTestId('adjustments-section-basic-action-copy');
  const pasteAction = section.getByTestId('adjustments-section-basic-action-paste');
  const resetAction = section.getByTestId('adjustments-section-basic-action-reset');
  const menuAction = section.getByTestId('adjustments-section-basic-actions-menu');
  await header.waitFor({ timeout: 10_000 });
  await copyAction.waitFor({ timeout: 10_000 });
  await pasteAction.waitFor({ timeout: 10_000 });
  await resetAction.waitFor({ timeout: 10_000 });
  await menuAction.waitFor({ timeout: 10_000 });

  const startingExpanded = await header.getAttribute('aria-expanded');
  if (startingExpanded !== 'true') {
    throw new Error(`Basic section should start open before action checks, got ${startingExpanded}.`);
  }

  const headerBoundsBefore = await header.boundingBox();
  const hiddenOpacity = await copyAction.evaluate((button) => {
    const actionGroup = button.parentElement;
    return actionGroup === null ? '' : getComputedStyle(actionGroup).opacity;
  });
  if (hiddenOpacity !== '0') {
    throw new Error(`Section header actions should be hidden before hover/focus, opacity=${hiddenOpacity}.`);
  }

  await header.focus();
  await page.keyboard.press('Tab');
  const focusedActionId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  if (focusedActionId !== 'adjustments-section-basic-action-copy') {
    throw new Error(`Expected Tab from section header to focus copy action, got ${focusedActionId ?? '<none>'}.`);
  }
  await waitForActionGroupOpacity(page, 'adjustments-section-basic-action-copy', 0.95, 'keyboard focus');
  await page.keyboard.press('Enter');
  const expandedAfterKeyedCopy = await header.getAttribute('aria-expanded');
  if (expandedAfterKeyedCopy !== 'true') {
    throw new Error('Keyboard activation of copy action should not toggle the Basic section.');
  }

  await pasteAction.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error('Compatible copied Basic settings should enable the paste action.');
    }
  });

  await section.hover();
  await waitForActionGroupOpacity(page, 'adjustments-section-basic-action-copy', 0.95, 'hover');
  const headerBoundsAfterHover = await header.boundingBox();
  if (
    !headerBoundsBefore ||
    !headerBoundsAfterHover ||
    Math.abs(headerBoundsBefore.width - headerBoundsAfterHover.width) > 1 ||
    Math.abs(headerBoundsBefore.height - headerBoundsAfterHover.height) > 1
  ) {
    throw new Error('Section header action reveal should not resize the Basic header.');
  }

  await resetAction.click();
  const expandedAfterResetClick = await header.getAttribute('aria-expanded');
  if (expandedAfterResetClick !== 'true') {
    throw new Error('Clicking reset action should not toggle the Basic section.');
  }

  await menuAction.click();
  await page.getByRole('menuitem', { name: 'Copy Basic Tone Settings' }).first().waitFor({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'hidden', timeout: 10_000 });

  await header.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Reset Basic Tone Settings' }).first().waitFor({ timeout: 10_000 });
  await page.keyboard.press('Escape');
}

async function waitForActionGroupOpacity(page, testId, minimumOpacity, reason) {
  await page.waitForFunction(
    ({ minimumOpacity, testId }) => {
      const button = document.querySelector(`[data-testid="${testId}"]`);
      const actionGroup = button?.parentElement;
      return (
        actionGroup !== undefined &&
        actionGroup !== null &&
        Number(getComputedStyle(actionGroup).opacity) >= minimumOpacity
      );
    },
    { minimumOpacity, testId },
    { timeout: 10_000 },
  );
  const opacity = await page.getByTestId(testId).evaluate((button) => {
    const actionGroup = button.parentElement;
    return actionGroup === null ? '' : getComputedStyle(actionGroup).opacity;
  });
  if (Number(opacity) < minimumOpacity) {
    throw new Error(`Section header actions should be visible on ${reason}, opacity=${opacity}.`);
  }
}

async function waitForScopesStripState(page, testId, expectedState) {
  await page.waitForFunction(
    ({ expectedState, testId }) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-state') === expectedState,
    { expectedState, testId },
    { timeout: 10_000 },
  );
  return page.getByTestId(testId);
}

async function assertCompactOpenScopesStrip(strip, label) {
  await strip.waitFor({ state: 'visible', timeout: 10_000 });
  const bounds = await strip.boundingBox();
  if (!bounds) {
    throw new Error(`${label} scopes strip should be visible when open.`);
  }
  if (bounds.height < 180 || bounds.height > 260) {
    throw new Error(`${label} scopes strip should use compact default height, got ${bounds.height}.`);
  }
}

async function assertPanelScopesStripControls(page, panel, strip, toggleTestId, label) {
  const toggle = panel.getByTestId(toggleTestId);
  const togglePressed = await toggle.getAttribute('aria-pressed');
  const toggleState = await toggle.getAttribute('data-state');
  if (togglePressed !== 'true' || toggleState !== 'open') {
    throw new Error(`${label} scopes toggle should expose open pressed state, got ${togglePressed}/${toggleState}.`);
  }

  const minHeight = Number(await strip.getAttribute('data-min-height'));
  const maxHeight = Number(await strip.getAttribute('data-max-height'));
  const stripHeight = Number(await strip.getAttribute('data-panel-scopes-height'));
  if (minHeight !== 160 || maxHeight !== 320 || stripHeight < minHeight || stripHeight > maxHeight) {
    throw new Error(
      `${label} scopes sizing metadata should expose compact clamp values, got min=${minHeight}, max=${maxHeight}, height=${stripHeight}.`,
    );
  }

  const resizer = panel.getByTestId(`${await strip.getAttribute('data-testid')}-resizer`);
  await resizer.waitFor({ state: 'visible', timeout: 10_000 });
  const orientation = await resizer.getAttribute('aria-orientation');
  if (orientation !== 'horizontal') {
    throw new Error(`${label} scopes resize affordance should be a horizontal separator, got ${orientation}.`);
  }

  const startingChannel = await strip.getAttribute('data-active-waveform-channel');
  const startingClipping = await strip.getAttribute('data-show-clipping');
  if (startingChannel !== 'luma' || startingClipping !== 'false') {
    throw new Error(`${label} scopes should start at luma/no clipping, got ${startingChannel}/${startingClipping}.`);
  }

  await strip.hover();
  const rgbMode = panel.getByTestId('waveform-mode-rgb');
  await rgbMode.waitFor({ state: 'visible', timeout: 10_000 });
  await rgbMode.click();
  await pageWaitForAttribute(page, strip, 'data-active-waveform-channel', 'rgb', label);

  const clippingToggle = panel.getByTestId('waveform-clipping-toggle');
  await clippingToggle.click();
  await pageWaitForAttribute(page, strip, 'data-show-clipping', 'true', label);
}

async function pageWaitForAttribute(page, locator, attribute, expectedValue, label) {
  await page.waitForFunction(
    ({ attribute, expectedValue, testId }) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute(attribute) === expectedValue,
    { attribute, expectedValue, testId: await locator.getAttribute('data-testid') },
    { timeout: 10_000 },
  );
  const actualValue = await locator.getAttribute(attribute);
  if (actualValue !== expectedValue) {
    throw new Error(`${label} scopes ${attribute} expected ${expectedValue}, got ${actualValue}.`);
  }
}

async function expectLocatorWidth(page, testId: string, expectedWidth: number, tolerance = 1) {
  const bounds = await page.getByTestId(testId).boundingBox();
  if (!bounds) {
    throw new Error(`${testId} should be visible for layout proof.`);
  }
  if (Math.abs(bounds.width - expectedWidth) > tolerance) {
    throw new Error(`${testId} width expected ${expectedWidth}px, got ${bounds.width}px.`);
  }
  return bounds;
}

async function assertWorkflowRailLayout(page) {
  const desktopInspector = await expectLocatorWidth(page, 'workflow-rail-desktop-inspector', 402);
  const desktopResizer = await expectLocatorWidth(page, 'workflow-rail-desktop-resizer', 8);
  const desktopRail = await expectLocatorWidth(page, 'workflow-rail-desktop-rail', 42);
  const desktopPanel = await expectLocatorWidth(page, 'workflow-rail-desktop-panel', 360);
  const desktopPreview = await page.getByTestId('workflow-rail-desktop-preview').boundingBox();

  if (!desktopPreview || desktopPreview.width < 900) {
    throw new Error(`Desktop preview should keep a stable professional width, got ${desktopPreview?.width ?? 'none'}.`);
  }
  if (desktopInspector.x < desktopResizer.x || desktopPanel.x < desktopRail.x) {
    throw new Error('Desktop workflow rail order should be preview, resizer, rail, active panel.');
  }
  if (desktopPanel.width < 320) {
    throw new Error(`Desktop panel should not fall below 320px minimum, got ${desktopPanel.width}.`);
  }

  const compact = page.getByTestId('workflow-rail-compact-portrait');
  await compact.waitFor({ timeout: 10_000 });
  const compactPreviewBefore = await page.getByTestId('workflow-rail-compact-preview').boundingBox();
  const compactFilmstripBefore = await page.getByTestId('workflow-rail-compact-filmstrip').boundingBox();
  const compactSwitcher = page.getByTestId('workflow-rail-compact-switcher');

  await compactSwitcher.getByRole('button', { name: 'Color' }).click();
  await page.getByTestId('workflow-rail-compact-active-panel').getByText('color', { exact: true }).waitFor({
    timeout: 10_000,
  });

  const compactPreviewAfter = await page.getByTestId('workflow-rail-compact-preview').boundingBox();
  const compactFilmstripAfter = await page.getByTestId('workflow-rail-compact-filmstrip').boundingBox();
  if (!compactPreviewBefore || !compactPreviewAfter || !compactFilmstripBefore || !compactFilmstripAfter) {
    throw new Error('Compact portrait preview and filmstrip must be visible for layout proof.');
  }
  if (
    Math.abs(compactPreviewBefore.height - compactPreviewAfter.height) > 1 ||
    Math.abs(compactFilmstripBefore.height - compactFilmstripAfter.height) > 1
  ) {
    throw new Error('Compact portrait preview/filmstrip geometry changed after horizontal panel switching.');
  }
}

async function assertWorkflowRailSharedScopes(page) {
  await assertWorkflowRailLayout(page);

  await page.getByRole('button', { name: 'Color' }).first().click();
  await page.getByTestId('color-workspace-panel').getByRole('heading', { exact: true, name: 'Color' }).waitFor({
    timeout: 10_000,
  });
  await waitForScopesStripState(page, 'color-workspace-scopes-strip', 'closed');

  await page.getByTestId('color-workspace-scopes-toggle').click();
  const openColorStrip = await waitForScopesStripState(page, 'color-workspace-scopes-strip', 'open');
  await assertCompactOpenScopesStrip(openColorStrip, 'Color workspace');
  await assertPanelScopesStripControls(
    page,
    page.getByTestId('color-workspace-panel'),
    openColorStrip,
    'color-workspace-scopes-toggle',
    'Color workspace',
  );

  await page.getByRole('button', { name: 'Adjust' }).first().click();
  const openAdjustmentsStrip = await waitForScopesStripState(page, 'adjustments-panel-scopes-strip', 'open');
  await assertCompactOpenScopesStrip(openAdjustmentsStrip, 'Adjustments panel');

  await page.getByTestId('adjustments-panel-scopes-toggle').click();
  await waitForScopesStripState(page, 'adjustments-panel-scopes-strip', 'closed');

  await page.getByRole('button', { name: 'Color' }).first().click();
  await waitForScopesStripState(page, 'color-workspace-scopes-strip', 'closed');
}

async function assertProfessionalCropTransformWorkspace(page) {
  const panel = page.getByTestId('professional-crop-transform-panel');
  const canvas = page.getByTestId('professional-crop-transform-canvas');
  const proof = page.getByTestId('professional-crop-transform-proof');

  await panel.waitFor({ timeout: 10_000 });
  await canvas.waitFor({ timeout: 10_000 });
  await page.getByTestId('composition-overlays').waitFor({ timeout: 10_000 });

  const canvasBounds = await canvas.boundingBox();
  if (!canvasBounds || canvasBounds.width < 320 || canvasBounds.height < 220) {
    throw new Error(
      `Crop transform canvas should render as a real workspace surface, got ${canvasBounds?.width ?? 'none'}x${canvasBounds?.height ?? 'none'}.`,
    );
  }

  const overlay = page.getByTestId('composition-overlays');
  const overlayMode = await overlay.getAttribute('data-composition-overlay-mode');
  if (overlayMode !== 'phiGrid') {
    throw new Error(`Crop transform workspace should start with phiGrid overlay, got ${overlayMode ?? 'none'}.`);
  }

  await panel.getByTestId('crop-panel-overlay-cycle').click();
  await expectDatasetValue(proof, 'activeOverlay', 'armature');

  await panel.getByTestId('crop-ratio-preset-1-1').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="professional-crop-transform-proof"]')?.getAttribute('data-aspect-ratio') ===
      '1',
    null,
    { timeout: 10_000 },
  );

  await panel.getByTestId('crop-ratio-preset-custom').click();
  const customRatio = panel.getByTestId('crop-custom-ratio-inputs');
  await customRatio.locator('input[name="customW"]').fill('5');
  await customRatio.locator('input[name="customH"]').fill('4');
  await customRatio.locator('input[name="customH"]').press('Enter');
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="professional-crop-transform-proof"]')?.getAttribute('data-aspect-ratio'),
      ) === 1.25,
    null,
    { timeout: 10_000 },
  );

  const flipButton = panel.getByTestId('crop-panel-flip-horizontal');
  const flipBefore = await flipButton.getAttribute('aria-pressed');
  await flipButton.click();
  const flipAfter = await flipButton.getAttribute('aria-pressed');
  if (flipBefore === flipAfter) {
    throw new Error(`Flip horizontal button should toggle aria-pressed, stayed ${flipAfter ?? 'none'}.`);
  }

  await panel.getByTestId('crop-panel-straighten-toggle').focus();
  const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  if (focusedTestId !== 'crop-panel-straighten-toggle') {
    throw new Error(`Straighten button should expose visible keyboard focus target, got ${focusedTestId ?? 'none'}.`);
  }
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await expectDatasetValue(proof, 'activeOverlay', 'armature');

  await panel.getByTestId('crop-panel-transform-entry').click();
  await page.getByRole('heading', { exact: true, name: 'Transform' }).first().waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await page.getByRole('heading', { exact: true, name: 'Transform' }).first().waitFor({
    state: 'hidden',
    timeout: 10_000,
  });
  await panel.getByTestId('crop-panel-lens-entry').click();
  await page.getByRole('heading', { exact: true, name: 'Lens Correction' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await page.getByRole('heading', { exact: true, name: 'Lens Correction' }).waitFor({
    state: 'hidden',
    timeout: 10_000,
  });
}

async function assertProfessionalEditorToolbar(page) {
  const toolbar = page.locator('[data-visual-smoke-section="professional-editor-toolbar-primary"]');
  await toolbar.waitFor({ timeout: 10_000 });

  const fileStatus = toolbar.getByTestId('editor-toolbar-file-status');
  await fileStatus.hover();
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="editor-toolbar-file-status"]');
    return status?.getAttribute('data-editor-status-expanded') === 'true';
  });

  const historyControl = toolbar.getByTestId('editor-history-depth-control');
  await historyControl.click();
  await toolbar.getByTestId('editor-history-popover').waitFor({ timeout: 10_000 });

  const toolbarRoot = toolbar.locator('[data-toolbar-soft-proof="active"]').first();
  await toolbarRoot.waitFor({ timeout: 10_000 });
  const originalState = await toolbarRoot.getAttribute('data-toolbar-original');
  const negativeLabState = await toolbarRoot.getAttribute('data-toolbar-negative-lab');
  if (originalState !== 'original' || negativeLabState !== 'disabled') {
    throw new Error(`Professional toolbar state mismatch: original=${originalState}, negativeLab=${negativeLabState}`);
  }

  if ((page.viewportSize()?.width ?? 0) >= 1280) {
    await toolbar.getByTestId('export-soft-proof-active-badge').waitFor({ timeout: 10_000 });
    await toolbar.getByTestId('export-soft-proof-active-dot').waitFor({ timeout: 10_000 });
  }
}

async function prepareScenario(page, mode) {
  if (
    mode === VISUAL_SMOKE_SCENARIO_IDS.AdjustmentsPanelRetune ||
    mode === VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAdjustmentsCompact
  ) {
    await assertAdjustmentsPanelRetune(page);
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.ProfessionalCropTransformWorkspace) {
    await assertProfessionalCropTransformWorkspace(page);
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail) {
    await assertWorkflowRailSharedScopes(page);
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorToolbar) {
    await assertProfessionalEditorToolbar(page);
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.CommandPaletteWorkflows) {
    const runCommand = async (query, name, options = { reopen: true }) => {
      await page.getByLabel('Search commands').fill(query);
      await page.getByRole('button', { name }).click();
      if (options.reopen) {
        await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteOpen).click();
      }
    };

    await runCommand('focus', /Open focus stacking/u);
    await runCommand('super', /Open super resolution/u);
    await runCommand('panorama', /Open panorama stitching/u);
    await runCommand('hdr', /Open HDR merge/u, { reopen: false });
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteOpen).click();
    await page.getByLabel('Search commands').fill('negative');
    const negativeDisabledReason = await page
      .getByRole('button', { name: /Open negative lab/u })
      .getAttribute('data-command-palette-disabled-reason');
    if (negativeDisabledReason !== 'modals.commandPalette.unavailable.selectSource') {
      throw new Error(`Expected disabled Negative Lab select-source reason, found ${negativeDisabledReason ?? 'none'}`);
    }
    await page.keyboard.press('Escape');
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteSelectSource).click();
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteOpen).click();
    await runCommand('negative', /Open negative lab/u);
    commandPaletteWorkflowProofSchema.parse(
      await page
        .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteWorkflowProof)
        .evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (
    mode === VISUAL_SMOKE_SCENARIO_IDS.AgentChatUi ||
    mode === VISUAL_SMOKE_SCENARIO_IDS.AgentSelectedImageLiveSession
  ) {
    const shell = page.getByTestId('agent-chat-shell');
    await shell.waitFor({ timeout: 10_000 });
    agentChatProofDatasetSchema.parse(await shell.evaluate((element) => ({ ...element.dataset })));
    const composer = page.getByTestId('agent-live-prompt-composer');
    agentLivePromptComposerProofDatasetSchema.parse(await composer.evaluate((element) => ({ ...element.dataset })));
    await page.getByTestId('agent-live-prompt-input').fill('Brighten this RAW and recover shadows naturally.');
    await page.getByTestId('agent-live-prompt-run').click();
    await expectDatasetValue(composer, 'livePromptStatus', 'dry_run_ready');
    await page.getByTestId('agent-live-prompt-apply').click();
    await expectDatasetValue(composer, 'livePromptStatus', 'applied');
    agentLivePromptResultProofDatasetSchema.parse(
      await page.getByTestId('agent-live-prompt-result').evaluate((element) => ({ ...element.dataset })),
    );
    const auditViewer = page.getByTestId('agent-audit-transcript-viewer');
    agentAuditTranscriptViewerProofDatasetSchema.parse(
      await auditViewer.evaluate((element) => ({ ...element.dataset })),
    );
    const artifacts = page.getByTestId('agent-artifact-review');
    agentArtifactReviewProofDatasetSchema.parse(await artifacts.evaluate((element) => ({ ...element.dataset })));
    const handoff = page.getByTestId('agent-review-handoff');
    agentReviewHandoffProofDatasetSchema.parse(await handoff.evaluate((element) => ({ ...element.dataset })));
    const scope = page.getByTestId('agent-selected-frame-scope');
    agentSelectedFrameScopeProofDatasetSchema.parse(await scope.evaluate((element) => ({ ...element.dataset })));
    const selectedImageLoop = page.getByTestId('agent-selected-image-preview-loop-review');
    await selectedImageLoop.waitFor({ timeout: 10_000 });
    const selectedImageLoopDataset = await selectedImageLoop.evaluate((element) => ({ ...element.dataset }));
    if (
      selectedImageLoopDataset.beforePreviewUrl !== 'blob:rawengine-selected-loop-before' ||
      selectedImageLoopDataset.currentPreviewUrl !== 'blob:rawengine-selected-loop-current'
    ) {
      throw new Error('Selected-image preview-loop review did not expose before/current preview URLs.');
    }
    const selectedImageLoopBefore = page.getByTestId('agent-selected-image-preview-loop-before');
    const selectedImageLoopCurrent = page.getByTestId('agent-selected-image-preview-loop-current');
    const selectedImageLoopBeforeDataset = await selectedImageLoopBefore.evaluate((element) => ({
      ...element.dataset,
    }));
    const selectedImageLoopCurrentDataset = await selectedImageLoopCurrent.evaluate((element) => ({
      ...element.dataset,
    }));
    if (
      selectedImageLoopBeforeDataset.previewUrl !== 'blob:rawengine-selected-loop-before' ||
      selectedImageLoopBeforeDataset.renderHash !== 'render:agent-selected-loop-before' ||
      selectedImageLoopCurrentDataset.previewUrl !== 'blob:rawengine-selected-loop-current' ||
      selectedImageLoopCurrentDataset.renderHash !== 'render:agent-selected-loop-current'
    ) {
      throw new Error('Selected-image preview-loop before/current gallery evidence was not rendered.');
    }
    const selectedImageLoopMetrics = await page
      .getByTestId('agent-selected-image-preview-loop-metrics')
      .evaluate((element) => ({ ...element.dataset }));
    if (selectedImageLoopMetrics.meanLuminanceDelta !== '6.2' || selectedImageLoopMetrics.maxChannelDelta !== '31') {
      throw new Error('Selected-image preview-loop delta metrics were not rendered.');
    }
    const detailLineageDataset = await page
      .getByTestId('agent-selected-image-preview-loop-lineage-entry')
      .nth(1)
      .evaluate((element) => ({ ...element.dataset }));
    if (
      detailLineageDataset.previewUrl !== 'blob:rawengine-selected-loop-detail-crop' ||
      detailLineageDataset.crop !== 'normalized x=0.22 y=0.21 w=0.32 h=0.34' ||
      detailLineageDataset.zoom !== '2.4x @ 0.5,0.55'
    ) {
      throw new Error('Selected-image preview-loop detail crop lineage was not rendered.');
    }
    const review = page.getByTestId('agent-dry-run-review');
    agentDryRunReviewProofDatasetSchema.parse(await review.evaluate((element) => ({ ...element.dataset })));
    const privateRawArtifacts = page.getByTestId('agent-private-raw-artifacts');
    agentPrivateRawArtifactsProofDatasetSchema.parse(
      await privateRawArtifacts.evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('agent-chat-messages').getByText('Runtime demo apply complete.', { exact: false }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('agent-tool-transcript')
      .getByText('rawengine.tone_color.dry_run', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId('agent-tool-status-tool-2').getByText('warning', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-tool-status-tool-3').getByText('succeeded', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-tool-status-tool-4').getByText('blocked', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await auditViewer.getByText('Audit transcript', { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByTestId('agent-audit-summary').getByText('runtime_apply_demo', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('agent-audit-summary')
      .getByText('graph_rev_agent_expert_edit_demo_initial_2844', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    await page.getByTestId('agent-audit-record-audit-record-tool-3').getByText('success', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-audit-record-audit-record-tool-2').getByText('warning', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-audit-record-audit-record-tool-4').getByText('blocked', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('agent-audit-warnings-audit-record-tool-4')
      .getByText('no pixels were sent', { exact: false })
      .waitFor({
        timeout: 10_000,
      });
    const auditArtifactLinkCount = await page
      .getByTestId('agent-audit-transcript-records')
      .locator('a[href*="agent-expert-edit-demo-workflow-2026-06-21.html"]')
      .count();
    if (auditArtifactLinkCount !== 3) {
      throw new Error(`Expected 3 visible audit transcript artifact links, found ${auditArtifactLinkCount}.`);
    }
    await page
      .getByTestId('agent-preview-artifacts')
      .getByText('artifact_agent_expert_edit_demo_preview_dry_run_2844', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    await page.getByTestId('agent-replay-gallery').getByText('Rollback target', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await handoff
      .getByTestId('agent-review-handoff-artifacts')
      .getByText('artifact_agent_expert_edit_demo_before_raw_2844', { exact: true })
      .waitFor({ timeout: 10_000 });
    await handoff
      .getByTestId('agent-review-handoff-artifacts')
      .getByText('artifact_agent_expert_edit_demo_after_virtual_copy_2844', { exact: true })
      .waitFor({ timeout: 10_000 });
    await handoff
      .getByTestId('agent-review-handoff-audit-trail')
      .getByText('tonecolor.apply_command', { exact: true })
      .waitFor({ timeout: 10_000 });
    await handoff.getByText('Runtime proof gallery', { exact: true }).waitFor({ timeout: 10_000 });
    await handoff.getByText('Rollback virtual copy', { exact: true }).waitFor({ timeout: 10_000 });
    await handoff.getByTestId('agent-review-handoff-rollback-restore').click();
    await handoff
      .getByText('Restored graph_rev_agent_expert_edit_demo_initial_2844', { exact: false })
      .waitFor({ timeout: 10_000 });
    const recovery = page.getByTestId('agent-failure-recovery');
    await recovery.getByText('Recover failed tool call', { exact: true }).waitFor({ timeout: 10_000 });
    await recovery.getByTestId('agent-failure-recovery-retry').click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="agent-failure-recovery"]')?.getAttribute('data-retry-state') ===
        'completed',
      { timeout: 10_000 },
    );
    const progress = page.getByTestId('agent-long-edit-progress');
    await progress.getByText('Long edit progress', { exact: true }).waitFor({ timeout: 10_000 });
    await progress.getByText('Audit save', { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByTestId('agent-e2e-closure').getByText('Private RAW proved', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await scope.getByText('Selected-frame scope', { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByTestId('agent-selected-frame-assets').getByText('DSC_2844.NEF', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-excluded-frame-assets').getByText('DSC_2845.NEF', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await scope.getByText('Virtual copy sidecar', { exact: true }).waitFor({ timeout: 10_000 });
    await scope.getByText('Highlight clipping review', { exact: true }).waitFor({ timeout: 10_000 });
    const selectedScopePolicyCount = await scope.locator('[data-policy-state]').count();
    if (selectedScopePolicyCount !== 3) {
      throw new Error(`Expected 3 selected-frame policy checks, found ${selectedScopePolicyCount}.`);
    }
    const readyPreviewCount = await page
      .getByTestId('agent-preview-artifacts')
      .getByText('ready', { exact: true })
      .count();
    if (readyPreviewCount !== 3) {
      throw new Error(`Expected 3 ready preview artifacts, found ${readyPreviewCount}.`);
    }
    const replayLinkCount = await page
      .getByTestId('agent-audit-entries')
      .locator('a[href*="agent-expert-edit-demo-workflow-2026-06-21.html"]')
      .count();
    if (replayLinkCount !== 3) {
      throw new Error(`Expected 3 visible agent replay links, found ${replayLinkCount}.`);
    }
    await page.getByTestId('agent-approval-states').getByText('Approve plan', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-approval-states').getByText('Reject plan', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-approval-states').getByText('Apply approved', { exact: true }).waitFor({
      timeout: 10_000,
    });
    const approveButton = page.getByTestId('agent-approval-action-approve-dry-run');
    await approveButton.click();
    const approvedDataset = agentDryRunReviewProofDatasetSchema.parse(
      await review.evaluate((element) => ({ ...element.dataset })),
    );
    if (approvedDataset.localReviewDecision !== 'approved') {
      throw new Error(`Expected approved local review decision, got ${approvedDataset.localReviewDecision}.`);
    }
    const applyButton = page.getByTestId('agent-review-apply-unavailable');
    if (await applyButton.isEnabled()) {
      throw new Error('Agent demo apply control remains a non-clickable transcript marker.');
    }
    await page
      .getByTestId('agent-review-apply-state')
      .getByText('Matching dry-run was accepted', { exact: false })
      .waitFor({ timeout: 10_000 });
    const rejectButton = page.getByTestId('agent-approval-action-reject-plan');
    await rejectButton.click();
    const rejectedDataset = agentDryRunReviewProofDatasetSchema.parse(
      await review.evaluate((element) => ({ ...element.dataset })),
    );
    if (rejectedDataset.localReviewDecision !== 'rejected') {
      throw new Error(`Expected rejected local review decision, got ${rejectedDataset.localReviewDecision}.`);
    }
    if (await applyButton.isEnabled()) {
      throw new Error('Agent demo apply control remains a non-clickable transcript marker after local rejection.');
    }
    await page.getByTestId('agent-parameter-diffs').getByText('Temperature', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-affected-targets').getByText('DSC_2844.NEF', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-review-warnings').getByText('Original RAW', { exact: false }).waitFor({
      timeout: 10_000,
    });
    await privateRawArtifacts
      .getByText('validation.raw-open-edit-export.high-iso-skin-shadow.v1', { exact: true })
      .waitFor({ timeout: 10_000 });
    await privateRawArtifacts
      .getByText('private-artifacts/validation/open-edit-export/high-iso-skin-shadow-v1-workflow-report.json', {
        exact: true,
      })
      .waitFor({ timeout: 10_000 });
    const removedApplyActionCount = await page.getByText('Approve apply', { exact: true }).count();
    if (removedApplyActionCount !== 0) {
      throw new Error(`Agent UI-only smoke must not expose Approve apply, found ${removedApplyActionCount}.`);
    }
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.ObjectPromptUi) {
    const proof = await page.getByTestId('object-prompt-visual-proof').evaluate((element) => ({ ...element.dataset }));
    if (
      proof.boxReady !== 'true' ||
      proof.hasRaster !== 'true' ||
      proof.modelId !== 'sam_vit_b_01ec64' ||
      proof.pointCount !== '3' ||
      proof.promptKind !== 'box' ||
      proof.providerStatus !== 'local_sam_proposal_v1'
    ) {
      throw new Error(`Object prompt visual proof failed: ${JSON.stringify(proof)}`);
    }
    await page.getByTestId('object-prompt-controls').waitFor({ timeout: 10_000 });
    await page.getByTestId('object-prompt-generate-proposal').waitFor({ timeout: 10_000 });
    await page.getByTestId('object-prompt-replay-receipt').waitFor({ timeout: 10_000 });
    await page.getByTestId('object-prompt-proof-box').waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.TetherDiscoveryUi) {
    const panel = page.getByTestId('tether-panel');
    await panel.waitFor({ timeout: 10_000 });
    await page.getByTestId('tether-camera-card').getByRole('heading', { name: 'Sony ILCE-7M4' }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('tether-provider-status')
      .getByText('visual_smoke_tether_provider', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    const readyBadgeCount = await page.locator('[data-capability-status="ready"]').count();
    if (readyBadgeCount !== 5) {
      throw new Error(`Expected 5 ready tether capabilities, found ${readyBadgeCount}.`);
    }
    await page.locator('[data-testid="tether-session-status"][data-session-status="open"]').waitFor({
      timeout: 10_000,
    });
    await page
      .locator('[data-testid="tether-live-view"][data-live-view-supported="true"][data-live-view-status="off"]')
      .waitFor({
        timeout: 10_000,
      });
    await page.getByTestId('tether-live-view-toggle').click();
    await page
      .locator('[data-testid="tether-live-view"][data-live-view-status="running"][data-frame-rate="4"]')
      .waitFor({
        timeout: 10_000,
      });
    await page.getByTestId('tether-live-view-focus-peaking').waitFor({ timeout: 10_000 });
    await page.getByTestId('tether-open-session').evaluate((button) => {
      if (!(button instanceof HTMLButtonElement) || !button.disabled) {
        throw new Error('Expected restored tether session to disable opening another session.');
      }
    });
    await page.locator('[data-testid="tether-destination-root"][data-destination-root=""]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-session-status').getByText('Session open', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('tether-session-destination-root')
      .getByText('Destination: /tmp/rawengine-tether-captures', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    await page.locator('[data-testid="tether-recovery-status"][data-recovery-status="quarantined"]').waitFor({
      timeout: 10_000,
    });
    await page
      .locator(
        '[data-testid="tether-recovery-proof-receipt"][data-receipt-version="1"][data-recovery-status="quarantined"][data-quarantined-file-count="1"]',
      )
      .waitFor({
        state: 'attached',
        timeout: 10_000,
      });
    await page.locator('[data-testid="tether-exposure-controls"][data-control-count="3"]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-exposure-control-iso').selectOption('800');
    await page
      .locator('[data-testid="tether-exposure-control"][data-control-id="iso"][data-control-current-value="800"]')
      .waitFor({
        timeout: 10_000,
      });
    await page.getByTestId('tether-ingest-preset-select').selectOption('wedding-copy-ingest');
    await page.locator('[data-selected-ingest-preset="wedding-copy-ingest"]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-metadata-template-select').selectOption('studioSession');
    await page.locator('[data-selected-metadata-template="studioSession"]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-backup-copy-toggle').check();
    await page.getByTestId('tether-backup-copy-path').fill('/tmp/rawengine-tether-backup');
    await page.locator('[data-testid="tether-backup-copy"][data-backup-enabled="true"]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-trigger-capture').click();
    await page.getByTestId('tether-capture-result').getByText('Capture imported', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('tether-capture-result')
      .getByText('Camera controls recorded: aperture: f/5.6, iso: 800, shutterSpeed: 1/125', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    await page.locator('[data-testid="tether-capture-result"][data-ingest-preset-id="wedding-copy-ingest"]').waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('tether-capture-result')
      .getByText('Tags applied: wedding, incoming', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    await page
      .getByTestId('tether-capture-result')
      .getByText('Develop presets applied: camera-standard-start', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    await page.locator('[data-testid="tether-capture-result"][data-metadata-template-id="studioSession"]').waitFor({
      timeout: 10_000,
    });
    await page.locator('[data-testid="tether-capture-result"][data-backup-status="verified"]').waitFor({
      timeout: 10_000,
    });
    await page
      .locator(
        '[data-testid="tether-ingest-proof-receipt"][data-receipt-version="1"][data-receipt-status="captured"][data-receipt-ingest-preset-id="wedding-copy-ingest"][data-receipt-metadata-template-id="studioSession"][data-receipt-backup-status="verified"][data-camera-control-count="3"][data-duplicate-suppressed="false"]',
      )
      .waitFor({
        state: 'attached',
        timeout: 10_000,
      });
    await page.getByTestId('tether-incoming-capture-strip').waitFor({ timeout: 10_000 });
    await page.getByTestId('tether-incoming-capture-item').getByText('alaska-dsc7853.ARW', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.locator('[data-review-mode-option="pinned"]').click();
    await page.locator('[data-review-mode-option="pinned"][data-selected="true"]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-pin-capture').click();
    await page.locator('[data-testid="tether-incoming-capture-item"][data-pinned="true"]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-open-capture').click();
    await page.locator('[data-opened-capture-path="/tmp/rawengine-tether-captures/alaska-dsc7853.ARW"]').waitFor({
      timeout: 10_000,
    });
    await page.locator('[data-review-mode-option="holdCurrent"]').click();
    await page.locator('[data-review-mode-option="holdCurrent"][data-selected="true"]').waitFor({
      timeout: 10_000,
    });
    await page.locator('[data-review-mode-option="newest"]').click();
    await page.locator('[data-review-mode-option="newest"][data-selected="true"]').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('tether-close-session').click();
    await page.getByTestId('tether-session-status').getByText('Session closed', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.BrushMaskCanvasUi) {
    await page.getByRole('button', { name: 'Size 96' }).click();
    await page.getByRole('button', { name: 'Feather 64' }).click();
    const capture = page.getByTestId('image-canvas-brush-command-capture');
    await capture.waitFor({ timeout: 10_000 });
    const canvas = capture.locator('canvas');
    const canvasCount = await canvas.count();
    if (canvasCount !== 1) throw new Error(`Expected one brush Konva canvas, found ${canvasCount}.`);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Brush mask canvas capture target has no bounding box.');

    const toCanvasPoint = (x: number, y: number) => ({
      x: box.width / 4 + x * (box.width / 2 / 640),
      y: box.height / 4 + y * (box.height / 2 / 360),
    });

    const drag = async (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      options: { alt?: boolean; expectLivePreview?: boolean } = {},
    ) => {
      const start = toCanvasPoint(startX, startY);
      const middle = toCanvasPoint((startX + endX) / 2, (startY + endY) / 2);
      const end = toCanvasPoint(endX, endY);
      if (options.alt === true) await page.keyboard.down('Alt');
      await page.mouse.move(box.x + start.x, box.y + start.y);
      await page.mouse.down();
      await page.mouse.move(box.x + middle.x, box.y + middle.y, { steps: 8 });
      if (options.expectLivePreview === true) {
        await page.waitForFunction(
          () => {
            const marker = document.querySelector('[data-testid="image-canvas-brush-command-capture"]');
            const pointCount = Number(marker?.getAttribute('data-brush-live-preview-point-count') ?? '0');
            return marker?.getAttribute('data-brush-live-preview-visible') === 'true' && pointCount >= 2;
          },
          { timeout: 10_000 },
        );
      }
      await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 8 });
      await page.mouse.up();
      if (options.alt === true) await page.keyboard.up('Alt');
    };

    await drag(130, 170, 430, 170, { expectLivePreview: true });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="image-canvas-brush-command-capture"]')
          ?.getAttribute('data-brush-command-stroke-count') === '1',
    );
    await page.screenshot({ path: brushMaskCanvasPaintPath, fullPage: false });

    await drag(300, 95, 300, 250, { alt: true });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="image-canvas-brush-command-capture"]')
          ?.getAttribute('data-brush-command-stroke-count') === '2' &&
        document
          .querySelector('[data-testid="image-canvas-brush-command-capture"]')
          ?.getAttribute('data-brush-command-last-mode') === 'erase',
    );
    await writeBrushMaskCanvasProof(page);
    return;
  }

  if (mode === 'focus-ui') {
    await page.getByRole('button', { exact: true, name: 'Auto' }).click();
    await page.getByRole('option', { name: 'Homography' }).click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Depth map/u }).click();
    await page.getByRole('button', { name: /None\s+Flattened preview/u }).click();
    await page.getByTestId('focus-halo-suppression-controls').getByRole('button', { name: /80%/u }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    const overlayControls = page.getByTestId('focus-sharpness-overlay-controls');
    await overlayControls.getByRole('button', { name: /Halo risk\s+Transition guard/u }).click();
    await overlayControls.getByRole('button', { name: '100%' }).click();
    focusUiSettingsProofSchema.parse(
      await page.getByTestId('focus-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    focusReviewWorkspaceProofSchema.parse(
      await page.getByTestId('focus-review-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
    const sourceDetails = page.getByTestId('focus-source-contribution-details');
    const sourceOneDetail = page.getByTestId('focus-source-contribution-S1');
    await sourceOneDetail.getByText('S1', { exact: true }).waitFor({ timeout: 10_000 });
    await sourceOneDetail.getByText('17%', { exact: true }).waitFor({ timeout: 10_000 });
    await sourceOneDetail.getByText('92% confidence / 12 cells', { exact: true }).waitFor({ timeout: 10_000 });
    await sourceOneDetail.getByText('artifact_focus_source_1_contribution', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await sourceDetails.getByText('artifact_focus_source_6_contribution', { exact: true }).waitFor({
      timeout: 10_000,
    });
    const sourceDetailCount = await sourceDetails.locator('[data-source-id]').count();
    if (sourceDetailCount !== 6) {
      throw new Error(`Expected 6 focus source contribution detail cards, found ${sourceDetailCount}.`);
    }
    const sourceCoverage = await sourceDetails.locator('[data-confidence-percent][data-coverage-cell-count]').count();
    if (sourceCoverage !== 6) {
      throw new Error(`Expected 6 focus confidence/coverage cards, found ${sourceCoverage}.`);
    }
    await page
      .getByTestId('focus-artifact-handoff')
      .getByText('/tmp/rawengine-focus-stack-smoke.tif', { exact: true })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.MaskOverlayRawProof) {
    const dragSliderToPercent = async (label: string, percent: number) => {
      const slider = page.getByRole('slider', { name: label });
      const box = await slider.boundingBox();
      if (!box) throw new Error(`Expected ${label} slider to have a bounding box.`);
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * percent, y, { steps: 8 });
      await page.mouse.up();
    };

    const controls = page.getByTestId('mask-overlay-review-controls');
    await controls.waitFor({ timeout: 10_000 });
    await controls.getByText('Overlay Review', { exact: true }).click();
    await controls.getByText('Overlay Review', { exact: true }).click();
    await controls.getByRole('button', { name: 'edges' }).click();
    await dragSliderToPercent('Overlay Opacity', 0.7);
    await dragSliderToPercent('Edge Threshold', 0.64);
    maskOverlayRawProofSchema.parse(
      await page.getByTestId('mask-overlay-raw-proof').evaluate((element) => ({ ...element.dataset })),
    );
    const activeEdgeSwatch = await controls.getByRole('button', { name: 'edges' }).getAttribute('aria-pressed');
    if (activeEdgeSwatch !== 'true') throw new Error(`Expected active edge overlay swatch, got ${activeEdgeSwatch}.`);
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi) {
    focusPrivateRawReviewProofSchema.parse(
      await page.getByTestId('focus-private-raw-review-proof').evaluate((element) => ({ ...element.dataset })),
    );
    for (const testId of ['focus-private-raw-preview', 'focus-private-raw-result', 'focus-private-raw-export']) {
      const loaded = await page.getByTestId(testId).evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      if (!loaded) throw new Error(`${testId} did not load a nonblank private RAW image.`);
    }
    await page
      .getByTestId('focus-private-raw-artifact-handoff')
      .getByText('focus-plane-merge.tiff', { exact: false })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawModalReview) {
    const proofBefore = await page
      .getByTestId('focus-private-raw-modal-review-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      proofBefore.fixtureId !== 'validation.computational-merge.focus-plane-transition.v1' ||
      proofBefore.previewRequested !== 'false' ||
      proofBefore.sourceCount !== '3' ||
      /^sha256:[a-f0-9]{64}$/u.test(proofBefore.stackHash ?? '') !== true ||
      proofBefore.stackPath?.endsWith('/focus-plane-merge.tiff') !== true
    ) {
      throw new Error(`Focus private RAW modal proof payload failed: ${JSON.stringify(proofBefore)}`);
    }
    const stackPath = proofBefore.stackPath;
    if (stackPath === undefined) throw new Error('Focus private RAW modal proof is missing stack path.');
    await page.getByRole('button', { exact: true, name: 'Preview plan' }).click();
    const proofAfter = await page
      .getByTestId('focus-private-raw-modal-review-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (proofAfter.previewRequested !== 'true') {
      throw new Error(`Focus private RAW preview plan was not requested: ${JSON.stringify(proofAfter)}`);
    }
    const readiness = await page
      .getByTestId('focus-stack-readiness-summary')
      .evaluate((element) => ({ ...element.dataset }));
    if (readiness.sourceCount !== '3' || readiness.stackReady !== 'true') {
      throw new Error(`Focus private RAW readiness failed: ${JSON.stringify(readiness)}`);
    }
    await page
      .getByTestId('focus-review-diagnostics')
      .getByText(stackPath, { exact: true })
      .waitFor({ timeout: 10_000 });
    const handoff = await page.getByTestId('focus-editable-handoff-proof').evaluate((element) => ({
      regionCount: element.querySelectorAll('[data-region-risk]').length,
      ...element.dataset,
    }));
    if (
      handoff.editableArtifactId !== stackPath ||
      handoff.editableArtifactHash !== proofBefore.stackHash ||
      handoff.editableHandoffStatus !== 'review_required' ||
      handoff.exportReviewArtifactId?.endsWith('/focus-plane-export-review.png') !== true ||
      handoff.haloReviewStatus !== 'review_required' ||
      handoff.runtimeOutputReview !== 'true' ||
      handoff.regionCount !== 3
    ) {
      throw new Error(`Focus private RAW editable handoff proof failed: ${JSON.stringify(handoff)}`);
    }
    for (const risk of ['halo_risk', 'low_confidence', 'stable']) {
      const riskCount = await page
        .getByTestId('focus-editable-handoff-proof')
        .locator(`[data-region-risk="${risk}"]`)
        .count();
      if (riskCount < 1) throw new Error(`Focus private RAW halo review missing ${risk} region.`);
    }
    await page.getByTestId('focus-source-contribution-details').waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi) {
    hdrPrivateRawReviewProofSchema.parse(
      await page.getByTestId('hdr-private-raw-review-proof').evaluate((element) => ({ ...element.dataset })),
    );
    for (const testId of ['hdr-private-raw-before', 'hdr-private-raw-after', 'hdr-private-raw-preview']) {
      const loaded = await page.getByTestId(testId).evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      if (!loaded) throw new Error(`${testId} did not load a nonblank private RAW image.`);
    }
    await page
      .getByTestId('hdr-private-raw-artifact-handoff')
      .getByText('hdr-bracket-merge.tiff', { exact: false })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawEditorHandoff) {
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('merge-saved-output-detail').waitFor({ timeout: 10_000 });
    const provenance = await page
      .getByTestId('hdr-editable-handoff-provenance')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      provenance.capabilityLevel !== 'runtime_apply_capable' ||
      provenance.displayPreviewColorState !== 'tone_mapped_srgb_preview' ||
      provenance.exportColorState !== 'saved_display_referred_srgb_output' ||
      provenance.outputColorSpace !== 'srgb_display_referred_v1' ||
      provenance.previewExportComparedFields?.includes('outputPath') !== true ||
      /^fnv1a32:[a-f0-9]{8}$/u.test(provenance.previewExportExportReceiptHash ?? '') !== true ||
      provenance.previewExportParityStatus !== 'matched_editor_display_path' ||
      /^fnv1a32:[a-f0-9]{8}$/u.test(provenance.previewExportPreviewStateHash ?? '') !== true ||
      /^fnv1a32:[a-f0-9]{8}$/u.test(provenance.previewExportProofHash ?? '') !== true ||
      provenance.sceneMergeColorState !== 'legacy_display_referred_merge_after_linear_to_srgb' ||
      provenance.sourceCount !== '3' ||
      provenance.warningCodes !== 'tone_mapped_preview_only'
    ) {
      throw new Error(`HDR private RAW editable provenance proof failed: ${JSON.stringify(provenance)}`);
    }
    await page.getByTestId('merge-open-saved-output').click();
    const proof = await page
      .getByTestId('hdr-private-raw-editor-handoff-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      proof.enteredNormalEditorPath !== 'true' ||
      proof.fixtureId !== 'validation.computational-merge.hdr-bracket-alignment.v1' ||
      proof.mergeArtifact?.endsWith('/hdr-bracket-merge.tiff') !== true ||
      proof.openCallback !== 'handleImageSelect' ||
      proof.openedPath !== proof.mergeArtifact ||
      proof.savedPath !== proof.mergeArtifact ||
      proof.sourceCount !== '3'
    ) {
      throw new Error(`HDR private RAW output did not enter editor path: ${JSON.stringify(proof)}`);
    }
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.PanoramaPrivateRawUi) {
    panoramaPrivateRawReviewProofSchema.parse(
      await page.getByTestId('panorama-private-raw-review-proof').evaluate((element) => ({ ...element.dataset })),
    );
    for (const testId of [
      'panorama-private-raw-preview',
      'panorama-private-raw-result',
      'panorama-private-raw-export',
    ]) {
      const loaded = await page.getByTestId(testId).evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      if (!loaded) throw new Error(`${testId} did not load a nonblank private RAW image.`);
    }
    await page
      .getByTestId('panorama-private-raw-artifact-handoff')
      .getByText('panorama-overlap-merge.tiff', { exact: false })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.LayerMaskPrivateRawUi) {
    layerMaskPrivateRawReviewProofSchema.parse(
      await page.getByTestId('layer-mask-private-raw-review-proof').evaluate((element) => ({ ...element.dataset })),
    );
    for (const testId of [
      'layer-mask-private-raw-unmasked',
      'layer-mask-private-raw-unrefined',
      'layer-mask-private-raw-refined',
    ]) {
      const loaded = await page.getByTestId(testId).evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      if (!loaded) throw new Error(`${testId} did not load a nonblank private RAW image.`);
    }
    await page
      .getByTestId('layer-mask-private-raw-artifact-handoff')
      .getByText('alaska-layer-mask-v1-refined-export.tiff', { exact: false })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === 'sr-ui') {
    await page.getByRole('button', { name: '4x' }).click();
    await page.getByRole('button', { exact: true, name: 'Auto' }).click();
    await page.getByRole('option', { name: 'Optical flow' }).click();
    await page.locator('[data-sr-reconstruction-mode="optical_flow"]').click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Aggressive' }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    superResolutionUiSettingsProofSchema.parse(
      await page.getByTestId('sr-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    superResolutionReviewWorkspaceProofSchema.parse(
      await page.getByTestId('sr-review-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page
      .getByTestId('sr-artifact-handoff')
      .getByText('/tmp/rawengine-super-resolution-smoke.tif', { exact: true })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi) {
    superResolutionPrivateRawReviewProofSchema.parse(
      await page.getByTestId('sr-private-raw-review-proof').evaluate((element) => ({ ...element.dataset })),
    );
    for (const testId of ['sr-private-raw-preview', 'sr-private-raw-result', 'sr-private-raw-export']) {
      const loaded = await page.getByTestId(testId).evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      if (!loaded) throw new Error(`${testId} did not load a nonblank private RAW image.`);
    }
    await page
      .getByTestId('sr-private-raw-artifact-handoff')
      .getByText('sr-subpixel-reconstruction.tiff', { exact: false })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawModalReview) {
    const proofBefore = await page
      .getByTestId('sr-private-raw-modal-review-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      proofBefore.fixtureId !== 'validation.computational-merge.super-resolution-subpixel.v1' ||
      Number.parseFloat(proofBefore.detailGainRatio ?? '0') <= 1 ||
      Number.parseFloat(proofBefore.outputArtifactScore ?? '1') < 0 ||
      proofBefore.outputHeight !== '960' ||
      Number.parseInt(proofBefore.outputPixelCount ?? '0', 10) <= 0 ||
      proofBefore.outputScale !== '2' ||
      proofBefore.outputWidth !== '1440' ||
      proofBefore.previewRequested !== 'false' ||
      proofBefore.privateRunReportPath?.endsWith('/sr-subpixel-private-run-report.json') !== true ||
      /^sha256:[a-f0-9]{64}$/u.test(proofBefore.reconstructionHash ?? '') !== true ||
      proofBefore.reconstructionPath?.endsWith('/sr-subpixel-reconstruction.tiff') !== true ||
      Number.parseFloat(proofBefore.sourceCoverageRatio ?? '0') <= 0 ||
      proofBefore.sourceCount !== '4' ||
      proofBefore.sourceHashes?.split(',').length !== 4 ||
      proofBefore.sourcePaths?.split(',').length !== 4
    ) {
      throw new Error(`SR private RAW modal proof payload failed: ${JSON.stringify(proofBefore)}`);
    }
    const reconstructionPath = proofBefore.reconstructionPath;
    if (reconstructionPath === undefined) throw new Error('SR private RAW modal proof is missing reconstruction path.');
    await page.getByRole('button', { exact: true, name: 'Preview plan' }).click();
    const proofAfter = await page
      .getByTestId('sr-private-raw-modal-review-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (proofAfter.previewRequested !== 'true') {
      throw new Error(`SR private RAW preview plan was not requested: ${JSON.stringify(proofAfter)}`);
    }
    const readiness = await page.getByTestId('sr-readiness-summary').evaluate((element) => ({ ...element.dataset }));
    if (readiness.reconstructionReady !== 'true' || readiness.sourceCount !== '4') {
      throw new Error(`SR private RAW readiness failed: ${JSON.stringify(readiness)}`);
    }
    const preflight = await page.getByTestId('sr-source-preflight').evaluate((element) => ({ ...element.dataset }));
    if (preflight.preflightStatus !== 'ready' || preflight.effectiveScale === undefined) {
      throw new Error(`SR private RAW source preflight failed: ${JSON.stringify(preflight)}`);
    }
    const handoff = await page.getByTestId('sr-editable-handoff-proof').evaluate((element) => ({
      ...element.dataset,
    }));
    if (
      handoff.outputArtifactHash !== proofBefore.reconstructionHash ||
      handoff.outputArtifactId !== reconstructionPath ||
      handoff.detailReviewMeanImprovementRatio !== proofBefore.detailGainRatio ||
      handoff.reviewArtifactCount !== '1' ||
      handoff.editableHandoffReady !== 'false' ||
      handoff.supportMapReviewStatus !== 'review_required' ||
      handoff.supportMapWeakRatio !== '0.26' ||
      handoff.reviewArtifactPaths?.endsWith('/sr-subpixel-result-review.png') !== true
    ) {
      throw new Error(`SR private RAW editable handoff proof failed: ${JSON.stringify(handoff)}`);
    }
    const supportMap = await page.getByTestId('sr-support-map-review').evaluate((element) => ({
      regionCount: element.querySelectorAll('[data-region-risk]').length,
      ...element.dataset,
    }));
    if (
      supportMap.effectiveScale !== '1.5' ||
      supportMap.requestedScale !== '2' ||
      supportMap.reviewStatus !== 'review_required' ||
      supportMap.supportCoverageRatio !== proofBefore.sourceCoverageRatio ||
      supportMap.supportDowngradeReason !== 'effective_scale_downgraded' ||
      supportMap.weakSupportRatio !== '0.26' ||
      supportMap.regionCount !== 4
    ) {
      throw new Error(`SR private RAW support-map review failed: ${JSON.stringify(supportMap)}`);
    }
    for (const risk of ['supported', 'weak_support', 'motion_rejected', 'edge_risk']) {
      const riskCount = await page.getByTestId('sr-support-map-review').locator(`[data-region-risk="${risk}"]`).count();
      if (riskCount < 1) throw new Error(`SR private RAW support-map review missing ${risk} region.`);
    }
    await page.getByTestId('sr-review-diagnostics').getByText(reconstructionPath, { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('sr-review-diagnostics')
      .getByText(proofBefore.reconstructionHash, { exact: true })
      .waitFor({ timeout: 10_000 });
    await page
      .getByTestId('sr-review-diagnostics')
      .getByText(proofBefore.privateRunReportPath ?? '', { exact: true })
      .waitFor({ timeout: 10_000 });
    const previewReadyCount = await page
      .getByTestId('sr-review-artifact-comparator')
      .locator('[data-preview-ready="true"]')
      .count();
    if (previewReadyCount !== 1) {
      throw new Error(`Expected 1 SR private RAW review preview, found ${previewReadyCount}.`);
    }
    await page.getByText('/tmp/rawengine-super-resolution-smoke.tif', { exact: true }).waitFor({
      state: 'detached',
      timeout: 1_000,
    });
    await page
      .getByText('docs/validation/proofs/super-resolution/sr-synthetic-output-artifact-proof-2026-06-20.json', {
        exact: true,
      })
      .waitFor({
        state: 'detached',
        timeout: 1_000,
      });
    return;
  }

  if (mode === 'layer-stack-workflow') {
    await page.getByRole('button', { name: /Portrait burn/u }).click();
    await page.getByRole('button', { name: 'Move down' }).click();
    await page.getByRole('button', { name: 'Toggle' }).click();
    await page.getByRole('button', { name: 'Add layer' }).click();
    await page.getByRole('button', { name: 'Duplicate layer' }).click();
    await page.getByRole('button', { name: 'Rename proof' }).click();
    await page.getByRole('button', { name: 'Opacity 64%' }).click();
    for (const blendMode of ['normal', 'multiply', 'screen', 'soft light', 'overlay']) {
      await page.getByTestId('layer-stack-blend-mode-picker').getByRole('button', { name: blendMode }).click();
    }
    await page.getByRole('button', { name: 'Copy mask' }).click();
    layerStackWorkflowProofSchema.parse(
      await page.getByTestId('layer-stack-workflow-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByRole('button', { name: 'Compare preview/export' }).click();
    layerStackExportParityProofSchema.parse(
      await page.getByTestId('layer-stack-export-parity-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'library-workflow') {
    await page.getByRole('button', { name: 'Keepers' }).click();
    await page.getByRole('button', { name: 'Survey' }).click();
    await page.getByRole('button', { name: 'Edit selected pick' }).click();
    await page.getByRole('button', { name: 'Queue selected export' }).click();
    await page.getByRole('button', { name: 'Create B&W proof copy' }).click();
    await page.getByRole('button', { name: 'Compare virtual copy' }).click();
    libraryWorkflowProofSchema.parse(
      await page.getByTestId('library-workflow-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('library-virtual-copy').getByText('vc-dsc-0002-bw-proof', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('library-virtual-copy-compare-proof').waitFor({ timeout: 10_000 });
    await page
      .getByTestId('library-editor-handoff-proof')
      .getByText('DSC_0002.NEF opened in editor', { exact: false })
      .waitFor({
        timeout: 10_000,
      });
    await page.getByTestId('library-export-queue-proof').getByText('1 queued', { exact: false }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === 'hdr-ui') {
    await page.getByTestId('hdr-tone-mapping-preset-highlight_detail').click();
    await page.getByTestId('hdr-deghost-confidence-map-toggle').click();
    await page.getByTestId('hdr-deghost-region-intensity').getByRole('button', { name: '85%' }).click();
    await page.getByTestId('hdr-bracket-source-row').nth(1).click();
    await page.getByTestId('hdr-exposure-weighting-mode').getByRole('button', { name: 'Protect highlights' }).click();
    hdrUiSettingsProofSchema.parse(
      await page.getByTestId('hdr-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    hdrReviewWorkspaceProofSchema.parse(
      await page.getByTestId('hdr-review-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
    const bracketPreflight = page.getByTestId('hdr-bracket-preflight');
    await bracketPreflight.scrollIntoViewIfNeeded();
    const sourceRows = page.getByTestId('hdr-bracket-source-row');
    hdrBracketSourceRolesProofSchema.parse(
      await sourceRows.evaluateAll((rows) =>
        rows.map((row) => ({
          bracketSelected: row.dataset.bracketSelected,
          bracketRole: row.dataset.bracketRole,
          exposureEv: row.dataset.exposureEv,
          exposureWeightMultiplier: row.dataset.exposureWeightMultiplier,
          sourceIndex: row.dataset.sourceIndex,
        })),
      ),
    );
    const expectedVisibleRoles = ['Under', 'Reference', 'Over'] as const;
    for (const [index, expectedLabel] of expectedVisibleRoles.entries()) {
      const role = sourceRows.nth(index).getByTestId('hdr-bracket-source-role');
      await role.waitFor({ state: 'visible', timeout: 10_000 });
      const actualLabel = (await role.textContent())?.trim();
      if (actualLabel !== expectedLabel) {
        throw new Error(
          `HDR source ${index} role mismatch: expected ${expectedLabel}, got ${actualLabel ?? '<missing>'}.`,
        );
      }
    }
    const deghostGate = page.getByTestId('hdr-deghost-review-gate');
    await deghostGate.scrollIntoViewIfNeeded();
    await page.getByTestId('hdr-deghost-motion-overlay').waitFor({ state: 'visible', timeout: 10_000 });
    const startButton = page.getByRole('button', { name: 'Start' });
    if (await startButton.isEnabled()) {
      throw new Error('HDR deghost review gate should block Start before approval.');
    }
    await page.getByTestId('hdr-deghost-review-approve').click();
    if (!(await startButton.isEnabled())) {
      throw new Error('HDR deghost review gate should enable Start after approval.');
    }
    hdrDeghostReviewGateProofSchema.parse(await deghostGate.evaluate((element) => ({ ...element.dataset })));
    await page.getByTestId('hdr-artifact-handoff').getByText('/tmp/rawengine-hdr-smoke.tif', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.HdrSavedOutputEditorPath) {
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('merge-saved-output-detail').waitFor({ timeout: 10_000 });
    const provenance = await page
      .getByTestId('hdr-editable-handoff-provenance')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      provenance.capabilityLevel !== 'runtime_apply_capable' ||
      provenance.displayPreviewColorState !== 'tone_mapped_srgb_preview' ||
      provenance.exportColorState !== 'saved_display_referred_srgb_output' ||
      provenance.outputColorSpace !== 'srgb_display_referred_v1' ||
      provenance.previewExportComparedFields?.includes('outputPath') !== true ||
      /^fnv1a32:[a-f0-9]{8}$/u.test(provenance.previewExportExportReceiptHash ?? '') !== true ||
      provenance.previewExportParityStatus !== 'matched_editor_display_path' ||
      /^fnv1a32:[a-f0-9]{8}$/u.test(provenance.previewExportPreviewStateHash ?? '') !== true ||
      /^fnv1a32:[a-f0-9]{8}$/u.test(provenance.previewExportProofHash ?? '') !== true ||
      provenance.sceneMergeColorState !== 'legacy_display_referred_merge_after_linear_to_srgb' ||
      provenance.sourceCount !== '3' ||
      provenance.warningCodes !== 'tone_mapped_preview_only'
    ) {
      throw new Error(`HDR editable provenance proof failed: ${JSON.stringify(provenance)}`);
    }
    await page.getByTestId('merge-open-saved-output').click();
    const proof = await page
      .getByTestId('hdr-saved-output-editor-path-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      proof.enteredNormalEditorPath !== 'true' ||
      proof.openCallback !== 'handleImageSelect' ||
      proof.openedPath !== '/tmp/rawengine-hdr-smoke.tif' ||
      proof.savedPath !== '/tmp/rawengine-hdr-smoke.tif'
    ) {
      throw new Error(`HDR saved output did not enter editor path: ${JSON.stringify(proof)}`);
    }
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabEditorLayerHandoff) {
    const proof = await page
      .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabEditorLayerHandoffProof)
      .evaluate((element) => ({ ...element.dataset }));
    if (
      proof.enteredNormalEditorPath !== 'true' ||
      proof.layerCommandType !== 'layerMask.createLayer' ||
      proof.layerCreated !== 'true' ||
      proof.openCallback !== 'handleImageSelect' ||
      proof.openedPath !== '/proof-roll/negative-lab/frame_001_Positive.tiff' ||
      proof.sourceNegativePath !== '/proof-roll/negative-lab/frame_001.CR3' ||
      proof.rollSessionId !== 'roll_session_negative_lab_visual_smoke' ||
      proof.conversionReportId !== 'negative_lab_conversion_report_visual_smoke' ||
      proof.savedPath !== '/proof-roll/negative-lab/frame_001_Positive.tiff' ||
      proof.sidecarSourceImagePath !== '/proof-roll/negative-lab/frame_001_Positive.tiff'
    ) {
      throw new Error(`Negative Lab editor layer handoff proof failed: ${JSON.stringify(proof)}`);
    }
    return;
  }

  if (mode === 'panorama-ui') {
    await page.getByTestId('panorama-projection-option-cylindrical').click();
    if (!(await page.getByTestId('panorama-projection-option-spherical').isDisabled())) {
      throw new Error('Unsupported spherical panorama projection must be disabled.');
    }
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Feather', exact: false }).click();
    await page.getByTestId('panorama-boundary-option-auto_crop').click();
    if (!(await page.getByTestId('panorama-boundary-option-transparent').isDisabled())) {
      throw new Error('Unsupported transparent panorama boundary must be disabled.');
    }
    await page.getByRole('button', { name: 'Gain compensation' }).click();
    await page.getByRole('option', { name: 'None' }).click();
    await page.getByTestId('panorama-seam-exposure-compensation-slider').fill('60');
    await page.getByTestId('panorama-seam-exposure-compensation-value').getByText('60%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: '8192 px' }).click();
    panoramaUiSettingsProofSchema.parse(
      await page.getByTestId('panorama-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    panoramaReviewWorkspaceProofSchema.parse(
      await page.getByTestId('panorama-review-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
    panoramaQualityDiagnosticsProofSchema.parse(
      await page.getByTestId('panorama-quality-diagnostics').evaluate((element) => ({ ...element.dataset })),
    );
    const overlayProof = await page
      .getByTestId('panorama-seam-contribution-overlay')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      overlayProof.reviewStatus !== 'requires_review' ||
      overlayProof.seamCount !== '4' ||
      overlayProof.sourceContributionCount !== '5'
    ) {
      throw new Error(`Panorama seam contribution overlay proof failed: ${JSON.stringify(overlayProof)}`);
    }
    const runtimePlanProof = await page
      .getByTestId('panorama-runtime-plan-summary')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      runtimePlanProof.runtimePlanReady !== 'true' ||
      runtimePlanProof.planStatus !== 'accepted' ||
      runtimePlanProof.planScope !== 'geometry_memory_only' ||
      runtimePlanProof.outputDimensions !== '9024 x 3200' ||
      runtimePlanProof.sourceGeometryLayout !== 'single_row' ||
      runtimePlanProof.sourceGeometrySupport !== 'implemented_current_engine' ||
      runtimePlanProof.sourceRowCountEstimate !== '1'
    ) {
      throw new Error(`Panorama runtime plan proof failed: ${JSON.stringify(runtimePlanProof)}`);
    }
    await page.getByTestId('panorama-artifact-handoff').getByText('/tmp/panorama.tif', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (
    mode === VISUAL_SMOKE_SCENARIO_IDS.PanoramaSavedReview ||
    mode === VISUAL_SMOKE_SCENARIO_IDS.ComputationalPanoramaOutputReview
  ) {
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('merge-saved-output-detail').waitFor({ timeout: 10_000 });
    panoramaSavedReviewProofSchema.parse(
      await page.getByTestId('panorama-saved-review-summary').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('panorama-derived-output-receipt-store-entry').waitFor({ timeout: 10_000 });
    await page.getByTestId('merge-open-saved-output').click();
    const proof = await page
      .getByTestId('panorama-saved-review-open-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (proof.openedPath !== '/tmp/panorama.tif') {
      throw new Error(`Panorama saved output did not open editor path: ${JSON.stringify(proof)}`);
    }
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail) {
    await page.getByRole('button', { name: 'Color' }).first().click();
    await page.getByTestId('color-workspace-panel').getByRole('heading', { exact: true, name: 'Color' }).waitFor({
      timeout: 10_000,
    });
    await page.getByText('Active panel: color', { exact: true }).waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === 'color-workflow') {
    const colorPanel = page.locator('[data-visual-smoke-section="color-workflow-panel"]');
    const assertColorWorkspaceTab = async (name: string, activePanel: string, hiddenPanel: string) => {
      await colorPanel.getByRole('tab', { exact: true, name }).click();
      await colorPanel.getByTestId(`color-workspace-tab-panel-${activePanel}`).waitFor({ state: 'visible' });
      await colorPanel.getByTestId(`color-workspace-tab-panel-${hiddenPanel}`).waitFor({ state: 'hidden' });
      const tabState = await colorPanel.getByRole('tab', { exact: true, name }).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          active: (element as HTMLElement).dataset.active,
          minHeight: Number.parseFloat(style.minHeight),
          offsetHeight: (element as HTMLElement).offsetHeight,
          radius: Number.parseFloat(style.borderTopLeftRadius),
        };
      });
      if (tabState.active !== 'true' || tabState.offsetHeight > 32 || tabState.minHeight > 28 || tabState.radius > 6) {
        throw new Error(`Color workspace tab compact state proof failed for ${name}: ${JSON.stringify(tabState)}`);
      }
    };
    const assertCompactRangeDensity = async (slider: Locator, proofLabel: string) => {
      const selectedSliderCount = await slider.count();
      if (selectedSliderCount !== 1) {
        throw new Error(`Expected one compact density proof slider for ${proofLabel}, found ${selectedSliderCount}.`);
      }
      await slider.evaluate((element, label) => {
        const trackWrap = element.parentElement;
        const root = trackWrap?.parentElement;
        if (!trackWrap || !root) {
          throw new Error(`Compact density proof for ${label} could not find slider root.`);
        }
        const rootStyle = getComputedStyle(root);
        const trackStyle = getComputedStyle(trackWrap);
        const gridColumnCount = rootStyle.gridTemplateColumns.split(' ').filter(Boolean).length;
        if (rootStyle.display !== 'grid' || gridColumnCount < 3) {
          throw new Error(`Compact density proof for ${label} expected a three-column grid slider row.`);
        }
        if (Number.parseFloat(rootStyle.minHeight) > 28 || Number.parseFloat(trackStyle.height) > 24) {
          throw new Error(`Compact density proof for ${label} exceeded compact slider row geometry.`);
        }
      }, proofLabel);
    };
    const assertCompactSliderDensity = async (scope: Locator, label: string, proofLabel: string, index = 0) => {
      const sliders = scope.locator(`input[type="range"][aria-label="${label}"]`);
      const sliderCount = await sliders.count();
      if (sliderCount <= index) {
        throw new Error(`Expected ${label} compact density proof slider at ${index}, found ${sliderCount}.`);
      }
      await assertCompactRangeDensity(sliders.nth(index), proofLabel);
    };
    const setRangeInput = async (scope: Locator, label: string, value: number, index = 0) => {
      const sliders = scope.locator(`input[type="range"][aria-label="${label}"]`);
      const sliderCount = await sliders.count();
      if (sliderCount <= index) {
        throw new Error(`Expected ${label} range input at ${index}, found ${sliderCount}.`);
      }
      const slider = sliders.nth(index);
      const selectedSliderCount = await slider.count();
      if (selectedSliderCount !== 1) {
        throw new Error(`Expected one ${label} range input, found ${selectedSliderCount}.`);
      }
      await slider.evaluate((element, nextValue) => {
        const input = element as HTMLInputElement;
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        valueSetter?.call(input, String(nextValue));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    };
    const waitForColorAdjustmentProofText = async (text: string) => {
      await page.waitForFunction(
        (expectedText) =>
          document
            .querySelector('[data-testid="color-workflow-adjustment-proof"]')
            ?.textContent?.includes(expectedText),
        text,
        { timeout: 10_000 },
      );
    };
    await assertColorWorkspaceTab('Output', 'output', 'quick');
    await colorPanel.getByTestId('color-runtime-status-rail').getByText('Preview/export', { exact: true }).waitFor({
      timeout: 10_000,
    });
    const proofingDisclosure = colorPanel.getByTestId('color-proofing-diagnostics-disclosure');
    if (!(await proofingDisclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await proofingDisclosure.locator('summary').click();
    }
    const gamutWarningControls = colorPanel.getByTestId('gamut-warning-controls');
    await gamutWarningControls.getByText('sRGB gamut warning', { exact: true }).waitFor({ timeout: 10_000 });
    await gamutWarningControls.getByText('sRGB gamut · Clear', { exact: true }).waitFor({ timeout: 10_000 });
    const gamutWarningToggle = gamutWarningControls.getByTestId('gamut-warning-toggle');
    await gamutWarningControls.getByText('Off', { exact: true }).waitFor({ timeout: 10_000 });
    await gamutWarningToggle.click();
    await gamutWarningControls.getByText('On', { exact: true }).waitFor({ timeout: 10_000 });
    await gamutWarningToggle.click();
    await gamutWarningControls.getByText('Off', { exact: true }).waitFor({ timeout: 10_000 });
    await assertColorWorkspaceTab('Editor', 'editor', 'output');
    const recipesDisclosure = colorPanel.getByTestId('professional-color-recipes-disclosure');
    if (!(await recipesDisclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await recipesDisclosure.locator('summary').click();
    }
    const recipe = colorPanel.getByTestId('professional-color-recipe-cleanPortrait');
    await recipe.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="professional-color-recipe-cleanPortrait"]')
          ?.getAttribute('data-active') === 'true',
    );
    const recipeDataset = await recipe.evaluate((element) => ({ ...element.dataset }));
    if (
      recipeDataset.active !== 'true' ||
      recipeDataset.cameraProfile !== 'camera_portrait' ||
      recipeDataset.temperature !== '6' ||
      recipeDataset.tint !== '3' ||
      recipeDataset.toneCurve !== 'soft_contrast' ||
      recipeDataset.vibrance !== '12'
    ) {
      throw new Error('Professional color recipe did not expose expected profile/tone metadata.');
    }
    await recipe.getByTestId('professional-color-recipe-summary').getByText('Profile Portrait').waitFor({
      timeout: 10_000,
    });
    await recipe.getByText('WB +6 / +3').waitFor({ timeout: 10_000 });
    await assertCompactSliderDensity(
      colorPanel.getByTestId('quick-color-controls'),
      'Temperature',
      'quick temperature',
    );
    await assertColorWorkspaceTab('Grading', 'grading', 'editor');
    await assertCompactSliderDensity(colorPanel, 'Blending', 'color grading blending');
    await assertColorWorkspaceTab('Quick', 'quick', 'grading');
    const pickerState = await colorPanel.getByTestId('color-white-balance-picker').evaluate((element) => ({
      disabled: (element as HTMLButtonElement).disabled,
      state: (element as HTMLElement).dataset.state,
    }));
    if (pickerState.state !== 'disabled' || pickerState.disabled !== true) {
      throw new Error(`White-balance picker disabled state proof failed: ${JSON.stringify(pickerState)}`);
    }
    await setRangeInput(colorPanel, 'Temperature', 12);
    await setRangeInput(colorPanel, 'Saturation', 18);
    await assertColorWorkspaceTab('Editor', 'editor', 'quick');
    await colorPanel.getByTestId('black-white-mixer-toggle').click();
    const selectiveControls = colorPanel.getByTestId('selective-color-range-controls');
    await selectiveControls.getByTestId('selective-color-range-oranges').click();
    await assertCompactSliderDensity(selectiveControls, 'Hue', 'selective hue');
    await setRangeInput(selectiveControls, 'Hue', 8);
    await setRangeInput(selectiveControls, 'Saturation', 22);
    await setRangeInput(selectiveControls, 'Luminance', -11);
    selectiveColorUiProofDatasetSchema.parse(await selectiveControls.evaluate((element) => ({ ...element.dataset })));
    await selectiveControls.getByTestId('selective-color-reset-active-range').click();
    await waitForColorAdjustmentProofText('Orange 0');
    await waitForColorAdjustmentProofText('Orange sat 0');
    await waitForColorAdjustmentProofText('Orange lum 0');
    const resetDataset = await selectiveControls.evaluate((element) => ({ ...element.dataset }));
    if (resetDataset.dirty !== 'false') {
      throw new Error('Selective color reset did not clear active range dirty state.');
    }
    toneColorCommandEnvelopeV1Schema.parse({
      ...sampleToneColorCommandEnvelopeV1,
      commandId: 'command_tone_color_selective_orange_visual_smoke',
      commandType: 'toneColor.adjustHsl',
      correlationId: 'corr_tone_color_selective_orange_visual_smoke',
      dryRun: true,
      idempotencyKey: 'idem_tone_color_selective_orange_visual_smoke',
      parameters: {
        band: 'orange',
        hueShiftDegrees: 8,
        luminance: -11,
        saturation: 22,
      },
    });
    await assertColorWorkspaceTab('Output', 'output', 'editor');
    await assertCompactRangeDensity(
      colorPanel.getByTestId('skin-tone-uniformity-controls').locator('input[type="range"]').first(),
      'skin tone uniformity',
    );
    await waitForColorAdjustmentProofText('Temp 12');
    await waitForColorAdjustmentProofText('Sat 18');
    await waitForColorAdjustmentProofText('CB on');
    await waitForColorAdjustmentProofText('CM on');
    colorBalanceCompareProofDatasetSchema.parse(
      await page.getByTestId('color-balance-compare-strip').evaluate((element) => ({ ...element.dataset })),
    );
    blackWhiteMixerParityProofDatasetSchema.parse(
      await page.getByTestId('black-white-mixer-parity-strip').evaluate((element) => ({ ...element.dataset })),
    );
    cameraProfileInputTransformPreviewProofSchema.parse(
      await page.getByTestId('camera-profile-input-transform-preview').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('color-balance-before').getByText('R 173', { exact: false }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-balance-after').getByText('R 175 / G 122 / B 85', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-balance-gamut-warning').getByText('No gamut clipping', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await waitForColorAdjustmentProofText('Skin 0.725');
    const skinToneInspector = await colorPanel
      .getByTestId('skin-tone-uniformity-controls')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      Number.parseFloat(skinToneInspector.inspectorImprovement ?? '0') <= 0 ||
      Number.parseFloat(skinToneInspector.inspectorDistanceAfter ?? '1') >=
        Number.parseFloat(skinToneInspector.inspectorDistanceBefore ?? '0')
    ) {
      throw new Error('Skin-tone uniformity inspector did not prove measured improvement.');
    }
    await colorPanel.evaluate((element) => {
      element.scrollTop = 0;
    });
    return;
  }

  if (mode === 'detail-workspace') {
    await page.getByRole('button', { name: '100% crop' }).click();
    await page.getByRole('button', { name: 'Split compare' }).click();
    await page.getByRole('button', { name: 'Denoise luma' }).click();
    await page.getByRole('button', { name: 'Deblur strength' }).click();
    await page.getByRole('button', { name: 'Apply recipe' }).click();
    detailWorkspaceProofSchema.parse(
      await page.getByTestId('detail-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('detail-warning').getByText('Ringing review', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === 'detail-dust-spot') {
    await page.getByText('Show dust overlay', { exact: true }).click();
    await page.getByRole('slider', { name: 'Sensitivity' }).fill('72');
    await page.getByRole('slider', { name: 'Min spot radius' }).fill('6');
    detailDustSpotProofSchema.parse(
      await page.getByTestId('detail-dust-spot-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByText('Visualization only', { exact: false }).waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === 'film-look-browser') {
    await page.getByTestId('film-look-rendered-proof').getByText('Rendered parity proof', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('film-look-rendered-proof').getByText('Mono Silver', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('film-look-rendered-proof').getByText('7e4b525fd7be754b', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Warm Print', { exact: true }).click();
    await page.getByTestId('film-look-adjustment-proof').getByText('Temp 5').waitFor({ timeout: 10_000 });
    await page.getByRole('slider', { name: 'Strength' }).fill('100');
    await page.getByTestId('film-look-adjustment-proof').getByText('Temp 8', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Compare A: Warm Print').click();
    await page.getByLabel('Save Warm Print as preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Saved Warm Print 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Share Warm Print preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Exported Warm Print 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Mono Silver', { exact: true }).click();
    await page.getByTestId('film-look-adjustment-proof').getByText('Temp 0', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('film-look-adjustment-proof').getByText('Grain 17', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByRole('slider', { name: 'Strength' }).fill('100');
    await page.getByTestId('film-look-adjustment-proof').getByText('Grain 22', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Compare A: Mono Silver').click();
    await page.getByLabel('Save Mono Silver as preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Saved Mono Silver 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Share Mono Silver preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Exported Mono Silver 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await assertFilmLookExportProof(page);
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabBatchColorWorkspace) {
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabWorkspace).waitFor({ timeout: 10_000 });
    const acquisitionHealth = page.getByTestId('negative-lab-acquisition-health');
    await acquisitionHealth.waitFor({ timeout: 10_000 });
    const acquisitionSeverity = await acquisitionHealth.getAttribute('data-acquisition-severity');
    if (acquisitionSeverity !== 'review') {
      throw new Error(
        `Negative Lab batch-color acquisition severity expected review, received ${acquisitionSeverity}.`,
      );
    }
    await page.getByTestId('negative-lab-acquisition-severity').waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-acquisition-source-tiff_scan').waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-acquisition-source-jpeg_lossy').waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-acquisition-warning-lab_processed_input_for_negative_lab').waitFor({
      timeout: 10_000,
    });
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabBatchReadiness).waitFor({ timeout: 10_000 });
    await page
      .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabQueuedCount)
      .getByText('2 queued', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAcceptBatchPlan).click();
    await page
      .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAcceptBatchPlan)
      .getByText('Batch plan accepted', { exact: true })
      .waitFor({ timeout: 10_000 });
    const colorSliders = page.locator('input[type="range"]');
    await colorSliders.nth(1).fill('1.23');
    await colorSliders.nth(2).fill('0.91');
    await colorSliders.nth(3).fill('1.14');
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAcceptBatchPlan).click();
    await page
      .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAcceptBatchPlan)
      .getByText('Batch plan accepted', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabExportJpegProof).click();
    await page.getByRole('button', { name: 'Convert & Save All (2)' }).click();
    await page.waitForFunction(() =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => call.command === 'convert_negatives'),
    );
    await assertNegativeLabBatchColorInvokeProof(page);
    await page
      .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabSavedPathProof)
      .getByText('/tmp/rawengine-negative-smoke-positive.tif', { exact: true })
      .waitFor({ timeout: 10_000 });
    const batchSavedPathProof = await page
      .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabSavedPathProof)
      .evaluate((element) => ({ ...element.dataset }));
    if (
      batchSavedPathProof.openedPositiveInEditor !== 'true' ||
      batchSavedPathProof.openedPath !== '/tmp/rawengine-negative-smoke-positive.tif' ||
      batchSavedPathProof.refreshBeforeOpen !== 'true' ||
      batchSavedPathProof.optOutRefreshed !== 'true' ||
      batchSavedPathProof.optOutOpenedPath !== '' ||
      batchSavedPathProof.startedFromNonTargetEditorImage !== 'true' ||
      batchSavedPathProof.thumbnailRequested !== 'true'
    ) {
      throw new Error('Negative Lab batch save did not open the saved positive in the editor handoff.');
    }
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabPublicExportReview) {
    negativeLabPublicExportReviewProofSchema.parse(
      await page.getByTestId('negative-lab-public-export-review-proof').evaluate((element) => ({ ...element.dataset })),
    );
    for (const testId of ['negative-lab-public-export-source', 'negative-lab-public-export-output']) {
      const loaded = await page.getByTestId(testId).evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      if (!loaded) throw new Error(`${testId} did not load a nonblank public negative image.`);
    }
    await page
      .getByTestId('negative-lab-public-export-artifact-handoff')
      .getByText('110-format-ericht-negative-cc0-320-Positive.jpg', { exact: false })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.NegativeLabRealRawPrivateReview) {
    negativeLabRealRawPrivateReviewProofSchema.parse(
      await page
        .getByTestId('negative-lab-real-raw-private-review-proof')
        .evaluate((element) => ({ ...element.dataset })),
    );
    const loaded = await page.getByTestId('negative-lab-real-raw-private-output').evaluate((element) => {
      const image = element as HTMLImageElement;
      return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    });
    if (!loaded) throw new Error('Negative Lab private RAW positive image did not load.');
    await page
      .getByTestId('negative-lab-real-raw-private-artifact-handoff')
      .getByText('alaska-negative-lab-v1-Positive.jpg', { exact: false })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode !== VISUAL_SMOKE_SCENARIO_IDS.NegativeLabWorkspace) return;

  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabWorkspace).waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    (workspaceProofTestId) =>
      document.querySelector(`[data-testid="${workspaceProofTestId}"]`)?.dataset.previewReady === 'true',
    VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabWorkspaceProof,
  );
  negativeLabWorkspaceProofDatasetSchema.parse(
    await page
      .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabWorkspaceProof)
      .evaluate((element) => ({ ...element.dataset })),
  );
  await page.getByTestId('negative-lab-profile-comparison-matrix').waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => {
    const renderedPreviews = document.querySelectorAll(
      '[data-testid^="negative-lab-profile-comparison-rendered-preview-"]',
    );
    return renderedPreviews.length >= 2;
  });
  const renderedProfileCandidateProof = await page.evaluate(() => {
    const matrix = document.querySelector('[data-testid="negative-lab-profile-comparison-matrix"]');
    const rows = [...document.querySelectorAll('[data-testid^="negative-lab-profile-comparison-row-"]')].map((row) => {
      const element = row as HTMLElement;
      return {
        baseSampleReference: element.dataset.baseSampleReference ?? '',
        identicalOutputReason: element.dataset.identicalOutputReason ?? '',
        imageHash: element.dataset.imageHash ?? '',
        mutationBrowsingMutatesEditGraph: element.dataset.mutationBrowsingMutatesEditGraph ?? '',
        mutationRequiresAcceptedPlan: element.dataset.mutationRequiresAcceptedPlan ?? '',
        outputTag: element.dataset.outputTag ?? '',
        previewHash: element.dataset.previewHash ?? '',
        previewRenderStatus: element.dataset.previewRenderStatus ?? '',
        profileProvenanceHash: element.dataset.profileProvenanceHash ?? '',
        renderHash: element.dataset.renderHash ?? '',
        runtimeApplySelectable: element.dataset.runtimeApplySelectable ?? '',
        warningCodes: element.dataset.warningCodes ?? '',
      };
    });
    const previewCalls = (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).filter(
      (call) => call.command === 'preview_negative_conversion',
    );

    return {
      previewCallCount: previewCalls.length,
      previewParamProofs: previewCalls.map((call) =>
        JSON.stringify({
          baseFogSample: call.args?.params?.base_fog_sample ?? null,
          blueWeight: call.args?.params?.blue_weight ?? null,
          greenWeight: call.args?.params?.green_weight ?? null,
          redWeight: call.args?.params?.red_weight ?? null,
        }),
      ),
      previewReturnCount: window.__RAWENGINE_NEGATIVE_LAB_PREVIEW_RETURNS__?.length ?? 0,
      rows,
      selectedProfileId: (matrix as HTMLElement | null)?.dataset.selectedProfileId ?? '',
    };
  });
  const readyCandidateRows = renderedProfileCandidateProof.rows.filter(
    (row) => row.previewRenderStatus === 'ready' && row.imageHash.length > 0,
  );
  if (readyCandidateRows.length < 2) {
    throw new Error(`Negative Lab rendered profile candidate proof expected at least 2 ready previews.`);
  }
  const uniqueImageHashes = new Set(readyCandidateRows.map((row) => row.imageHash));
  if (uniqueImageHashes.size < 2 && !readyCandidateRows.every((row) => row.identicalOutputReason.length > 0)) {
    throw new Error('Negative Lab rendered profile candidates must expose distinct image hashes or identical reason.');
  }
  if (new Set(renderedProfileCandidateProof.previewParamProofs).size < 2) {
    throw new Error('Negative Lab rendered profile candidates did not invoke preview with distinct profile params.');
  }
  if (renderedProfileCandidateProof.previewCallCount < 3 || renderedProfileCandidateProof.previewReturnCount < 3) {
    throw new Error('Negative Lab rendered profile candidate proof did not record backend preview calls.');
  }
  for (const row of readyCandidateRows.slice(0, 2)) {
    z.object({
      baseSampleReference: z.string().min(1),
      imageHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      mutationBrowsingMutatesEditGraph: z.literal('false'),
      mutationRequiresAcceptedPlan: z.literal('true'),
      outputTag: z.literal('preview_display'),
      previewHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      profileProvenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      renderHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      runtimeApplySelectable: z.literal('true'),
      warningCodes: z.string().min(1),
    }).parse(row);
  }
  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabWorkflowRail).waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-health').waitFor({ timeout: 10_000 });
  z.object({
    acquisitionSeverity: z.literal('review'),
    lossyCount: z.literal('1'),
    rawLikeCount: z.literal('0'),
    tiffScanCount: z.literal('1'),
    unknownCount: z.literal('0'),
    warningCodes: z.literal('lossy_source_for_negative_lab,lab_processed_input_for_negative_lab,mixed_source_families'),
    warningCount: z.literal('3'),
  }).parse(await page.getByTestId('negative-lab-acquisition-health').evaluate((element) => ({ ...element.dataset })));
  await page
    .getByTestId('negative-lab-acquisition-severity')
    .getByText('Review source assumptions', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-source-tiff_scan').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-source-jpeg_lossy').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-warning-lab_processed_input_for_negative_lab').waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-acquisition-warning-lossy_source_for_negative_lab').waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-acquisition-warning-mixed_source_families').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-scan-input-guidance').waitFor({ timeout: 10_000 });
  z.object({
    preflightBasis: z.literal('path_extension_only'),
  }).parse(await page.getByTestId('negative-lab-scan-input-guidance').evaluate((element) => ({ ...element.dataset })));
  const scanGuidanceItemCount = await page
    .locator('[data-testid^="negative-lab-scan-input-guidance-scanInputGuidance"]')
    .count();
  if (scanGuidanceItemCount !== 5) {
    throw new Error(`Expected 5 scan input guidance items, got ${scanGuidanceItemCount}.`);
  }
  await page.getByText('Scan input guidance', { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-scan-input-guidance-scanInputGuidancePreferred').waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-scan-input-guidance-scanInputGuidanceAvoidPositive').waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-scan-input-guidance-scanInputGuidanceAvoidProofs').waitFor({
    timeout: 10_000,
  });
  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabBatchReadiness).waitFor({ timeout: 10_000 });
  const negativeLabBatchReadinessDataset = await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabBatchReadiness)
    .evaluate((element) => ({ ...element.dataset }));
  if (process.env.RAWENGINE_DEBUG_NEGATIVE_LAB_BATCH_READINESS === '1') {
    console.log(JSON.stringify(negativeLabBatchReadinessDataset));
  }
  z.object({
    rollNormalizationAffectedCount: z.literal('2'),
    rollNormalizationExposureDelta: z.enum(['0', '0.15']),
    rollNormalizationMode: z.literal('density_and_balance'),
    rollNormalizationPositiveCount: z.literal('2'),
    rollNormalizationUnaffectedCount: z.literal('0'),
    rollNormalizationWhiteBalanceDelta: z.enum(['0', '0.04']),
  }).parse(negativeLabBatchReadinessDataset);
  await page.getByTestId('negative-lab-roll-normalization-plan').waitFor({ timeout: 10_000 });
  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAgentActivity).waitFor({ timeout: 10_000 });
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAgentCommandSource)
    .getByText(NegativeLabAppServerCommandName.BatchSummary, { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAgentDryRunState)
    .getByText('Dry-run ready', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAgentCommitState)
    .getByText('Not committed', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-agent-affected-frames').getByText('Affected 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-navigator').waitFor({ timeout: 10_000 });
  negativeLabRollQueueSummaryProofSchema.parse(
    await page.getByTestId('negative-lab-roll-queue-summary').evaluate((element) => ({ ...element.dataset })),
  );
  await page
    .getByTestId('negative-lab-roll-selected-frame')
    .getByText('synthetic-color-negative-001.tif', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-roll-selected-export').getByText('Export blocked', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId('negative-lab-roll-frame-count')
    .getByText('Frames 2', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-roll-frame-1').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-dust-review').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-qc-proof-artifact').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-qc-overlay-controls').waitFor({ timeout: 10_000 });
  const qcProofArtifactBefore = await page
    .getByTestId('negative-lab-qc-proof-artifact')
    .evaluate((element) => ({ ...element.dataset }));
  if (qcProofArtifactBefore.overlayFrameBounds !== 'true' || qcProofArtifactBefore.overlayDensityWarnings !== 'true') {
    throw new Error(`Negative Lab QC overlays should default on: ${JSON.stringify(qcProofArtifactBefore)}`);
  }
  await page.getByTestId('negative-lab-qc-overlay-frame-bounds').click();
  const qcProofRowAfterBoundsToggle = await page
    .getByTestId('negative-lab-qc-proof-row-0')
    .evaluate((element) => ({ ...element.dataset }));
  if (qcProofRowAfterBoundsToggle.frameBoundaryOverlay !== 'hidden') {
    throw new Error(
      `Negative Lab frame-boundary overlay toggle failed: ${JSON.stringify(qcProofRowAfterBoundsToggle)}`,
    );
  }
  await page.getByTestId('negative-lab-qc-overlay-frame-bounds').click();
  await page.getByTestId('negative-lab-retouch-count').getByText('Retouch 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-count').getByText('Frames 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-warning-count').getByText('Warnings 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-health-controls').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-frame-health-sort').selectOption('warning_severity');
  await page.getByTestId('negative-lab-frame-health-controls').evaluate((element) => {
    if (element.dataset.sort !== 'warning_severity') {
      throw new Error('Negative Lab frame health sort did not switch to warning severity.');
    }
  });
  await page.getByTestId('negative-lab-frame-health-filter').selectOption('review');
  await page
    .getByTestId('negative-lab-frame-health-visible-count')
    .getByText('1/2 visible', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-frame-source-0').getByText('JPEG/lossy', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-disposition-0').getByText('Review', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-disposition-1').getByText('Review', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-review-frame-count').getByText('Review 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId('negative-lab-frame-acquisition-warning-chip-lossy_source_for_negative_lab')
    .getByText('Lossy input', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-frame-health-filter').selectOption('all');
  await page
    .getByTestId('negative-lab-frame-health-visible-count')
    .getByText('2/2 visible', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-planned-apply-count').getByText('Apply 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-skipped-frame-count').getByText('Skip 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId('negative-lab-convert-save-blocked-reason')
    .getByText('Base pending', { exact: true })
    .waitFor({ timeout: 10_000 });
  z.object({
    canSave: z.literal('false'),
    saveBlockedReason: z.literal('modals.negativeConversion.basePending'),
  }).parse(await page.getByTestId('negative-lab-convert-save-action').evaluate((element) => ({ ...element.dataset })));
  if (!(await page.getByTestId('negative-lab-convert-save-action').isDisabled())) {
    throw new Error('Negative Lab convert/save action should be disabled while base estimation is pending.');
  }
  await page.getByTestId('negative-lab-frame-health-sort').selectOption('roll_order');
  await page.getByTestId('negative-lab-active-scan-1').click();
  await page.getByTestId('negative-lab-roll-frame-status-1').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-runtime-1').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-frame-health-status-1').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-health-status-0').getByText('Queued', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-active-scan-0').click();
  await page.getByTestId('negative-lab-stock-registry').waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-stock-registry')
    .getByText('5 runtime-safe / 12 reference-only', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-stock-family-negative_lab.stock_family.c41_portrait_color_negative.v1')
    .getByText('descriptive generic only', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-stock-family-negative_lab.stock_family.c41_portrait_color_negative.v1').click();
  await page
    .getByTestId('negative-lab-preset-process')
    .getByText('C-41 family / Soft portrait color negative', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-selected-stock-references')
    .getByText('Reference coverage', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-selected-stock-reference-count')
    .getByText('2', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-selected-stock-reference-negative_lab.stock_metadata.kodak_portra_400.v1')
    .getByText('Kodak Portra 400 - ISO 400', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-stock-family-negative_lab.stock_family.ecn2_cinema_negative.v1')
    .getByText('legal review required', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-stock-metadata').waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-stock-metadata')
    .getByText('6 color / 4 B&W / 3 slide / 3 cinema', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preset-inspector').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preset-film-class').getByText('Color negative', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Black and White Ortho' }).click();
  await page
    .getByTestId('negative-lab-preset-process')
    .getByText('Silver gelatin family / Ortho-style silver negative', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-film-class')
    .getByText('Black and white silver', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-claim-level')
    .getByText('Generic starting point', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-runtime-status')
    .getByText('Runtime applied', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-intent')
    .getByText('Orthochromatic-style tonal separation with reduced red response.', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preset-metadata').waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-speed-class')
    .getByText('Low to medium speed family', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-contrast-curve')
    .getByText('Medium separation curve', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-color-response')
    .getByText('Color response: Reduced red response and stronger blue weighting for ortho-style separation.', {
      exact: true,
    })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-claim-policy')
    .getByText('Generic family descriptor only; no manufacturer, stock, or emulation claim.', { exact: true })
    .waitFor({ timeout: 10_000 });
  const measuredProfileRow = page.getByTestId('negative-lab-profile-row-negative_lab.measured.c41.process_family.v1');
  await measuredProfileRow.scrollIntoViewIfNeeded();
  await measuredProfileRow.getByTestId('negative-lab-profile-measured-badge').getByText('Measured').waitFor({
    timeout: 10_000,
  });
  await measuredProfileRow.getByTestId('negative-lab-profile-evidence-count').getByText('1 fixture(s)').waitFor({
    timeout: 10_000,
  });
  await measuredProfileRow.click();
  await page
    .getByTestId('negative-lab-preset-claim-level')
    .getByText('Measured profile', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-process')
    .getByText('c41 color negative', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-provenance')
    .getByText('Fixture-measured process-family profile from 1 approved fixture(s); no named-stock emulation claim.', {
      exact: true,
    })
    .waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Black and White Ortho' }).click();
  await page.getByTestId('negative-lab-auto-base-fog').click();
  await page.getByTestId('negative-lab-base-status').getByText('Base 91%', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-sample-left-edge').click();
  await page.getByTestId('negative-lab-roll-warning-count').getByText('Warnings 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId('negative-lab-base-scope-label')
    .getByText('Base applies to active frame', { exact: true })
    .waitFor({
      timeout: 10_000,
    });
  await page.getByTestId('negative-lab-promote-base-roll').click();
  await page.getByTestId('negative-lab-base-scope-label').getByText('Base applies to roll', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-selected-base').getByText('Roll base 91%', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-warning-count').getByText('Warnings 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-review-frame-count').getByText('Review 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-disposition-0').getByText('Apply', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-disposition-1').getByText('Review', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-health-filter').selectOption('review');
  await page.getByTestId('negative-lab-frame-health-visible-count').getByText('1/2 visible', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-qc-approved-visible').click();
  await page.getByTestId('negative-lab-qc-approved-count').getByText('Approved 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-scope-ready').click();
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabQueuedCount)
    .getByText('2 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-qc-rejected-visible').click();
  await page.getByTestId('negative-lab-qc-rejected-count').getByText('Rejected 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const rejectedOverlayDataset = await page
    .getByTestId('negative-lab-qc-proof-row-1')
    .evaluate((element) => ({ ...element.dataset }));
  if (rejectedOverlayDataset.rejectedMarkerOverlay !== 'visible') {
    throw new Error(`Negative Lab rejected marker overlay failed: ${JSON.stringify(rejectedOverlayDataset)}`);
  }
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabQueuedCount)
    .getByText('1 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-qc-pending-visible').click();
  await page.getByTestId('negative-lab-qc-rejected-count').getByText('Rejected 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-qc-approved-count').getByText('Approved 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabQueuedCount)
    .getByText('1 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-qc-rejected-visible').click();
  await page.getByTestId('negative-lab-qc-rejected-count').getByText('Rejected 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const rollBaseScopeDataset = await page
    .getByTestId('negative-lab-roll-queue-summary')
    .evaluate((element) => ({ ...element.dataset }));
  if (rollBaseScopeDataset.baseScope !== 'roll') {
    throw new Error('Negative Lab roll queue summary did not switch to roll base scope.');
  }
  await page
    .getByTestId('negative-lab-base-rgb-readout')
    .getByText('183 / 147 / 112', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-base-density-readout')
    .getByText('0.145 / 0.238 / 0.356', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-density-spread').getByText('0.211', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-dominant-density-channel').getByText('Blue', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const setFrameExposureOffset = async (value: number) => {
    await page.getByTestId('negative-lab-frame-exposure-override-control').evaluate((element, nextValue) => {
      const input = element.querySelector('input[type="range"]');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('Missing Negative Lab frame exposure range input.');
      }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (nextValue !== 0) {
        valueSetter?.call(input, '0');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      valueSetter?.call(input, String(nextValue));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  await setFrameExposureOffset(0.5);
  await page
    .getByTestId('negative-lab-recipe-frame-exposure-offset')
    .getByText('+0.50', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-roll-frame-exposure-override-0').getByText('+0.50', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some(
      (call) =>
        call.command === 'preview_negative_conversion' && JSON.stringify(call.args ?? {}).includes('"exposure":0.45'),
    ),
  );
  await page.getByTestId('negative-lab-reset-frame-exposure').click();
  await page
    .getByTestId('negative-lab-recipe-frame-exposure-offset')
    .getByText('0.00', { exact: true })
    .waitFor({ timeout: 10_000 });
  await setFrameExposureOffset(0.5);
  await page
    .getByTestId('negative-lab-recipe-frame-exposure-offset')
    .getByText('+0.50', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-patch-role-neutral').click();
  await page.getByTestId('negative-lab-pick-viewer-patch').click();
  const previewImageBox = await page.getByTestId('negative-lab-preview-image').boundingBox();
  if (previewImageBox === null) {
    throw new Error('Negative Lab preview image box missing for patch pick smoke.');
  }
  await page.mouse.move(
    previewImageBox.x + previewImageBox.width * 0.2,
    previewImageBox.y + previewImageBox.height * 0.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    previewImageBox.x + previewImageBox.width * 0.5,
    previewImageBox.y + previewImageBox.height * 0.45,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await page.getByTestId('negative-lab-patch-probe-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-patch-probe-area').waitFor({ timeout: 10_000 });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => {
      const sampleRect = call.args?.sampleRect;
      return (
        call.command === 'estimate_negative_base_fog' &&
        sampleRect !== null &&
        Math.abs((sampleRect?.x ?? 0) - 0.2) < 0.01 &&
        Math.abs((sampleRect?.y ?? 0) - 0.2) < 0.01 &&
        Math.abs((sampleRect?.width ?? 0) - 0.3) < 0.01 &&
        Math.abs((sampleRect?.height ?? 0) - 0.25) < 0.01
      );
    }),
  );
  await page.getByTestId('negative-lab-patch-probe-highlight-patch').click();
  await page.getByTestId('negative-lab-patch-probe-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-patch-probe-readout').getByText('Highlight patch', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const previewInvokeCountBeforeHighlightRecovery = await page.evaluate(
    () =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).filter((call) => call.command === 'preview_negative_conversion')
        .length,
  );
  await page.getByTestId('negative-lab-analyze-highlight-recovery').click();
  await page.getByTestId('negative-lab-highlight-recovery-suggestion').waitFor({ timeout: 10_000 });
  const previewInvokeCountAfterHighlightRecovery = await page.evaluate(
    () =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).filter((call) => call.command === 'preview_negative_conversion')
        .length,
  );
  if (previewInvokeCountAfterHighlightRecovery !== previewInvokeCountBeforeHighlightRecovery) {
    throw new Error('Negative Lab highlight recovery changed preview before explicit apply.');
  }
  await page
    .getByTestId('negative-lab-highlight-recovery-offset')
    .getByText('+0.15', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-highlight-recovery-status').getByText('Suggested', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-highlight-recovery-risk').getByText('Low', { exact: true }).waitFor({
    timeout: 10_000,
  });
  if ((await page.locator('[data-testid="negative-lab-highlight-recovery-apply-warning"]').count()) !== 0) {
    throw new Error('Negative Lab highlight recovery safe suggestion showed an apply warning.');
  }
  await page.getByTestId('negative-lab-apply-highlight-recovery').click();
  await page
    .getByTestId('negative-lab-recipe-frame-exposure-offset')
    .getByText('+0.15', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some(
      (call) =>
        call.command === 'preview_negative_conversion' && JSON.stringify(call.args ?? {}).includes('"exposure":0.1'),
    ),
  );
  const setFrameRgbBalanceOffset = async (channelIndex: number, value: number) => {
    await page.getByTestId('negative-lab-frame-rgb-balance-override-control').evaluate(
      (element, payload) => {
        const input = element.querySelectorAll('input[type="range"]').item(payload.channelIndex);
        if (!(input instanceof HTMLInputElement)) {
          throw new Error('Missing Negative Lab frame RGB balance range input.');
        }
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        valueSetter?.call(input, String(payload.value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { channelIndex, value },
    );
  };
  await setFrameRgbBalanceOffset(0, 0.08);
  await setFrameRgbBalanceOffset(1, -0.02);
  await setFrameRgbBalanceOffset(2, -0.06);
  await page
    .getByTestId('negative-lab-recipe-frame-rgb-balance-offset')
    .getByText('Effective frame RGB R +0.08 / G -0.02 / B -0.06', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-roll-frame-rgb-balance-override-0').getByText('RGB', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => {
      const args = JSON.stringify(call.args ?? {});
      return (
        call.command === 'preview_negative_conversion' &&
        args.includes('"red_weight":1.15') &&
        args.includes('"green_weight":0.94') &&
        args.includes('"blue_weight":1.12')
      );
    }),
  );
  await page.getByTestId('negative-lab-patch-probe-shadow-patch').click();
  await page.getByTestId('negative-lab-patch-probe-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-patch-probe-readout').getByText('Shadow patch', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const previewInvokeCountBeforeShadowBlackPoint = await page.evaluate(
    () =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).filter((call) => call.command === 'preview_negative_conversion')
        .length,
  );
  await page.getByTestId('negative-lab-analyze-shadow-black-point').click();
  await page.getByTestId('negative-lab-shadow-black-point-suggestion').waitFor({ timeout: 10_000 });
  const previewInvokeCountAfterShadowBlackPoint = await page.evaluate(
    () =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).filter((call) => call.command === 'preview_negative_conversion')
        .length,
  );
  if (previewInvokeCountAfterShadowBlackPoint !== previewInvokeCountBeforeShadowBlackPoint) {
    throw new Error('Negative Lab shadow black-point suggestion changed preview before explicit apply.');
  }
  await page.getByTestId('negative-lab-shadow-black-point-value').getByText('0.12', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-shadow-black-point-status').getByText('Suggested', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-shadow-black-point-risk').getByText('Low', { exact: true }).waitFor({
    timeout: 10_000,
  });
  if ((await page.locator('[data-testid="negative-lab-shadow-black-point-apply-warning"]').count()) !== 0) {
    throw new Error('Negative Lab shadow black-point safe suggestion showed an apply warning.');
  }
  await page.getByTestId('negative-lab-apply-shadow-black-point').click();
  await page.getByTestId('negative-lab-recipe-black-point').getByText('0.12', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some(
      (call) =>
        call.command === 'preview_negative_conversion' &&
        JSON.stringify(call.args ?? {}).includes('"black_point":0.12'),
    ),
  );
  const setPrintEndpoint = async (testId: string, value: number) => {
    await page.getByTestId(testId).evaluate((element, nextValue) => {
      const input = element.querySelector('input[type="range"]');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('Missing Negative Lab print endpoint range input.');
      }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, String(nextValue));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  await setPrintEndpoint('negative-lab-black-point-control', 0.16);
  await setPrintEndpoint('negative-lab-white-point-control', 0.86);
  await page.getByTestId('negative-lab-recipe-black-point').getByText('0.16', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-recipe-white-point').getByText('0.86', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some(
      (call) =>
        call.command === 'preview_negative_conversion' &&
        JSON.stringify(call.args ?? {}).includes('"black_point":0.16') &&
        JSON.stringify(call.args ?? {}).includes('"white_point":0.86'),
    ),
  );
  await page.getByTestId('negative-lab-neutrality-status').getByText('Strong cast', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-patch-probe-shadow-patch').click();
  await page.getByTestId('negative-lab-patch-probe-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-patch-probe-readout').getByText('Shadow patch', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-patch-probe-density-spread').getByText('0.211', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-patch-probe-dominant-channel').getByText('Blue', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const previewInvokeCountBeforeNeutralSuggestion = await page.evaluate(
    () =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).filter((call) => call.command === 'preview_negative_conversion')
        .length,
  );
  await page.getByTestId('negative-lab-suggest-neutral-patch-rgb').click();
  await page.getByTestId('negative-lab-neutral-patch-rgb-suggestion').waitFor({ timeout: 10_000 });
  const previewInvokeCountAfterNeutralSuggestion = await page.evaluate(
    () =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).filter((call) => call.command === 'preview_negative_conversion')
        .length,
  );
  if (previewInvokeCountAfterNeutralSuggestion !== previewInvokeCountBeforeNeutralSuggestion) {
    throw new Error('Negative Lab neutral patch suggestion changed preview before explicit apply.');
  }
  await page
    .getByTestId('negative-lab-neutral-patch-rgb-offset')
    .getByText('Effective frame RGB R +0.07 / G -0.03 / B -0.02', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-neutral-patch-risk').getByText('High', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-neutral-patch-application-risk').getByText('Low', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId('negative-lab-neutral-patch-correction-magnitude')
    .getByText('+0.07', { exact: true })
    .waitFor({ timeout: 10_000 });
  if ((await page.locator('[data-testid="negative-lab-neutral-patch-apply-warning"]').count()) !== 0) {
    throw new Error('Negative Lab neutral patch safe suggestion showed an apply warning.');
  }
  await page.getByTestId('negative-lab-apply-neutral-patch-rgb').click();
  await page
    .getByTestId('negative-lab-recipe-frame-rgb-balance-offset')
    .getByText('Effective frame RGB R +0.07 / G -0.03 / B -0.02', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => {
      const args = JSON.stringify(call.args ?? {});
      return (
        call.command === 'preview_negative_conversion' &&
        args.includes('"red_weight":1.14') &&
        args.includes('"green_weight":0.93') &&
        args.includes('"blue_weight":1.16')
      );
    }),
  );
  await page.getByTestId('negative-lab-roll-frame-1').click();
  await page.getByTestId('negative-lab-roll-frame-status-1').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  if ((await page.locator('[data-testid="negative-lab-roll-frame-rgb-balance-override-1"]').count()) !== 0) {
    throw new Error('Negative Lab neutral patch RGB suggestion leaked into neighboring frame.');
  }
  await page
    .getByTestId('negative-lab-recipe-frame-rgb-balance-offset')
    .getByText('Effective frame RGB R 0.00 / G 0.00 / B 0.00', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => {
      const args = JSON.stringify(call.args ?? {});
      return (
        call.command === 'preview_negative_conversion' &&
        args.includes('"red_weight":1.07') &&
        args.includes('"green_weight":0.96') &&
        args.includes('"blue_weight":1.18')
      );
    }),
  );
  await page.getByTestId('negative-lab-roll-frame-0').click();
  await page.getByTestId('negative-lab-roll-frame-status-0').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId('negative-lab-recipe-frame-rgb-balance-offset')
    .getByText('Effective frame RGB R +0.07 / G -0.03 / B -0.02', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-reset-frame-rgb-balance').click();
  await page
    .getByTestId('negative-lab-recipe-frame-rgb-balance-offset')
    .getByText('Effective frame RGB R 0.00 / G 0.00 / B 0.00', { exact: true })
    .waitFor({ timeout: 10_000 });
  if ((await page.locator('[data-testid="negative-lab-roll-frame-rgb-balance-override-0"]').count()) !== 0) {
    throw new Error('Negative Lab frame RGB reset did not clear the active-frame badge.');
  }
  await page.getByTestId('negative-lab-suggest-neutral-patch-rgb').click();
  await page.getByTestId('negative-lab-apply-neutral-patch-rgb').click();
  await page
    .getByTestId('negative-lab-recipe-frame-rgb-balance-offset')
    .getByText('Effective frame RGB R +0.07 / G -0.03 / B -0.02', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-custom-base-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-custom-base-area').getByText('Area 3%', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-measure-custom-base').click();
  await page.getByTestId('negative-lab-custom-base-rgb').getByText('183 / 147 / 112', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-apply-custom-base').click();
  await page
    .getByTestId('negative-lab-base-sample-readout')
    .getByText('Custom base sample', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some(
      (call) =>
        call.command === 'preview_negative_conversion' &&
        JSON.stringify(call.args ?? {}).includes('"base_fog_sample":{"height":0.18,"width":0.18,"x":0.25,"y":0.25}'),
    ),
  );
  await page.waitForFunction(() => {
    const proof = document.querySelector('[data-testid="negative-lab-base-preview-proof"]');
    return proof?.getAttribute('data-sample-source') === 'custom_rect';
  });
  await page.getByTestId('negative-lab-undo-base-sample').click();
  await page.getByTestId('negative-lab-base-sample-readout').getByText('Left edge', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-copy-readout').click();
  await page.getByTestId('negative-lab-copy-readout').getByText('Copied readout', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const copiedReadout = await page.evaluate(() => window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__?.at(-1) ?? '');
  if (!copiedReadout.includes('"baseDensity"') || !copiedReadout.includes('"sampleLabel"')) {
    throw new Error('Negative Lab readout copy did not include density/sample JSON.');
  }
  await page.getByTestId('negative-lab-include-toggle-1').click();
  await page.getByTestId('negative-lab-planned-apply-count').getByText('Apply 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-skipped-frame-count').getByText('Skip 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-include-toggle-1').click();
  await page.getByTestId('negative-lab-skipped-frame-count').getByText('Skip 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-export-summary-scope').getByText('Ready only', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-copy-batch-plan').click();
  await page.getByTestId('negative-lab-copy-batch-plan').getByText('Copied plan', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const copiedBatchPlan = await page.evaluate(() => window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__?.at(-1) ?? '');
  const missingBatchPlanTokens = [
    '"plannedApplyCount"',
    '"skippedFrameIds"',
    '"acquisitionReviewFrameIds"',
    '"batchScope": "ready"',
    '"dispositionCounts"',
    '"frameExposureOverrides"',
    '"effectiveExposure": 0.1',
    '"frameRgbBalanceOverrides"',
    '"rgbBalanceOffset"',
    '"redWeight": 0.07',
    '"omittedDispositionFrameIds"',
    '"negative-lab-frame-2": "rejected"',
    '"reviewFrameIds"',
  ].filter((token) => !copiedBatchPlan.includes(token));
  if (missingBatchPlanTokens.length > 0) {
    throw new Error(`Negative Lab batch plan copy missing ${missingBatchPlanTokens.join(', ')}.`);
  }
  await page.getByTestId('negative-lab-accept-batch-plan').click();
  await page
    .getByTestId('negative-lab-accept-batch-plan')
    .getByText('Batch plan accepted', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabQueuedCount)
    .getByText('1 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-export-tiff16').waitFor({ timeout: 10_000 });
  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabExportJpegProof).click();
  await page.getByRole('button', { name: 'Convert & Save Ready (1)' }).click();
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => call.command === 'convert_negatives'),
  );
  await assertNegativeLabInvokeProof(page);
  await assertNegativeLabBaseFogPreviewExportProof(page);
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabSavedPathProof)
    .getByText('/tmp/rawengine-negative-smoke-positive.tif', { exact: true })
    .waitFor({ timeout: 10_000 });
  const savedPathProof = await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabSavedPathProof)
    .evaluate((element) => ({ ...element.dataset }));
  if (
    savedPathProof.openedPositiveInEditor !== 'true' ||
    savedPathProof.openedPath !== '/tmp/rawengine-negative-smoke-positive.tif' ||
    savedPathProof.refreshBeforeOpen !== 'true' ||
    savedPathProof.optOutRefreshed !== 'true' ||
    savedPathProof.optOutOpenedPath !== '' ||
    savedPathProof.startedFromNonTargetEditorImage !== 'true'
  ) {
    throw new Error('Negative Lab save did not open the saved positive in the editor handoff.');
  }
  await page.getByTestId('negative-lab-roll-frame-0').click();
  await page.getByTestId('negative-lab-apply-roll-normalization').click();
  await page.getByTestId('negative-lab-roll-frame-exposure-override-0').getByText('+0.15', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-rgb-balance-override-0').getByText('RGB', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some(
      (call) =>
        call.command === 'preview_negative_conversion' && JSON.stringify(call.args ?? {}).includes('"exposure":0.1'),
    ),
  );
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  let serverOutput = '';
  const server = spawn('bun', ['run', 'dev', '--', '--host', host], {
    env: { ...process.env, RAWENGINE_VISUAL_SMOKE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const captureServerOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
  };

  server.stdout.on('data', captureServerOutput);
  server.stderr.on('data', captureServerOutput);

  let browser;

  try {
    const srPrivateRawProof = requiresSrPrivateRawProof ? await loadSrPrivateRawProof() : undefined;
    const focusPrivateRawProof = requiresFocusPrivateRawProof ? await loadFocusPrivateRawProof() : undefined;
    const hdrPrivateRawProof = requiresHdrPrivateRawProof ? await loadHdrPrivateRawProof() : undefined;
    const panoramaPrivateRawProof = requiresPanoramaPrivateRawProof ? await loadPanoramaPrivateRawProof() : undefined;
    const layerMaskPrivateRawProof = requiresLayerMaskPrivateRawProof
      ? await loadLayerMaskPrivateRawProof()
      : undefined;
    const negativeLabPublicExportProof = requiresNegativeLabPublicExportProof
      ? await loadNegativeLabPublicExportProof()
      : undefined;
    const negativeLabRealRawPrivateProof = requiresNegativeLabRealRawPrivateProof
      ? await loadNegativeLabRealRawPrivateProof()
      : undefined;

    await waitForDevServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport });
    await page.addInitScript(() => {
      window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__ = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__.push(text);
          },
        },
      });
    });
    if (srPrivateRawProof !== undefined) {
      await page.addInitScript((proof: SrPrivateRawBrowserProof) => {
        window.__RAWENGINE_SR_PRIVATE_RAW_PROOF__ = proof;
      }, srPrivateRawProof);
    }
    if (focusPrivateRawProof !== undefined) {
      await page.addInitScript((proof: FocusPrivateRawBrowserProof) => {
        window.__RAWENGINE_FOCUS_PRIVATE_RAW_PROOF__ = proof;
      }, focusPrivateRawProof);
    }
    if (hdrPrivateRawProof !== undefined) {
      await page.addInitScript((proof: HdrPrivateRawBrowserProof) => {
        window.__RAWENGINE_HDR_PRIVATE_RAW_PROOF__ = proof;
      }, hdrPrivateRawProof);
    }
    if (panoramaPrivateRawProof !== undefined) {
      await page.addInitScript((proof: PanoramaPrivateRawBrowserProof) => {
        window.__RAWENGINE_PANORAMA_PRIVATE_RAW_PROOF__ = proof;
      }, panoramaPrivateRawProof);
    }
    if (layerMaskPrivateRawProof !== undefined) {
      await page.addInitScript((proof: LayerMaskPrivateRawBrowserProof) => {
        window.__RAWENGINE_LAYER_MASK_PRIVATE_RAW_PROOF__ = proof;
      }, layerMaskPrivateRawProof);
    }
    if (negativeLabPublicExportProof !== undefined) {
      await page.addInitScript((proof: NegativeLabPublicExportBrowserProof) => {
        window.__RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF__ = proof;
      }, negativeLabPublicExportProof);
    }
    if (negativeLabRealRawPrivateProof !== undefined) {
      await page.addInitScript((proof: NegativeLabRealRawPrivateBrowserProof) => {
        window.__RAWENGINE_NEGATIVE_LAB_REAL_RAW_PRIVATE_PROOF__ = proof;
      }, negativeLabRealRawPrivateProof);
    }

    page.on('pageerror', (error) => {
      throw error;
    });

    for (const scenario of selectedScenarios) {
      const scenarioViewport =
        scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAdjustmentsCompact ? compactPortraitViewport : viewport;
      await page.setViewportSize(scenarioViewport);
      await page.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.appMode ?? scenario.mode}`, {
        waitUntil: 'networkidle',
      });
      await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await page.getByText(scenario.marker, { exact: true }).waitFor({ timeout: 10_000 });
      await assertSectionCount(page, scenario.sectionMinimum);
      await prepareScenario(page, scenario.mode);
      await page.screenshot({ path: scenario.outputPath, fullPage: false });
      const dimensions = await readPngDimensions(scenario.outputPath);
      if (dimensions.width !== scenarioViewport.width || dimensions.height !== scenarioViewport.height) {
        throw new Error(
          `${scenario.mode} dimensions mismatch: expected ${scenarioViewport.width}x${scenarioViewport.height}, got ${dimensions.width}x${dimensions.height}`,
        );
      }
      if (scenario.compactOutputPath !== undefined) {
        await page.setViewportSize(compactPortraitViewport);
        await page.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.appMode ?? scenario.mode}`, {
          waitUntil: 'networkidle',
        });
        await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
        await page.getByText(scenario.marker, { exact: true }).waitFor({ timeout: 10_000 });
        await assertSectionCount(page, scenario.sectionMinimum);
        await prepareScenario(page, scenario.mode);
        await page.screenshot({ path: scenario.compactOutputPath, fullPage: false });
        const compactDimensions = await readPngDimensions(scenario.compactOutputPath);
        if (
          compactDimensions.width !== compactPortraitViewport.width ||
          compactDimensions.height !== compactPortraitViewport.height
        ) {
          throw new Error(
            `${scenario.mode} compact dimensions mismatch: expected ${compactPortraitViewport.width}x${compactPortraitViewport.height}, got ${compactDimensions.width}x${compactDimensions.height}`,
          );
        }
        await page.setViewportSize(viewport);
      }
      if (scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary) {
        await page.goto(`${baseUrl}/visual-smoke.html?scenario=${VISUAL_SMOKE_SCENARIO_IDS.AdjustmentsPanelRetune}`, {
          waitUntil: 'networkidle',
        });
        await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
        await page.getByTestId('adjustments-panel-retune-heading').getByText('Basic Tone', { exact: true }).waitFor({
          timeout: 10_000,
        });
        await assertAdjustmentsPanelRetune(page);
        await page.goto(`${baseUrl}/visual-smoke.html?scenario=${VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail}`, {
          waitUntil: 'networkidle',
        });
        await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
        await assertWorkflowRailSharedScopes(page);
      }
    }

    await page.close();

    const shouldCheckHighDpi =
      requestedScenario === null || requestedScenario === VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary;
    for (const target of shouldCheckHighDpi ? highDpiTargets : []) {
      const highDpiPage = await browser.newPage({ deviceScaleFactor: target.deviceScaleFactor, viewport });
      highDpiPage.on('pageerror', (error) => {
        throw error;
      });

      await highDpiPage.goto(`${baseUrl}/visual-smoke.html?scenario=${VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary}`, {
        waitUntil: 'networkidle',
      });
      await highDpiPage.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await assertSectionCount(highDpiPage, 4);

      const outputPath = resolve(outputDir, target.name);
      await highDpiPage.screenshot({ path: outputPath, fullPage: false });
      await highDpiPage.close();

      const dimensions = await readPngDimensions(outputPath);
      const expectedWidth = viewport.width * target.deviceScaleFactor;
      const expectedHeight = viewport.height * target.deviceScaleFactor;
      if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
        throw new Error(
          `${target.name} dimensions mismatch: expected ${expectedWidth}x${expectedHeight}, got ${dimensions.width}x${dimensions.height}`,
        );
      }

      console.log(`visual-smoke ${target.name} ok ${dimensions.width}x${dimensions.height}`);
    }
    console.log(`visual-smoke ok (${selectedScenarios.map((scenario) => scenario.mode).join(', ')})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Executable doesn')) {
      console.error('Playwright Chromium is not installed. Run: bunx playwright install chromium');
    }
    if (serverOutput.trim().length > 0) {
      console.error(`Vite output excerpt:\n${serverOutput.trim()}`);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopDevServer(server);
  }
}

await main();
