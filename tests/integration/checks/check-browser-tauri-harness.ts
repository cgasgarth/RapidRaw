#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import { editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { allocateFreeTcpPort, parseTcpPort } from '../../../scripts/lib/dev-server-port';
import { agentSelectedImageLiveSessionAuditExportReceiptSchema } from '../../../src/schemas/agent/agentSelectedImageAuditExportSchemas';

const host = '127.0.0.1';
const portOverride =
  process.env.BROWSER_TAURI_HARNESS_PORT === undefined
    ? undefined
    : parseTcpPort(process.env.BROWSER_TAURI_HARNESS_PORT, 'BROWSER_TAURI_HARNESS_PORT');
const port = await allocateFreeTcpPort(host, portOverride);
const baseUrl = `http://${host}:${port}`;
const runAgentAuditE2e = process.env.RAWENGINE_AGENT_AUDIT_E2E === '1';
const viewport = { height: 720, width: 1280 };
const boundsReportPath = resolve(
  'private-artifacts/validation/preview-bounds/browser-tauri-harness-bounds-report.json',
);
const failureScreenshotPath = resolve('private-artifacts/validation/preview-bounds/browser-tauri-harness-failure.png');

interface ElementBoundsSnapshot {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface BoundsSample {
  elements: Record<string, ElementBoundsSnapshot | null>;
  failures: string[];
  label: string;
  viewport: typeof viewport;
}

interface BoundsReport {
  generatedAt: string;
  samples: BoundsSample[];
  scenario: string;
  status: 'failed' | 'passed';
  viewport: typeof viewport;
}

const boundsSamples: BoundsSample[] = [];

async function waitForDevServer(server: ReturnType<typeof spawn>): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited before ${baseUrl} became available.`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (server.exitCode !== null || server.signalCode !== null) {
          throw new Error(`Vite exited after ${baseUrl} became available.`);
        }
        const confirmation = await fetch(baseUrl);
        if (confirmation.ok) return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

async function stopServer(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => {
      server.once('exit', resolve);
    }),
    new Promise((resolve) =>
      setTimeout(() => {
        server.kill('SIGKILL');
        resolve(undefined);
      }, 5_000),
    ),
  ]);
}

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: {
    ...process.env,
    RAWENGINE_DEV_SERVER_PORT: String(port),
    VITE_RAWENGINE_AGENT_AUDIT_E2E: runAgentAuditE2e ? '1' : '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const captureServerOutput = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', captureServerOutput);
server.stderr.on('data', captureServerOutput);

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;

try {
  await waitForDevServer(server);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location().url;
      consoleErrors.push(location ? `${message.text()} (${location})` : message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        html_url: 'https://github.com/CyberTimon/RapidRAW/releases/latest',
        tag_name: 'v0.0.0-browser-harness',
      },
      status: 200,
    });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await provisionalBadge.waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await provisionalBadge.textContent())?.includes('Camera preview')) {
    throw new Error('Embedded RAW preview was not visibly labeled as provisional.');
  }
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByRole('region', { name: 'Editor preview' }).waitFor({ timeout: 10_000 });
  await page.getByRole('region', { name: 'Image preview' }).waitFor({ timeout: 10_000 });
  const imageCanvas = page.getByTestId('image-canvas');
  await imageCanvas.waitFor({ timeout: 10_000 });
  await verifyPreviewBoundsScenario(page, boundsSamples);
  const commandOverflowButton = page.getByTestId('editor-command-overflow-trigger');
  await commandOverflowButton.click();
  const splitCompareButton = page.getByRole('menuitemcheckbox', { name: /Compare split wipe/u });
  const sideBySideCompareButton = page.getByRole('menuitemcheckbox', { name: /Compare side by side/u });
  await splitCompareButton.waitFor({ timeout: 10_000 });
  await sideBySideCompareButton.waitFor({ timeout: 10_000 });
  const originalPreviewBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'generate_original_transformed_preview',
      ).length ?? 0,
  );
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.originalPreviewResponses.push(
      {
        delayMs: 700,
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='red'/%3E%3C/svg%3E",
      },
      {
        delayMs: 30,
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='green'/%3E%3C/svg%3E",
      },
    );
  });
  await splitCompareButton.click();
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'generate_original_transformed_preview',
      ).length ?? 0) === expected,
    originalPreviewBaseline + 1,
    { timeout: 10_000 },
  );
  await page.getByTestId('viewer-footer-zoom-select').selectOption('1');
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'generate_original_transformed_preview',
      ).length ?? 0) === expected,
    originalPreviewBaseline + 2,
    { timeout: 10_000 },
  );
  await imageCanvas.waitFor({ timeout: 10_000 });
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'split-wipe') {
    throw new Error('Split-wipe compare mode did not activate on the image canvas.');
  }
  await page.getByTestId('editor-compare-split-divider').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(750);
  if ((await imageCanvas.getAttribute('data-editor-compare-original-ready')) !== 'true') {
    throw new Error('A late superseded original completion replaced the visible current compare artifact.');
  }
  await commandOverflowButton.click();
  await sideBySideCompareButton.click();
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'side-by-side') {
    throw new Error('Side-by-side compare mode did not activate on the image canvas.');
  }
  await page.getByTestId('editor-compare-side-by-side-preview').waitFor({ timeout: 10_000 });
  await commandOverflowButton.click();
  await sideBySideCompareButton.click();
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'off') {
    throw new Error('Compare mode did not return to off after toggling side-by-side.');
  }
  await page.getByTestId('viewer-footer-zoom-select').selectOption('fit');
  await waitForStablePreview(page);
  await page.getByRole('complementary', { name: 'Editor tools' }).waitFor({ timeout: 10_000 });
  await page.getByRole('heading', { exact: true, name: 'Color' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await page.getByTestId('adjustments-inspector').waitFor({ timeout: 10_000 });
  await verifyAutoEditTransactionBoundary(page);
  await verifyBatchAutoAdjustTransactionBoundary(page);
  const exposureValue = page.getByTestId('basic-control-exposure-value');
  const applyBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push(
      { color: [220, 20, 20], delayMs: 700 },
      { color: [20, 20, 220], delayMs: 350 },
      { color: [20, 220, 20], delayMs: 30 },
    );
  });
  for (const [index, exposure] of ['0.10', '0.20', '0.75'].entries()) {
    await exposureValue.click();
    const exposureInput = page.getByTestId('basic-control-exposure-input');
    await exposureInput.fill(exposure);
    await exposureInput.press('Enter');
    await exposureValue.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      (expected) =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
          .length ?? 0) >= expected,
      applyBaseline + index + 1,
      { timeout: 10_000 },
    );
  }
  if ((await exposureValue.textContent())?.trim() !== '0.75') {
    throw new Error('Exposure numeric control did not commit the requested value.');
  }
  await page.waitForTimeout(800);
  const editedPreviewPixel = await page.evaluate(async () => {
    const layers = [...document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]')];
    const visible = layers.findLast((layer) => Number.parseFloat(getComputedStyle(layer).opacity) > 0.99);
    const href = visible?.getAttribute('href');
    if (!href) return null;
    const image = new Image();
    image.src = href;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(image, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  });
  if (
    editedPreviewPixel === null ||
    editedPreviewPixel[1] === undefined ||
    editedPreviewPixel[0] === undefined ||
    editedPreviewPixel[2] === undefined ||
    editedPreviewPixel[1] < 160 ||
    editedPreviewPixel[0] > 80 ||
    editedPreviewPixel[2] > 80
  ) {
    throw new Error(
      'Reordered edited-preview completion did not preserve the green A-successor: ' +
        JSON.stringify(editedPreviewPixel),
    );
  }
  await page.waitForFunction(
    () => {
      const request = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter((call) => call.command === 'apply_adjustments')
        .at(-1)?.args?.['request'];
      if (typeof request !== 'object' || request === null) return false;
      const document = request['editDocumentV2'];
      if (typeof document !== 'object' || document === null) return false;
      const nodes = document['nodes'];
      if (typeof nodes !== 'object' || nodes === null) return false;
      const toneNode = nodes['scene_global_color_tone'];
      if (typeof toneNode !== 'object' || toneNode === null) return false;
      const params = toneNode['params'];
      return typeof params === 'object' && params !== null && params['exposure'] === 0.75;
    },
    { timeout: 10_000 },
  );
  const persistenceBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.metadataSaveResponses.push(
      { delayMs: 700, sidecarRevision: `sha256:${'b'.repeat(64)}` },
      { delayMs: 30, sidecarRevision: `sha256:${'c'.repeat(64)}` },
    );
  });
  for (const [index, exposure] of ['0.80', '0.90'].entries()) {
    await exposureValue.click();
    const exposureInput = page.getByTestId('basic-control-exposure-input');
    await exposureInput.fill(exposure);
    await exposureInput.press('Enter');
    await page.waitForFunction(
      ({ expected, persistenceCommand }) =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === persistenceCommand)
          .length ?? 0) >= expected,
      {
        expected: persistenceBaseline + index + 1,
        persistenceCommand: 'save_metadata_and_update_thumbnail',
      },
      { timeout: 10_000 },
    );
  }
  await page.waitForFunction(
    ({ firstIndex, persistenceCommand, secondIndex }) => {
      const saves =
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === persistenceCommand) ?? [];
      return saves[firstIndex]?.endedAtMs !== null && saves[secondIndex]?.endedAtMs !== null;
    },
    {
      firstIndex: persistenceBaseline,
      persistenceCommand: 'save_metadata_and_update_thumbnail',
      secondIndex: persistenceBaseline + 1,
    },
    { timeout: 10_000 },
  );
  const reorderedPersistenceProof = await page.evaluate(
    ({ firstIndex, persistenceCommand, secondIndex }) => {
      const saves =
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === persistenceCommand) ?? [];
      return {
        firstEndedAtMs: saves[firstIndex]?.endedAtMs ?? null,
        secondEndedAtMs: saves[secondIndex]?.endedAtMs ?? null,
        secondTransaction: saves[secondIndex]?.args?.['transaction'] ?? null,
      };
    },
    {
      firstIndex: persistenceBaseline,
      persistenceCommand: 'save_metadata_and_update_thumbnail',
      secondIndex: persistenceBaseline + 1,
    },
  );
  if (
    reorderedPersistenceProof.firstEndedAtMs === null ||
    reorderedPersistenceProof.secondEndedAtMs === null ||
    reorderedPersistenceProof.secondEndedAtMs >= reorderedPersistenceProof.firstEndedAtMs
  ) {
    throw new Error(
      `Persistence completions did not reverse as injected: ${JSON.stringify(reorderedPersistenceProof)}`,
    );
  }
  if (reorderedPersistenceProof.secondTransaction === null) {
    throw new Error('Current persistence request did not carry committed edit transaction authority.');
  }
  if ((await exposureValue.textContent())?.trim() !== '0.90') {
    throw new Error('A stale persistence completion displaced the current editor adjustment.');
  }
  const editDocumentPreviewProof = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter((candidate) => candidate.command === 'apply_adjustments')
      .at(-1);
    const request = call?.args?.['request'];
    return typeof request === 'object' && request !== null ? request : null;
  });
  if (editDocumentPreviewProof === null || 'jsAdjustments' in editDocumentPreviewProof) {
    throw new Error('Editor preview did not retire the flat adjustments render payload.');
  }
  const previewEditDocument = editDocumentV2Schema.parse(editDocumentPreviewProof['editDocumentV2']);
  if (previewEditDocument.nodes.scene_global_color_tone?.params.exposure !== 0.9) {
    throw new Error('Exposure UI edit did not reach the scene_global_color_tone render node.');
  }
  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByRole('heading', { exact: true, name: 'Color' }).waitFor({ timeout: 10_000 });
  await verifyViewerPickerControllers(page);
  await verifyColorRangeLocalAdjustmentTransaction(page);
  const viewerFooterOverflow = page.getByTestId('viewer-footer-overflow');
  if (await viewerFooterOverflow.isVisible()) {
    await viewerFooterOverflow.locator('summary').click();
  }
  await page.getByText(runAgentAuditE2e ? /4 x 4/u : /1024 x 768/u).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: /Command Palette/u }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Show crop tools/u }).click();
  await page.getByRole('heading', { name: 'Crop' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Straighten Tool/u }).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: /Command Palette/u }).waitFor({ timeout: 10_000 });
  await page.getByLabel(/Search commands/u).fill('negative');
  await page.getByRole('button', { name: /Open negative lab/u }).click();
  await page.getByRole('heading', { name: 'Negative Conversion' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preview-image').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-workspace').getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('negative-lab-workspace').waitFor({ state: 'detached', timeout: 10_000 });
  if (runAgentAuditE2e) {
    await page.getByTestId('right-panel-switcher-button-agent').click();
    const auditWorkspace = page.getByTestId('agent-audit-export-workspace');
    await auditWorkspace.waitFor({ timeout: 10_000 });
    await page.getByTestId('agent-review-control-dry-run').click();
    const approveApply = page.getByTestId('agent-review-control-apply');
    await expectEnabled(approveApply, 'Agent approve/apply');
    await approveApply.click();
    const exportAudit = page.getByTestId('agent-review-control-export');
    await expectEnabled(exportAudit, 'Agent audit export');
    const [auditDownload] = await Promise.all([page.waitForEvent('download'), exportAudit.click()]);
    const auditDownloadPath = await auditDownload.path();
    if (auditDownloadPath === null) throw new Error('Browser fallback audit download did not produce an artifact.');
    const exportedAudit = agentSelectedImageLiveSessionAuditExportReceiptSchema.parse(
      JSON.parse(await Bun.file(auditDownloadPath).text()),
    );
    if (
      exportedAudit.proposalLineage === undefined ||
      exportedAudit.proposalLineage.iterations.length === 0 ||
      exportedAudit.proposalLineage.iterations.some((iteration) => !iteration.proposalHash.startsWith('sha256:'))
    ) {
      throw new Error('Browser audit export omitted sealed proposal lineage hashes.');
    }
    await page.getByTestId('agent-audit-export-result').waitFor({ timeout: 10_000 });
    const auditProof = await auditWorkspace.evaluate((element) => ({
      mode: element.dataset.exportMode,
      output: element.dataset.exportOutput,
      preflight: element.dataset.replayPreflight,
      validation: element.dataset.exportValidation,
    }));
    if (auditProof.mode !== 'browser_fallback' || auditProof.validation !== 'valid') {
      throw new Error(`Browser audit export was mislabeled or invalid: ${JSON.stringify(auditProof)}`);
    }
    if (auditProof.output !== auditDownload.suggestedFilename()) {
      throw new Error('Browser audit export UI did not report the fallback filename.');
    }
    if (auditProof.preflight !== exportedAudit.replayPreflight.status) {
      throw new Error('Browser audit export UI did not report the parsed replay preflight status.');
    }
    const auditTimeline = await page.getByTestId('agent-audit-export-timeline-entry').evaluate((element) => ({
      graphRevision: element.dataset.graphRevision,
      output: element.dataset.output,
      requestId: element.dataset.requestId,
      toolName: element.dataset.toolName,
    }));
    if (
      !auditTimeline.requestId?.includes('workspace-audit-export') ||
      auditTimeline.toolName !== 'rawengine.agent.audit.export' ||
      !auditTimeline.graphRevision ||
      auditTimeline.output !== auditProof.output
    ) {
      throw new Error(`Browser audit export timeline proof is incomplete: ${JSON.stringify(auditTimeline)}`);
    }
  }
  await page.keyboard.press('Control+K');
  const commandPaletteForCopyPaste = page.getByRole('dialog', { name: /Command Palette/u });
  await commandPaletteForCopyPaste.waitFor({ timeout: 10_000 });
  await commandPaletteForCopyPaste.getByLabel(/Search commands/u).fill('copy paste');
  await commandPaletteForCopyPaste.getByRole('button', { name: /Copy and paste settings/u }).click();
  const copyPasteDialog = page.getByRole('dialog', { name: /Copy & Paste Settings/u });
  await copyPasteDialog.waitFor({ timeout: 10_000 });
  await copyPasteDialog.getByText('Dust Spot Visualization').waitFor({ timeout: 10_000 });
  if ((await copyPasteDialog.getByText('DustSpotVisualization').count()) > 0) {
    throw new Error('Copy & Paste Settings leaked the dust spot internal identifier.');
  }
  const saveButton = copyPasteDialog.getByRole('button', { name: 'Save' });
  await saveButton.waitFor({ timeout: 10_000 });
  const saveBox = await saveButton.boundingBox();
  if (saveBox === null || saveBox.y + saveBox.height > 720 || saveBox.y < 0) {
    throw new Error('Copy & Paste Settings Save button is outside the constrained viewport.');
  }
  const unlabeledIconButtons = await page.locator('button').evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const rect = button.getBoundingClientRect();
        const label =
          button.getAttribute('aria-label')?.trim() ||
          button.getAttribute('title')?.trim() ||
          button.textContent?.trim() ||
          '';
        const isDecorativeDisabledIndicator =
          button.disabled && button.classList.contains('cursor-default') && button.classList.contains('bg-transparent');
        return {
          index,
          isDecorativeDisabledIndicator,
          label,
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((button) => button.visible && button.label.length === 0 && !button.isDecorativeDisabledIndicator)
      .map((button) => button.index),
  );
  if (unlabeledIconButtons.length > 0) {
    throw new Error(`Visible icon buttons missing accessible names: ${unlabeledIconButtons.join(', ')}`);
  }

  const harnessProof = await page.evaluate(() => ({
    calls: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.map((call) => call.command) ?? [],
    enabled: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.enabled === true,
    hasTauriInternals: window.__TAURI_INTERNALS__ !== undefined,
    originalPreviewRequests:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter((call) => call.command === 'generate_original_transformed_preview')
        .map((call) => call.args) ?? [],
    startupRecords:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter((call) => call.command === 'record_frontend_startup_phase')
        .map((call) => call.args) ?? [],
  }));
  if (!harnessProof.enabled || !harnessProof.hasTauriInternals) {
    throw new Error('Browser Tauri harness was not installed.');
  }
  if (
    harnessProof.originalPreviewRequests.length < 2 ||
    harnessProof.originalPreviewRequests.some(
      (request) =>
        request?.['expectedImagePath'] !== '/tmp/rawengine-browser-harness/browser-harness.ARW' ||
        typeof request?.['viewerSampleGraphRevision'] !== 'string',
    )
  ) {
    throw new Error(
      'Original preview effects did not preserve exact source and graph identity across zoom replacement.',
    );
  }
  for (const requiredCommand of [
    'load_settings',
    'get_supported_file_types',
    'frontend_ready',
    'get_startup_trace',
    'record_frontend_startup_phase',
    'plugin:dialog|open',
    'get_folder_tree',
    'begin_image_open',
    'apply_adjustments',
    'generate_original_transformed_preview',
  ]) {
    if (!harnessProof.calls.includes(requiredCommand)) {
      throw new Error(`Browser Tauri harness did not record ${requiredCommand}.`);
    }
  }
  const frontendReadyIndex = harnessProof.calls.indexOf('frontend_ready');
  const getTraceIndex = harnessProof.calls.indexOf('get_startup_trace');
  const firstPhaseIndex = harnessProof.calls.indexOf('record_frontend_startup_phase');
  if (!(frontendReadyIndex < getTraceIndex && getTraceIndex < firstPhaseIndex)) {
    throw new Error('Frontend startup phases were not correlated after native readiness and trace acquisition.');
  }
  const startupPhases = harnessProof.startupRecords.map((args) => args?.['phase']);
  for (const expectedPhase of ['shellVisible', 'interactive', 'settingsHydrated', 'libraryReady']) {
    if (!startupPhases.includes(expectedPhase)) {
      throw new Error(`Browser Tauri harness did not record startup phase ${expectedPhase}.`);
    }
  }
  const actionableErrors = consoleErrors.filter(
    (message) =>
      !message.includes('React does not recognize the') &&
      !message.includes('Clerk:') &&
      !message.includes('[vite] failed to connect to websocket') &&
      !message.includes('Failed to send error to Vite server') &&
      !message.includes(`WebSocket connection to 'ws://${host}:${port}/`),
  );
  if (actionableErrors.length > 0) {
    throw new Error(`Unexpected browser harness console errors: ${actionableErrors.slice(0, 5).join(' | ')}`);
  }
  console.log('browser tauri harness ok');
} catch (error) {
  console.error('browser tauri harness failed');
  if (page !== undefined) {
    await writeBoundsReport('failed');
    await page.screenshot({ fullPage: false, path: failureScreenshotPath }).catch(() => undefined);
    console.error(
      `bounds evidence: ${relative(process.cwd(), boundsReportPath)}; screenshot: ${relative(
        process.cwd(),
        failureScreenshotPath,
      )}`,
    );
  }
  if (serverOutput.trim()) console.error(`Vite ${baseUrl} output excerpt:\n${serverOutput.trim()}`);
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}

