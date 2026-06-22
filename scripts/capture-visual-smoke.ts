import { chromium, type Locator } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';
import { NegativeLabAppServerCommandName } from '../src/utils/negativeLabAppServerCommandNames.ts';
import { sampleToneColorCommandEnvelopeV1 } from '../packages/rawengine-schema/src/samplePayloads.ts';
import { toneColorCommandEnvelopeV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  VISUAL_SMOKE_PROOF_TEST_IDS,
  VISUAL_SMOKE_SCENARIOS,
  VISUAL_SMOKE_SCENARIO_IDS,
} from '../src/validation/visual/visualSmokeScenarios.ts';
import {
  agentArtifactReviewProofDatasetSchema,
  agentAuditTranscriptViewerProofDatasetSchema,
  agentChatProofDatasetSchema,
  agentDryRunReviewProofDatasetSchema,
  agentReviewHandoffProofDatasetSchema,
  agentSelectedFrameScopeProofDatasetSchema,
  colorBalanceCompareProofDatasetSchema,
  assertFilmLookExportProof,
  assertNegativeLabBaseFogPreviewExportProof,
  assertNegativeLabBatchColorInvokeProof,
  assertNegativeLabInvokeProof,
  commandPaletteWorkflowProofSchema,
  detailDustSpotProofSchema,
  detailWorkspaceProofSchema,
  focusReviewWorkspaceProofSchema,
  focusPrivateRawReviewProofSchema,
  focusUiSettingsProofSchema,
  hdrPrivateRawReviewProofSchema,
  hdrReviewWorkspaceProofSchema,
  hdrUiSettingsProofSchema,
  libraryWorkflowProofSchema,
  layerMaskPrivateRawReviewProofSchema,
  layerStackExportParityProofSchema,
  layerStackWorkflowProofSchema,
  maskOverlayRawProofSchema,
  panoramaPrivateRawReviewProofSchema,
  panoramaSavedReviewProofSchema,
  negativeLabWorkspaceProofDatasetSchema,
  negativeLabPublicExportReviewProofSchema,
  negativeLabRollQueueSummaryProofSchema,
  panoramaReviewWorkspaceProofSchema,
  panoramaUiSettingsProofSchema,
  selectiveColorUiProofDatasetSchema,
  superResolutionPrivateRawReviewProofSchema,
  superResolutionReviewWorkspaceProofSchema,
  superResolutionUiSettingsProofSchema,
} from './lib/visual-smoke-proofs.ts';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;
const outputDir = resolve('artifacts/visual-smoke');
const viewport = { width: 1440, height: 960 };
const scenarioArgIndex = process.argv.indexOf('--scenario');
const requestedScenario = scenarioArgIndex >= 0 ? process.argv[scenarioArgIndex + 1] : null;
const scenarios = VISUAL_SMOKE_SCENARIOS.map((scenario) => ({
  ...scenario,
  outputPath: resolve(outputDir, scenario.outputFile),
}));
const highDpiTargets = [
  { deviceScaleFactor: 1, name: 'empty-library-1x.png' },
  { deviceScaleFactor: 2, name: 'empty-library-2x.png' },
];
const selectedScenarios =
  requestedScenario === null ? scenarios : scenarios.filter((scenario) => scenario.mode === requestedScenario);
