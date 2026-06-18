import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { VISUAL_SMOKE_SCENARIOS } from '../src/validation/visual/visualSmokeScenarios.ts';
import {
  agentArtifactReviewProofDatasetSchema,
  agentDryRunReviewProofDatasetSchema,
  agentChatProofDatasetSchema,
  assertFilmLookExportProof,
  assertNegativeLabBaseFogPreviewExportProof,
  assertNegativeLabBatchColorInvokeProof,
  assertNegativeLabInvokeProof,
  commandPaletteWorkflowProofSchema,
  detailWorkspaceProofSchema,
  focusUiSettingsProofSchema,
  hdrReviewWorkspaceProofSchema,
  hdrUiSettingsProofSchema,
  libraryWorkflowProofSchema,
  layerStackExportParityProofSchema,
  layerStackWorkflowProofSchema,
  negativeLabWorkspaceProofDatasetSchema,
  panoramaReviewWorkspaceProofSchema,
  panoramaUiSettingsProofSchema,
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

if (selectedScenarios.length === 0) {
  throw new Error(`Unknown visual smoke scenario: ${requestedScenario ?? '<missing>'}`);
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

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

async function assertSectionCount(page, minimum) {
  const sectionCount = await page.locator('[data-visual-smoke-section]').count();
  if (sectionCount < minimum) {
    throw new Error(`Expected at least ${minimum} visual smoke sections, found ${sectionCount}`);
  }
}

async function prepareScenario(page, mode) {
  if (mode === 'command-palette-workflows') {
    const runCommand = async (query, name) => {
      await page.getByLabel('Search commands').fill(query);
      await page.getByRole('button', { name }).click();
      await page.getByTestId('command-palette-open').click();
    };

    await runCommand('focus', /Open focus stacking/u);
    await runCommand('super', /Open super resolution/u);
    await runCommand('panorama', /Open panorama stitching/u);
    await runCommand('hdr', /Open HDR merge/u);
    await runCommand('negative', /Open negative lab/u);
    commandPaletteWorkflowProofSchema.parse(
      await page.getByTestId('command-palette-workflow-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'agent-chat-ui') {
    const shell = page.getByTestId('agent-chat-shell');
    await shell.waitFor({ timeout: 10_000 });
    agentChatProofDatasetSchema.parse(await shell.evaluate((element) => ({ ...element.dataset })));
    const artifacts = page.getByTestId('agent-artifact-review');
    agentArtifactReviewProofDatasetSchema.parse(await artifacts.evaluate((element) => ({ ...element.dataset })));
    const review = page.getByTestId('agent-dry-run-review');
    agentDryRunReviewProofDatasetSchema.parse(await review.evaluate((element) => ({ ...element.dataset })));
    await page.getByTestId('agent-chat-messages').getByText('Dry-run only.', { exact: false }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('agent-tool-transcript')
      .getByText('rawengine.tone_color.dry_run', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId('agent-tool-status-tool-2').getByText('warning', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-tool-status-tool-3').getByText('blocked', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-chat-actions').getByText('Inspect diff', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-before-after-preview').getByText('graph_rev_45_preview', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page
      .getByTestId('agent-preview-artifacts')
      .getByText('artifact_edit_graph_patch_preview', { exact: true })
      .waitFor({
        timeout: 10_000,
      });
    await page.getByTestId('agent-preview-artifacts').getByText('review_required', { exact: true }).waitFor({
      timeout: 10_000,
    });
    const replayLinkCount = await page
      .getByTestId('agent-audit-entries')
      .locator('a[href*="agent-replay-proof-gallery-2026-06-16.html"]')
      .count();
    if (replayLinkCount !== 3) {
      throw new Error(`Expected 3 visible agent replay links, found ${replayLinkCount}.`);
    }
    await page.getByTestId('agent-approval-states').getByText('Approve dry-run', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-approval-states').getByText('rejected', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-approval-states').getByText('unavailable', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-parameter-diffs').getByText('Temperature', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-affected-targets').getByText('DSC_1042.ARW', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('agent-review-warnings').getByText('runtime apply', { exact: false }).waitFor({
      timeout: 10_000,
    });
    if (await page.getByText('Approve apply', { exact: true }).isEnabled()) {
      throw new Error('Agent apply action must stay disabled in UI-only smoke.');
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
    focusUiSettingsProofSchema.parse(
      await page.getByTestId('focus-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'sr-ui') {
    await page.getByRole('button', { name: '4x' }).click();
    await page.getByRole('button', { exact: true, name: 'Auto' }).click();
    await page.getByRole('option', { name: 'Optical flow' }).click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Aggressive preview/u }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    superResolutionUiSettingsProofSchema.parse(
      await page.getByTestId('sr-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'layer-stack-workflow') {
    await page.getByRole('button', { name: /Portrait burn/u }).click();
    await page.getByRole('button', { name: 'Move down' }).click();
    await page.getByRole('button', { name: 'Toggle' }).click();
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
    libraryWorkflowProofSchema.parse(
      await page.getByTestId('library-workflow-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('library-virtual-copy').getByText('vc-dsc-0002-bw-proof', { exact: true }).waitFor({
      timeout: 10_000,
    });
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

  if (mode === 'panorama-ui') {
    await page.getByRole('button', { name: 'Cylindrical' }).click();
    await page.getByRole('option', { name: 'Spherical' }).click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Feather/u }).click();
    await page.getByRole('button', { name: 'Auto crop' }).click();
    await page.getByRole('option', { name: 'Transparent edge' }).click();
    await page.getByRole('button', { name: 'Gain compensation' }).click();
    await page.getByRole('option', { name: 'None' }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    panoramaUiSettingsProofSchema.parse(
      await page.getByTestId('panorama-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    panoramaReviewWorkspaceProofSchema.parse(
      await page.getByTestId('panorama-review-workspace-proof').evaluate((element) => ({ ...element.dataset })),
    );
    await page.getByTestId('panorama-artifact-handoff').getByText('/tmp/panorama.tif', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === 'color-workflow') {
    const colorPanel = page.locator('[data-visual-smoke-section="color-workflow-panel"]');
    await colorPanel.getByTestId('color-runtime-status-rail').getByText('Preview/export', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await colorPanel.getByLabel('Temperature').fill('12');
    await colorPanel.getByLabel('Saturation').first().fill('18');
    await colorPanel.getByTestId('color-balance-toggle').click();
    await colorPanel.getByTestId('channel-mixer-toggle').click();
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

  if (mode === 'negative-lab-batch-color-workspace') {
    await page.getByTestId('negative-lab-workspace').waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-batch-readiness').waitFor({ timeout: 10_000 });
    await page
      .getByTestId('negative-lab-queued-count')
      .getByText('2 queued', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-accept-batch-plan').click();
    await page
      .getByTestId('negative-lab-accept-batch-plan')
      .getByText('Batch plan accepted', { exact: true })
      .waitFor({ timeout: 10_000 });
    const colorSliders = page.locator('input[type="range"]');
    await colorSliders.nth(1).fill('1.23');
    await colorSliders.nth(2).fill('0.91');
    await colorSliders.nth(3).fill('1.14');
    await page.getByTestId('negative-lab-accept-batch-plan').click();
    await page
      .getByTestId('negative-lab-accept-batch-plan')
      .getByText('Batch plan accepted', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-export-jpeg-proof').click();
    await page.getByRole('button', { name: 'Convert & Save All (2)' }).click();
    await page.waitForFunction(() =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => call.command === 'convert_negatives'),
    );
    await assertNegativeLabBatchColorInvokeProof(page);
    await page
      .getByTestId('negative-lab-saved-path-proof')
      .getByText('/tmp/rawengine-negative-smoke-positive.tif', { exact: true })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode !== 'negative-lab-workspace') return;

  await page.getByTestId('negative-lab-workspace').waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="negative-lab-workspace-proof"]')?.dataset.previewReady === 'true',
  );
  negativeLabWorkspaceProofDatasetSchema.parse(
    await page.getByTestId('negative-lab-workspace-proof').evaluate((element) => ({ ...element.dataset })),
  );
  await page.getByTestId('negative-lab-workflow-rail').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-batch-readiness').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-agent-activity').waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-agent-command-source')
    .getByText('negative.lab.build_batch_dry_run_summary', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-agent-dry-run-state')
    .getByText('Dry-run ready', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-agent-commit-state')
    .getByText('Not committed', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-agent-affected-frames').getByText('Affected 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-navigator').waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-roll-frame-count')
    .getByText('Frames 2', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-roll-frame-1').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-dust-review').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-retouch-count').getByText('Retouch 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-count').getByText('Frames 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-warning-count').getByText('Warnings 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-planned-apply-count').getByText('Apply 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-skipped-frame-count').getByText('Skip 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-accept-batch-plan').click();
  await page
    .getByTestId('negative-lab-agent-dry-run-state')
    .getByText('Dry-run accepted', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-agent-commit-state')
    .getByText('Ready to commit', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-agent-command-source')
    .getByText('negative.lab.accept_batch_dry_run_plan', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-active-scan-1').click();
  await page.getByTestId('negative-lab-roll-frame-status-1').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-frame-runtime-1').getByText('Preview ready', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-health-row-1').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-health-row-0').getByText('Queued', { exact: true }).waitFor({
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
  await page.getByTestId('negative-lab-roll-warning-count').getByText('Warnings 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
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
  await page.getByTestId('negative-lab-copy-batch-plan').click();
  await page.getByTestId('negative-lab-copy-batch-plan').getByText('Copied plan', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const copiedBatchPlan = await page.evaluate(() => window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__?.at(-1) ?? '');
  if (!copiedBatchPlan.includes('"plannedApplyCount"') || !copiedBatchPlan.includes('"skippedFrameIds"')) {
    throw new Error('Negative Lab batch plan copy did not include apply/skip JSON.');
  }
  await page.getByTestId('negative-lab-accept-batch-plan').click();
  await page
    .getByTestId('negative-lab-accept-batch-plan')
    .getByText('Batch plan accepted', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-queued-count')
    .getByText('1 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-included-status').getByText('1 included', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-scope-active').click();
  await page
    .getByTestId('negative-lab-queued-count')
    .getByText('1 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-export-tiff16').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-export-jpeg-proof').click();
  await page.getByRole('button', { name: 'Convert & Save Active' }).click();
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => call.command === 'convert_negatives'),
  );
  await assertNegativeLabInvokeProof(page);
  await assertNegativeLabBaseFogPreviewExportProof(page);
  await page
    .getByTestId('negative-lab-saved-path-proof')
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

    const shouldCheckHighDpi = requestedScenario === null || requestedScenario === 'empty-library';
    for (const target of shouldCheckHighDpi ? highDpiTargets : []) {
      const highDpiPage = await browser.newPage({ deviceScaleFactor: target.deviceScaleFactor, viewport });
      highDpiPage.on('pageerror', (error) => {
        throw error;
      });

      await highDpiPage.goto(`${baseUrl}/visual-smoke.html?scenario=empty-library`, { waitUntil: 'networkidle' });
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