async function expectEnabled(locator: Locator, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (await locator.isDisabled()) {
    if (Date.now() >= deadline) throw new Error(`${label} did not become enabled.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function verifyAutoEditTransactionBoundary(page: Page): Promise<void> {
  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.waitFor({ timeout: 10_000 });
  if (!(await undo.isDisabled())) throw new Error('Auto Edit proof did not begin at the initial history boundary.');

  const saveCount = async () =>
    page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'save_metadata_and_update_thumbnail',
        ).length ?? 0,
    );
  const baselineSaves = await saveCount();
  const autoAdjust = page.getByRole('button', { name: 'Auto Adjust Image' });

  await autoAdjust.click();
  const review = page.getByTestId('auto-edit-review');
  await review.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.some(
        ({ command }) => command === 'preview_auto_edit_proposal',
      ) === true,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(450);
  if (!(await undo.isDisabled()) || (await saveCount()) !== baselineSaves) {
    throw new Error('Auto Edit preview mutated canonical history or persistence.');
  }

  await review.getByRole('button', { name: 'Cancel Auto Adjust' }).click();
  await review.waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(450);
  if (!(await undo.isDisabled()) || (await saveCount()) !== baselineSaves) {
    throw new Error('Auto Edit cancel mutated canonical history or persistence.');
  }

  await autoAdjust.click();
  await review.waitFor({ timeout: 10_000 });
  await review.getByRole('button', { exact: true, name: 'Apply' }).click();
  await review.waitFor({ state: 'detached', timeout: 10_000 });
  await expectEnabled(undo, 'Undo after Auto Edit acceptance');
  await page.waitForFunction(
    (expectedCount) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expectedCount,
    baselineSaves + 1,
    { timeout: 10_000 },
  );

  const persisted = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
      .at(-1);
    return call?.args ?? null;
  });
  if (
    persisted?.['adjustments']?.['exposure'] !== 0.5 ||
    persisted?.['transaction']?.['transactionId'] !== 'blake3:browser-harness-auto-edit-transaction' ||
    typeof persisted?.['transaction']?.['baseAdjustmentRevision'] !== 'number' ||
    persisted['transaction']['nextAdjustmentRevision'] !== persisted['transaction']['baseAdjustmentRevision'] + 1
  ) {
    throw new Error(
      `Auto Edit acceptance did not persist one revision-scoped transaction: ${JSON.stringify(persisted)}`,
    );
  }
}

async function verifyBatchAutoAdjustTransactionBoundary(page: Page): Promise<void> {
  const counts = async () =>
    page.evaluate(() => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return {
        autoAdjust: calls.filter(({ command }) => command === 'apply_auto_adjustments_to_paths').length,
        commit: calls.filter(({ command }) => command === 'commit_batch_auto_adjustment').length,
        metadataLoad: calls.filter(({ command }) => command === 'load_metadata').length,
        metadataSave: calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length,
      };
    });
  const invokeFromContextMenu = async () => {
    await page.waitForFunction(
      () => document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
      undefined,
      { timeout: 10_000 },
    );
    const selectedPath = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
    if (!selectedPath) throw new Error('Selected editor path was unavailable for Batch Auto Adjust proof.');
    const targetThumbnail = page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${selectedPath}"]`);
    await targetThumbnail.click({ button: 'right' });
    const menuDiagnostics = () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const visibleItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .filter((item) => item.getClientRects().length > 0)
          .map((item) => ({
            expanded: item.getAttribute('aria-expanded'),
            path: item.dataset.menuItemPath ?? null,
            text: item.textContent?.trim() ?? '',
          }));
        return {
          active: active
            ? {
                disabled: 'disabled' in active && Boolean(active.disabled),
                path: active.dataset.menuItemPath ?? null,
                role: active.getAttribute('role'),
                text: active.textContent?.trim() ?? '',
                visible: active.getClientRects().length > 0,
              }
            : null,
          visibleItems,
        };
      });
    try {
      await page.waitForFunction(
        () => {
          const active = document.activeElement as HTMLButtonElement | null;
          return (
            active?.getAttribute('role') === 'menuitem' &&
            !active.disabled &&
            active.getClientRects().length > 0 &&
            active.closest('[role="menu"]')?.parentElement?.closest('[role="menu"]') === null
          );
        },
        undefined,
        { timeout: 10_000 },
      );
      let productivityFocused = false;
      for (let step = 0; step < 32; step += 1) {
        productivityFocused = await page.evaluate(
          () =>
            document.activeElement?.getAttribute('role') === 'menuitem' &&
            document.activeElement.textContent?.trim() === 'Productivity',
        );
        if (productivityFocused) break;
        await page.keyboard.press('ArrowDown');
      }
      if (!productivityFocused) {
        throw new Error(`Productivity keyboard target not reached: ${JSON.stringify(await menuDiagnostics())}`);
      }
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(
        () => {
          const active = document.activeElement as HTMLElement | null;
          const ready =
            active?.getAttribute('role') === 'menuitem' &&
            active.textContent?.trim() === 'Auto Adjust Image' &&
            active.getClientRects().length > 0 &&
            [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some(
              (item) => item.textContent?.trim() === 'Productivity' && item.getAttribute('aria-expanded') === 'true',
            );
          if (!ready) return false;
          active.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              code: 'Enter',
              key: 'Enter',
            }),
          );
          return true;
        },
        undefined,
        { timeout: 10_000 },
      );
    } catch (error) {
      throw new Error(`Batch Auto Adjust keyboard menu activation failed: ${JSON.stringify(await menuDiagnostics())}`, {
        cause: error,
      });
    }
  };
  const waitForSingleAutoAdjustInvocation = async (baselineCount: number) => {
    const expected = baselineCount + 1;
    const diagnostics = () =>
      page.evaluate(() => {
        const calls =
          window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
            ({ command }) => command === 'apply_auto_adjustments_to_paths',
          ) ?? [];
        const active = document.activeElement as HTMLElement | null;
        return {
          active: active
            ? {
                path: active.dataset.menuItemPath ?? null,
                role: active.getAttribute('role'),
                text: active.textContent?.trim() ?? '',
              }
            : null,
          count: calls.length,
          lastArgs: calls.at(-1)?.args ?? null,
          visibleMenuItems: [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
            .filter((item) => item.getClientRects().length > 0)
            .map((item) => item.textContent?.trim() ?? ''),
        };
      });
    try {
      await page.waitForFunction(
        (minimum) =>
          (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
            ({ command }) => command === 'apply_auto_adjustments_to_paths',
          ).length ?? 0) >= minimum,
        expected,
        { timeout: 10_000 },
      );
    } catch (error) {
      throw new Error(`Batch Auto Adjust invocation did not arrive: ${JSON.stringify(await diagnostics())}`, {
        cause: error,
      });
    }
    const observed = await diagnostics();
    if (observed.count !== expected) {
      throw new Error(`Batch Auto Adjust invocation was not singular: ${JSON.stringify({ expected, ...observed })}`);
    }
  };
  const switchAwayAndBack = async (activePath: string, waitForHydration = true) => {
    const other = page.locator(`[data-testid="filmstrip-thumbnail"]:not([data-image-path="${activePath}"])`).first();
    const otherPath = await other.getAttribute('data-image-path');
    if (!otherPath) throw new Error('Batch Auto Adjust race proof requires a second filmstrip image.');
    await other.click();
    await page.waitForFunction(
      (path) =>
        document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
      otherPath,
      { timeout: 10_000 },
    );
    await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${activePath}"]`).click();
    await page.waitForFunction(
      (path) =>
        document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
      activePath,
      { timeout: 10_000 },
    );
    if (waitForHydration) {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
        { timeout: 10_000 },
      );
    }
  };

  await page.waitForFunction(
    () => document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
    { timeout: 10_000 },
  );
  await page.waitForTimeout(500);
  const exposure = page.getByTestId('basic-control-exposure-value');
  await exposure.click();
  const exposureInput = page.getByTestId('basic-control-exposure-input');
  await exposureInput.fill('0.55');
  await exposureInput.press('Enter');
  const standardActivePath = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
  if (!standardActivePath) throw new Error('Batch Auto Adjust proof requires an active path.');
  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__) {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustCommitDelayMs = 1_000;
    }
  });
  const baseline = await counts();
  await invokeFromContextMenu();
  await waitForSingleAutoAdjustInvocation(baseline.autoAdjust);
  await page.waitForTimeout(500);
  const afterPrepare = await counts();
  if (afterPrepare.commit !== baseline.commit + 1) {
    const applyArgs = await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'apply_auto_adjustments_to_paths')
          .at(-1)?.args ?? null,
    );
    throw new Error(`Batch Auto Adjust did not reach selected-path commit: ${JSON.stringify(applyArgs)}`);
  }
  await switchAwayAndBack(standardActivePath);

  await page.waitForFunction(
    () => document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim() === '0.65',
    { timeout: 10_000 },
  );
  await page.waitForTimeout(450);
  const afterApply = await counts();
  if (
    afterApply.metadataLoad !== baseline.metadataLoad ||
    afterApply.metadataSave !== baseline.metadataSave + 1 ||
    afterApply.commit !== baseline.commit + 1
  ) {
    const newSaveArgs = await page.evaluate((baselineSaveCount) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return calls
        .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
        .slice(baselineSaveCount)
        .map(({ args }) => args ?? null);
    }, baseline.metadataSave);
    throw new Error(
      `Batch Auto Adjust did not use exactly one persistence barrier and one native commit: ${JSON.stringify({ afterApply, baseline, newSaveArgs })}`,
    );
  }
  const batchCalls = await page.evaluate((baselineSaveCount) => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return {
      apply: calls.filter(({ command }) => command === 'apply_auto_adjustments_to_paths').at(-1)?.args ?? null,
      barrier:
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').at(baselineSaveCount)?.args ??
        null,
    };
  }, baseline.metadataSave);
  if (
    batchCalls.barrier?.['adjustments']?.['exposure'] !== 0.55 ||
    batchCalls.apply?.['expectedBaseRevision'] !== `sha256:${'a'.repeat(64)}`
  ) {
    throw new Error(`Batch Auto Adjust did not prepare from the flushed dirty document: ${JSON.stringify(batchCalls)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim() === '0.55',
    { timeout: 10_000 },
  );
  const redo = page.locator('button[data-command-id="redo"]:visible').first();
  await expectEnabled(redo, 'Redo after Batch Auto Adjust undo');
  await redo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim() === '0.65',
    { timeout: 10_000 },
  );
  if ((await exposure.textContent())?.trim() !== '0.65') {
    throw new Error('Batch Auto Adjust did not restore its single accepted history boundary.');
  }

  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__) {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustCommitDelayMs = 400;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustPrepareDelayMs = 700;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.imageOpenDelayMs = 1_500;
    }
  });
  const raceBaseline = await counts();
  const activePath = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
  if (!activePath) throw new Error('Batch Auto Adjust race proof requires an active path.');
  await invokeFromContextMenu();
  await waitForSingleAutoAdjustInvocation(raceBaseline.autoAdjust);
  await switchAwayAndBack(activePath, false);
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'commit_batch_auto_adjustment',
      ).length ?? 0) === expected,
    raceBaseline.commit + 1,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_700);
  if (Number((await exposure.textContent())?.trim()) !== 0.7) {
    const commitArgs = await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'commit_batch_auto_adjustment')
          .at(-1)?.args ?? null,
    );
    throw new Error(
      `An unchanged successor A session did not accept the delayed Batch Auto Adjust commit: ${JSON.stringify({ commitArgs, exposure: await exposure.textContent() })}`,
    );
  }

  const editedRaceBaseline = await counts();
  await invokeFromContextMenu();
  await waitForSingleAutoAdjustInvocation(editedRaceBaseline.autoAdjust);
  await switchAwayAndBack(activePath, false);
  await exposure.click();
  await exposureInput.fill('0.8');
  await exposureInput.press('Enter');
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'commit_batch_auto_adjustment',
      ).length ?? 0) === expected,
    editedRaceBaseline.commit + 1,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_700);
  if (Number((await exposure.textContent())?.trim()) !== 0.8) {
    throw new Error('A delayed Batch Auto Adjust commit replaced an edited successor A session.');
  }
  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__) {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustCommitDelayMs = 0;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustPrepareDelayMs = 0;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.imageOpenDelayMs = 250;
    }
  });
}

async function verifyPreviewBoundsScenario(page: Page, samples: BoundsSample[]): Promise<void> {
  const previewPanel = page.getByTestId('editor-image-preview-panel');
  const zoomSelector = page.getByTestId('viewer-footer-zoom-select');
  const sourceIdentity = '/tmp/rawengine-browser-harness/browser-harness.ARW';
  await previewPanel.waitFor({ timeout: 10_000 });
  await zoomSelector.waitFor({ timeout: 10_000 });
  await waitForStablePreview(page);

  samples.push(await collectBoundsSample(page, 'fit-after-image-select'));
  await assertLatestBoundsSample(samples);

  await zoomSelector.selectOption('0.5');
  await assertRenderedImageGeometry(page, { height: 384, label: 'selector-zoom-50', width: 512 });
  samples.push(await collectBoundsSample(page, 'selector-zoom-50'));
  await assertLatestBoundsSample(samples);

  await zoomSelector.selectOption('1');
  await assertRenderedImageGeometry(page, { height: 768, label: 'selector-zoom-100', width: 1024 });
  samples.push(await collectBoundsSample(page, 'selector-zoom-100'));
  await assertLatestBoundsSample(samples);

  await page.keyboard.press('Meta+=');
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'keyboard-zoom-in'));
  await assertLatestBoundsSample(samples);

  await page.keyboard.press('Meta+-');
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'keyboard-zoom-out'));
  await assertLatestBoundsSample(samples);

  const canonicalBaseHref = await readCommittedBaseHref(page, sourceIdentity);
  await zoomSelector.selectOption('2');
  await assertRenderedImageGeometry(page, { height: 1536, label: 'selector-zoom-200', width: 2048 });
  await assertPositionedZoomOutput(page, { canonicalBaseHref, sourceIdentity });
  samples.push(await collectBoundsSample(page, 'selector-zoom-200'));
  await assertLatestBoundsSample(samples);

  const zoomedFrame = await readBounds(page.locator('[data-editor-image-frame="edited"]').first());
  const panel = await readBounds(previewPanel);
  if (zoomedFrame.width <= panel.width || zoomedFrame.height <= panel.height) {
    throw new Error(
      `selector-zoom-200 left the full frame visible (${zoomedFrame.width}x${zoomedFrame.height} inside ${panel.width}x${panel.height}).`,
    );
  }

  await zoomSelector.selectOption('fit');
  await assertRenderedImageGeometry(page, { height: 397, label: 'reset-to-fit', width: 529.33 });
  samples.push(await collectBoundsSample(page, 'reset-to-fit'));
  await assertLatestBoundsSample(samples);

  await zoomSelector.selectOption('2');
  await assertRenderedImageGeometry(page, { height: 1536, label: 'repeated-selector-zoom-200', width: 2048 });
  await zoomSelector.selectOption('fit');
  await assertRenderedImageGeometry(page, { height: 397, label: 'repeated-reset-to-fit', width: 529.33 });
  await assertSingleFullFrameOutput(page, sourceIdentity);

  await previewPanel.hover();
  await page.mouse.wheel(0, -320);
  await page.waitForFunction(() => document.querySelector('[data-editor-zoom-mode="ratio"]') !== null, undefined, {
    timeout: 10_000,
  });
  const gestureScale = Number(await previewPanel.getAttribute('data-editor-transform-scale'));
  const resolvedGestureScale = Number(await previewPanel.getAttribute('data-editor-resolved-transform-scale'));
  if (
    !Number.isFinite(gestureScale) ||
    !Number.isFinite(resolvedGestureScale) ||
    Math.abs(gestureScale - resolvedGestureScale) > 0.001
  ) {
    throw new Error(
      `Wheel zoom split visible transform ${String(gestureScale)} from semantic transform ${String(resolvedGestureScale)}.`,
    );
  }
  const gestureBaseHref = await readCommittedBaseHref(page, sourceIdentity);
  await assertPositionedZoomOutput(page, { canonicalBaseHref: gestureBaseHref, sourceIdentity });
  await zoomSelector.selectOption('fit');
  await assertRenderedImageGeometry(page, { height: 397, label: 'wheel-reset-to-fit', width: 529.33 });
  await assertSingleFullFrameOutput(page, sourceIdentity);

  await writeBoundsReport('passed');
}

async function assertPositionedZoomOutput(
  page: Page,
  expected: { canonicalBaseHref: string; sourceIdentity: string },
): Promise<void> {
  await page.waitForFunction(
    ({ canonicalBaseHref, sourceIdentity }) => {
      const bases = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]'));
      const patches = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-patch-layer"]'));
      if (bases.length < 1 || bases.length > 2 || patches.length !== 1) return false;
      const committedBases = bases.filter((base) => Number.parseFloat(base.style.opacity) === 1);
      const base = committedBases[0];
      const patch = patches[0];
      if (committedBases.length !== 1 || !base || !patch) return false;
      return (
        bases.every(
          (candidate) =>
            candidate.dataset.previewSourceIdentity === sourceIdentity &&
            (candidate === base || Number.parseFloat(candidate.style.opacity) === 0),
        ) &&
        base.getAttribute('href') === canonicalBaseHref &&
        base.dataset.previewSourceIdentity === sourceIdentity &&
        patch.dataset.previewSourceIdentity === sourceIdentity &&
        Number(patch.dataset.previewFullWidth) > 0 &&
        Number(patch.dataset.previewFullHeight) > 0 &&
        Number(patch.dataset.previewPixelWidth) > 0 &&
        Number(patch.dataset.previewPixelHeight) > 0 &&
        Number.parseFloat(patch.style.opacity) === 1 &&
        patch.getBoundingClientRect().width > 0 &&
        patch.getBoundingClientRect().height > 0
      );
    },
    expected,
    { timeout: 10_000 },
  );
}

async function readCommittedBaseHref(page: Page, sourceIdentity: string): Promise<string> {
  await page.waitForFunction(
    (expectedSourceIdentity) => {
      const bases = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]'));
      const committed = bases.filter(
        (base) =>
          base.dataset.previewSourceIdentity === expectedSourceIdentity && Number.parseFloat(base.style.opacity) === 1,
      );
      return committed.length === 1 && committed[0]?.getAttribute('href') !== null;
    },
    sourceIdentity,
    { timeout: 10_000 },
  );
  const href = await page.locator('[data-testid="svg-preview-base-layer"]').evaluateAll((bases, expectedIdentity) => {
    const committed = bases.find(
      (base) =>
        base instanceof SVGImageElement &&
        base.dataset.previewSourceIdentity === expectedIdentity &&
        Number.parseFloat(base.style.opacity) === 1,
    );
    return committed?.getAttribute('href') ?? null;
  }, sourceIdentity);
  if (href === null) throw new Error('Zoom proof could not identify the committed canonical base preview.');
  return href;
}

async function assertSingleFullFrameOutput(page: Page, sourceIdentity: string): Promise<void> {
  await page.waitForFunction(
    (expectedSourceIdentity) => {
      const bases = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]'));
      const patches = document.querySelectorAll('[data-testid="svg-preview-patch-layer"]');
      const base = bases[0];
      return (
        bases.length === 1 &&
        patches.length === 0 &&
        base?.dataset.previewSourceIdentity === expectedSourceIdentity &&
        Number.parseFloat(base.style.opacity) === 1 &&
        base.getBoundingClientRect().width > 0 &&
        base.getBoundingClientRect().height > 0
      );
    },
    sourceIdentity,
    { timeout: 10_000 },
  );
}

async function assertRenderedImageGeometry(
  page: Page,
  expected: { height: number; label: string; width: number },
): Promise<void> {
  const frame = page.locator('[data-editor-image-frame="edited"]').first();
  await frame.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    ({ expectedHeight, expectedWidth }) => {
      const element = document.querySelector<HTMLElement>('[data-editor-image-frame="edited"]');
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      return Math.abs(bounds.width - expectedWidth) <= 1 && Math.abs(bounds.height - expectedHeight) <= 1;
    },
    { expectedHeight: expected.height, expectedWidth: expected.width },
    { timeout: 10_000 },
  );
  const actual = await readBounds(frame);
  if (Math.abs(actual.width - expected.width) > 1 || Math.abs(actual.height - expected.height) > 1) {
    throw new Error(
      `${expected.label} rendered ${actual.width}x${actual.height}; expected ${expected.width}x${expected.height}.`,
    );
  }
}

async function waitForStablePreview(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  await page.getByTestId('image-canvas').waitFor({ timeout: 10_000 });
}

async function verifyViewerPickerControllers(page: Page): Promise<void> {
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await page.getByTestId('adjustments-inspector').waitFor({ state: 'visible', timeout: 10_000 });
  const toneAdvanced = page.getByTestId('tone-equalizer-advanced');
  if (!(await toneAdvanced.isVisible())) await page.getByTestId('tone-equalizer-advanced-toggle').click();
  const tonePicker = page.getByTestId('tone-equalizer-picker');
  await tonePicker.scrollIntoViewIfNeeded();
  await waitForStablePreview(page);
  await tonePicker.click();
  await page.getByTestId('image-canvas').focus();
  await waitForStableGeometryEpoch(page);
  const toneSamplePoint = await displayedImageCenter(page);
  await page.mouse.move(toneSamplePoint.x, toneSamplePoint.y);
  await page.mouse.down();
  const toneOverlay = page.getByTestId('viewer-picker-overlay');
  await toneOverlay.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await toneOverlay.getAttribute('data-picker-tool')) !== 'tone-equalizer') {
    throw new Error('Tone Equalizer did not publish its declarative picker overlay.');
  }
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="viewer-picker-overlay"]')?.getAttribute('data-picker-status') === 'ready',
    undefined,
    { timeout: 10_000 },
  );
  await page.mouse.up();
  await toneOverlay.waitFor({ state: 'detached', timeout: 10_000 });
  const toneReceipt = page.getByTestId('tone-equalizer-picker-receipt');
  await toneReceipt.waitFor({ state: 'attached', timeout: 10_000 });
  await toneReceipt.scrollIntoViewIfNeeded();
  await tonePicker.click();

  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByTestId('color-workspace-tab-mixer').click();
  const pointControls = page.getByTestId('point-color-controls');
  await pointControls.waitFor({ state: 'visible', timeout: 10_000 });
  const pointPicker = page.getByTestId('point-color-picker');
  await pointPicker.scrollIntoViewIfNeeded();
  await waitForStablePreview(page);
  await pointPicker.click();
  await page.getByTestId('image-canvas').focus();
  await waitForStableGeometryEpoch(page);
  const pointSamplePoint = await displayedImageCenter(page);
  await page.mouse.move(pointSamplePoint.x, pointSamplePoint.y);
  await page.mouse.down();
  const pointOverlay = page.getByTestId('viewer-picker-overlay');
  await pointOverlay.waitFor({ state: 'visible', timeout: 10_000 });
  const pointOverlayProof = await pointOverlay.evaluate((element) => ({
    normalizedX: element.dataset.normalizedX,
    normalizedY: element.dataset.normalizedY,
    tool: element.dataset.pickerTool,
  }));
  if (
    pointOverlayProof.tool !== 'point-color' ||
    pointOverlayProof.normalizedX === undefined ||
    pointOverlayProof.normalizedY === undefined
  ) {
    throw new Error(`Point Color overlay proof was incomplete: ${JSON.stringify(pointOverlayProof)}`);
  }
  await page.mouse.up();
  await page.getByTestId('point-color-selected-controls').waitFor({ state: 'visible', timeout: 10_000 });
  if ((await pointPicker.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('Point Color picker did not deactivate after committing its one-shot sample.');
  }
}

async function verifyColorRangeLocalAdjustmentTransaction(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  const baselineSaves = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  await page.getByTestId('selective-color-range-oranges').click();
  const disclosure = page.getByTestId('local-color-range-adjustment-disclosure');
  if ((await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click();
  const createLocalAdjustment = page.getByTestId('selective-color-create-local-adjustment');
  await createLocalAdjustment.scrollIntoViewIfNeeded();
  await createLocalAdjustment.click();

  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    baselineSaves + 1,
    { timeout: 10_000 },
  );
  const persisted = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
      .at(-1);
    return call?.args ?? null;
  });
  const transaction = persisted?.['transaction'];
  const adjustments = persisted?.['adjustments'];
  const masks = Array.isArray(adjustments?.['masks']) ? adjustments['masks'] : [];
  const sidecars = Array.isArray(adjustments?.['rawEngineArtifacts']?.['layerStackSidecars'])
    ? adjustments['rawEngineArtifacts']['layerStackSidecars']
    : [];
  const colorMask = masks
    .flatMap((mask) => (Array.isArray(mask?.['subMasks']) ? mask['subMasks'] : []))
    .find((mask) => mask?.['type'] === 'color');
  const sidecar = sidecars.find(
    (candidate) => candidate?.['sourceImagePath'] === '/tmp/rawengine-browser-harness/browser-harness.ARW',
  );
  if (
    colorMask === undefined ||
    sidecar === undefined ||
    typeof transaction?.['transactionId'] !== 'string' ||
    typeof transaction?.['baseAdjustmentRevision'] !== 'number' ||
    transaction['nextAdjustmentRevision'] !== transaction['baseAdjustmentRevision'] + 1 ||
    typeof sidecar?.['graphRevision'] !== 'string' ||
    !sidecar['graphRevision'].includes(transaction['transactionId'])
  ) {
    throw new Error(
      `Color-range local adjustment did not persist one revision-scoped layer artifact: ${JSON.stringify({ colorMask, sidecar, transaction })}`,
    );
  }
}

async function waitForStableGeometryEpoch(page: Page): Promise<void> {
  const canvas = page.getByTestId('image-canvas');
  let previous = await canvas.getAttribute('data-geometry-epoch');
  let stableSamples = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(50);
    const current = await canvas.getAttribute('data-geometry-epoch');
    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 3) return;
    previous = current;
  }
  throw new Error('Picker proof geometry epoch did not stabilize.');
}

async function displayedImageCenter(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('[data-editor-image-frame="edited"]').first().boundingBox();
  if (bounds === null) throw new Error('Picker proof could not resolve displayed image bounds.');
  const visibleTop = Math.max(0, bounds.y);
  const visibleBottom = Math.min(viewport.height, bounds.y + bounds.height);
  if (visibleBottom - visibleTop < 20) throw new Error('Picker proof image is not visibly interactable.');
  return { x: bounds.x + bounds.width * 0.5, y: (visibleTop + visibleBottom) * 0.5 };
}

async function collectBoundsSample(page: Page, label: string): Promise<BoundsSample> {
  const elements = {
    bottomBarShell: await readBounds(page.getByTestId('editor-bottom-bar-shell')),
    firstFilmstripThumbnail: await readOptionalBounds(page.getByTestId('filmstrip-thumbnail').first()),
    imageCanvas: await readBounds(page.getByTestId('image-canvas')),
    previewContent: await readBounds(page.getByTestId('editor-image-preview-content')),
    previewPanel: await readBounds(page.getByTestId('editor-image-preview-panel')),
    previewRegion: await readBounds(page.getByTestId('editor-image-preview-region')),
    rightPanelShell: await readBounds(page.getByTestId('editor-right-panel-shell')),
    toolbarShell: await readBounds(page.getByTestId('editor-toolbar-shell')),
    workspace: await readBounds(page.getByTestId('editor-workspace')),
    viewerFooter: await readBounds(page.getByTestId('viewer-footer')),
    zoomSelector: await readBounds(page.getByTestId('viewer-footer-zoom-select')),
  };
  const failures = evaluateBounds(elements);
  return { elements, failures, label, viewport };
}

async function readBounds(locator: Locator): Promise<ElementBoundsSnapshot> {
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    };
  });
  return roundBounds(box);
}

async function readOptionalBounds(locator: Locator): Promise<ElementBoundsSnapshot | null> {
  if ((await locator.count()) === 0) return null;
  return readBounds(locator);
}

function roundBounds(bounds: ElementBoundsSnapshot): ElementBoundsSnapshot {
  return {
    bottom: round(bounds.bottom),
    height: round(bounds.height),
    left: round(bounds.left),
    right: round(bounds.right),
    top: round(bounds.top),
    width: round(bounds.width),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function evaluateBounds(elements: BoundsSample['elements']): string[] {
  const failures: string[] = [];
  const tolerance = 1;
  const viewportBoundedElements = [
    'bottomBarShell',
    'firstFilmstripThumbnail',
    'previewPanel',
    'previewRegion',
    'rightPanelShell',
    'toolbarShell',
    'workspace',
    'viewerFooter',
    'zoomSelector',
  ];
  for (const name of viewportBoundedElements) {
    const bounds = elements[name];
    if (bounds === undefined || bounds === null) continue;
    if (bounds.width <= 0 || bounds.height <= 0) {
      failures.push(`${name} has no visible area (${bounds.width}x${bounds.height}).`);
    }
    if (bounds.top < -tolerance) failures.push(`${name} is clipped above viewport top (${bounds.top}).`);
    if (bounds.left < -tolerance) failures.push(`${name} is clipped left of viewport (${bounds.left}).`);
    if (bounds.right > viewport.width + tolerance) {
      failures.push(`${name} exceeds viewport right edge (${bounds.right} > ${viewport.width}).`);
    }
    if (bounds.bottom > viewport.height + tolerance) {
      failures.push(`${name} exceeds viewport bottom edge (${bounds.bottom} > ${viewport.height}).`);
    }
  }

  const previewPanel = elements.previewPanel;
  const previewRegion = elements.previewRegion;
  const bottomBarShell = elements.bottomBarShell;
  const viewerFooter = elements.viewerFooter;
  const zoomSelector = elements.zoomSelector;
  const firstFilmstripThumbnail = elements.firstFilmstripThumbnail;
  if (previewRegion !== null && previewPanel !== null && !containsBounds(previewRegion, previewPanel, tolerance)) {
    failures.push('preview panel is not fully contained by the preview region.');
  }
  if (previewRegion !== null && viewerFooter !== null && !containsBounds(previewRegion, viewerFooter, tolerance)) {
    failures.push('viewer footer is not fully contained by the preview region.');
  }
  if (viewerFooter !== null && zoomSelector !== null && !containsBounds(viewerFooter, zoomSelector, tolerance)) {
    failures.push('zoom selector is not fully contained by the viewer footer.');
  }
  if (
    bottomBarShell !== null &&
    firstFilmstripThumbnail !== null &&
    !containsBounds(bottomBarShell, firstFilmstripThumbnail, tolerance)
  ) {
    failures.push('first filmstrip thumbnail is not fully contained by the bottom bar shell.');
  }
  if (viewerFooter !== null && firstFilmstripThumbnail !== null && overlaps(viewerFooter, firstFilmstripThumbnail)) {
    failures.push('viewer footer overlaps the filmstrip thumbnails.');
  }

  return failures;
}

function containsBounds(container: ElementBoundsSnapshot, child: ElementBoundsSnapshot, tolerance: number): boolean {
  return (
    child.top >= container.top - tolerance &&
    child.left >= container.left - tolerance &&
    child.right <= container.right + tolerance &&
    child.bottom <= container.bottom + tolerance
  );
}

function overlaps(left: ElementBoundsSnapshot, right: ElementBoundsSnapshot): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

async function assertLatestBoundsSample(samples: BoundsSample[]): Promise<void> {
  const latest = samples.at(-1);
  if (!latest || latest.failures.length === 0) return;
  await writeBoundsReport('failed');
  throw new Error(`Preview bounds failed for ${latest.label}: ${latest.failures.join(' | ')}`);
}

async function writeBoundsReport(status: BoundsReport['status']): Promise<void> {
  const report: BoundsReport = {
    generatedAt: new Date().toISOString(),
    samples: boundsSamples,
    scenario: 'browser-tauri-preview-zoom-window-bounds',
    status,
    viewport,
  };
  await mkdir(dirname(boundsReportPath), { recursive: true });
  await writeFile(boundsReportPath, `${JSON.stringify(report, null, 2)}\n`);
}