const requiresSrPrivateRawProof = selectedScenarios.some(
  (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi,
);
const requiresFocusPrivateRawProof = selectedScenarios.some(
  (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi,
);
const requiresHdrPrivateRawProof = selectedScenarios.some(
  (scenario) => scenario.mode === VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi,
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

if (selectedScenarios.length === 0) {
  throw new Error(`Unknown visual smoke scenario: ${requestedScenario ?? '<missing>'}`);
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

interface SrPrivateRawBrowserProof {
  artifactRoot: string;
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  fixtureId: string;
  previewArtifact: string;
  previewDataUrl: string;
  reconstructionPath: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  sourceCount: string;
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
  const previewArtifact = `${artifactRoot}/sr-subpixel-preview.png`;
  const resultReviewArtifact = `${artifactRoot}/sr-subpixel-result-review.png`;
  const exportReviewArtifact = `${artifactRoot}/sr-subpixel-export-review.png`;
  return {
    artifactRoot,
    exportReviewArtifact,
    exportReviewDataUrl: await readPngDataUrl(exportReviewArtifact),
    fixtureId: 'validation.computational-merge.super-resolution-subpixel.v1',
    previewArtifact,
    previewDataUrl: await readPngDataUrl(previewArtifact),
    reconstructionPath: `${artifactRoot}/sr-subpixel-reconstruction.tiff`,
    resultReviewArtifact,
    resultReviewDataUrl: await readPngDataUrl(resultReviewArtifact),
    sourceCount: '4',
  };
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
    JSON.parse(await readFile('docs/validation/negative-lab-public-export-proof-2026-06-20.json', 'utf8')),
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

async function assertSectionCount(page, minimum) {
  const sectionCount = await page.locator('[data-visual-smoke-section]').count();
  if (sectionCount < minimum) {
    throw new Error(`Expected at least ${minimum} visual smoke sections, found ${sectionCount}`);
  }
}

async function prepareScenario(page, mode) {
  if (mode === VISUAL_SMOKE_SCENARIO_IDS.CommandPaletteWorkflows) {
    const runCommand = async (query, name) => {
      await page.getByLabel('Search commands').fill(query);
      await page.getByRole('button', { name }).click();
      await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteOpen).click();
    };

    await runCommand('focus', /Open focus stacking/u);
    await runCommand('super', /Open super resolution/u);
    await runCommand('panorama', /Open panorama stitching/u);
    await runCommand('hdr', /Open HDR merge/u);
    await runCommand('negative', /Open negative lab/u);
    commandPaletteWorkflowProofSchema.parse(
      await page
        .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteWorkflowProof)
        .evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'agent-chat-ui') {
    const shell = page.getByTestId('agent-chat-shell');
    await shell.waitFor({ timeout: 10_000 });
    agentChatProofDatasetSchema.parse(await shell.evaluate((element) => ({ ...element.dataset })));
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
    const review = page.getByTestId('agent-dry-run-review');
    agentDryRunReviewProofDatasetSchema.parse(await review.evaluate((element) => ({ ...element.dataset })));
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
    await handoff
      .getByText('artifact_agent_expert_edit_demo_before_raw_2844', { exact: true })
      .waitFor({ timeout: 10_000 });
    await handoff
      .getByText('artifact_agent_expert_edit_demo_after_virtual_copy_2844', { exact: true })
      .waitFor({ timeout: 10_000 });
    await handoff.getByText('Runtime proof gallery', { exact: true }).waitFor({ timeout: 10_000 });
    await handoff.getByText('Rollback virtual copy', { exact: true }).waitFor({ timeout: 10_000 });
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
    const removedApplyActionCount = await page.getByText('Approve apply', { exact: true }).count();
    if (removedApplyActionCount !== 0) {
      throw new Error(`Agent UI-only smoke must not expose Approve apply, found ${removedApplyActionCount}.`);
    }
    return;
  }

  if (mode === 'focus-ui') {
    await page.getByRole('button', { exact: true, name: 'Auto' }).click();
    await page.getByRole('option', { name: 'Homography' }).click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Depth map/u }).click();
    await page.getByRole('button', { name: /None\s+Flattened preview/u }).click();
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
    await page
      .getByTestId('focus-artifact-handoff')
      .getByText('/tmp/rawengine-focus-stack-smoke.tif', { exact: true })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.MaskOverlayRawProof) {
    const dragSliderToPercent = async (label: string, percent: number) => {
      const slider = page.getByLabel(label);
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

  if (mode === 'layer-stack-workflow') {
    await page.getByRole('button', { name: /Portrait burn/u }).click();
    await page.getByRole('button', { name: 'Move down' }).click();
    await page.getByRole('button', { name: 'Toggle' }).click();
    await page.getByRole('button', { name: 'Add layer' }).click();
    await page.getByRole('button', { name: 'Duplicate layer' }).click();
    await page.getByRole('button', { name: 'Rename proof' }).click();
    await page.getByRole('button', { name: 'Opacity 64%' }).click();
    await page.getByRole('button', { name: 'Blend overlay' }).click();
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
    await page.getByRole('button', { name: 'Create B&W proof copy' }).click();
    await page.getByRole('button', { name: 'Compare virtual copy' }).click();
    libraryWorkflowProofSchema.parse(
      await page.getByTestId('library-workflow-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('library-virtual-copy').getByText('vc-dsc-0002-bw-proof', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('library-virtual-copy-compare-proof').waitFor({ timeout: 10_000 });
    return;
  }

  if (mode === 'hdr-ui') {
    await page.getByRole('button', { name: 'High' }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    await page.getByLabel('Tone-map preview').uncheck();
    hdrUiSettingsProofSchema.parse(
      await page.getByTestId('hdr-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    hdrReviewWorkspaceProofSchema.parse(
      await page.getByTestId('hdr-review-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
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
      provenance.outputColorSpace !== 'srgb_display_referred_v1' ||
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

  if (mode === 'panorama-ui') {
    await page.getByTestId('panorama-projection-option-rectilinear').click();
    if (!(await page.getByTestId('panorama-projection-option-spherical').isDisabled())) {
      throw new Error('Unsupported spherical panorama projection must be disabled.');
    }
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Feather/u }).click();
    await page.getByTestId('panorama-boundary-option-auto_crop').click();
    if (!(await page.getByTestId('panorama-boundary-option-transparent').isDisabled())) {
      throw new Error('Unsupported transparent panorama boundary must be disabled.');
    }
    await page.getByRole('button', { name: 'Gain compensation' }).click();
    await page.getByRole('option', { name: 'None' }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    panoramaUiSettingsProofSchema.parse(
      await page.getByTestId('panorama-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    panoramaReviewWorkspaceProofSchema.parse(
      await page.getByTestId('panorama-review-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
    const runtimePlanProof = await page
      .getByTestId('panorama-runtime-plan-summary')
      .evaluate((element) => ({ ...element.dataset }));
    if (
      runtimePlanProof.runtimePlanReady !== 'true' ||
      runtimePlanProof.planStatus !== 'accepted' ||
      runtimePlanProof.planScope !== 'geometry_memory_only' ||
      runtimePlanProof.outputDimensions !== '9600 x 3200'
    ) {
      throw new Error(`Panorama runtime plan proof failed: ${JSON.stringify(runtimePlanProof)}`);
    }
    await page.getByTestId('panorama-artifact-handoff').getByText('/tmp/panorama.tif', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === VISUAL_SMOKE_SCENARIO_IDS.PanoramaSavedReview) {
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('merge-saved-output-detail').waitFor({ timeout: 10_000 });
    panoramaSavedReviewProofSchema.parse(
      await page.getByTestId('panorama-saved-review-summary').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('merge-open-saved-output').click();
    const proof = await page
      .getByTestId('panorama-saved-review-open-proof')
      .evaluate((element) => ({ ...element.dataset }));
    if (proof.openedPath !== '/tmp/panorama.tif') {
      throw new Error(`Panorama saved output did not open editor path: ${JSON.stringify(proof)}`);
    }
    return;
  }

  if (mode === 'color-workflow') {
    const colorPanel = page.locator('[data-visual-smoke-section="color-workflow-panel"]');
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
    await colorPanel.getByTestId('color-runtime-status-rail').getByText('Preview/export', { exact: true }).waitFor({
      timeout: 10_000,
    });
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
    await setRangeInput(colorPanel, 'Temperature', 12);
    await setRangeInput(colorPanel, 'Saturation', 18);
    const selectiveControls = colorPanel.getByTestId('selective-color-range-controls');
    await selectiveControls.getByTestId('selective-color-range-oranges').click();
    await setRangeInput(selectiveControls, 'Hue', 8);
    await setRangeInput(selectiveControls, 'Saturation', 22);
    await setRangeInput(selectiveControls, 'Luminance', -11);
    selectiveColorUiProofDatasetSchema.parse(await selectiveControls.evaluate((element) => ({ ...element.dataset })));
    await selectiveControls.getByTestId('selective-color-reset-active-range').click();
    await page.getByTestId('selective-color-ui-proof').getByText('Orange 0', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByText('Orange sat 0', { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByText('Orange lum 0', { exact: true }).waitFor({ timeout: 10_000 });
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
    await page.getByTestId('color-workflow-adjustment-proof').getByText('Temp 12', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-workflow-adjustment-proof').getByText('Sat 18', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-workflow-adjustment-proof').getByText('CB on', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-workflow-adjustment-proof').getByText('CM on', { exact: true }).waitFor({
      timeout: 10_000,
    });
    colorBalanceCompareProofDatasetSchema.parse(
      await page.getByTestId('color-balance-compare-strip').evaluate((element) => ({ ...element.dataset })),
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
    await page.getByTestId('skin-tone-uniformity-ui-proof').getByText('Skin 0.725', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === 'detail-workspace') {
    await page.getByRole('button', { name: '200%' }).click();
    await page.getByRole('button', { name: 'Split compare' }).click();
    await page.getByRole('button', { name: 'Luma detail' }).click();
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
    await page.getByTestId('negative-lab-acquisition-health').waitFor({ timeout: 10_000 });
    await page
      .getByTestId('negative-lab-acquisition-severity')
      .getByText('Ready', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-acquisition-source-tiff_scan').waitFor({ timeout: 10_000 });
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
  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabWorkflowRail).waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-health').waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-acquisition-severity')
    .getByText('Review', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-source-tiff_scan').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-source-jpeg_lossy').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-acquisition-warning-lossy_source_for_negative_lab').waitFor({
    timeout: 10_000,
  });
  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabBatchReadiness).waitFor({ timeout: 10_000 });
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
  await page.getByTestId('negative-lab-planned-apply-count').getByText('Apply 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-skipped-frame-count').getByText('Skip 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAcceptBatchPlan).click();
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAgentDryRunState)
    .getByText('Dry-run accepted', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAgentCommitState)
    .getByText('Ready to commit', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId(VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabAgentCommandSource)
    .getByText(NegativeLabAppServerCommandName.AcceptBatchPlan, { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-frame-health-sort').selectOption('roll_order');
  await page.getByTestId('negative-lab-active-scan-1').click();
  await page.getByTestId('negative-lab-roll-frame-status-1').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-runtime-1').getByText('Preview ready', { exact: true }).waitFor({
    timeout: 10_000,
  });
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
    '"effectiveExposure": 0.45',
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

    page.on('pageerror', (error) => {
      throw error;
    });

    for (const scenario of selectedScenarios) {
      await page.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.appMode ?? scenario.mode}`, {
        waitUntil: 'networkidle',
      });
      await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await page.getByText(scenario.marker, { exact: true }).waitFor({ timeout: 10_000 });
      await assertSectionCount(page, scenario.sectionMinimum);
      await prepareScenario(page, scenario.mode);
      await page.screenshot({ path: scenario.outputPath, fullPage: false });
      const dimensions = await readPngDimensions(scenario.outputPath);
      if (dimensions.width !== viewport.width || dimensions.height !== viewport.height) {
        throw new Error(
          `${scenario.mode} dimensions mismatch: expected ${viewport.width}x${viewport.height}, got ${dimensions.width}x${dimensions.height}`,
        );
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
