#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';
import { waitForPageCondition } from '../../../../scripts/lib/playwright-waits';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const successorPath = '/tmp/rawengine-browser-harness/browser-harness-2.ARW';
const cameraInputSchema = z
  .object({
    cameraProfile: z.string(),
    cameraProfileAmount: z.number(),
    whiteBalanceTechnical: z.object({ duv: z.number(), kelvin: z.number(), mode: z.string() }).passthrough(),
  })
  .passthrough();
const persistenceSchema = z
  .object({
    adjustments: cameraInputSchema,
    path: z.literal(sourcePath),
    transaction: z
      .object({
        baseAdjustmentRevision: z.number().int().nonnegative(),
        imageSessionId: z.string().min(1),
        nextAdjustmentRevision: z.number().int().positive(),
        transactionId: z.string().min(1),
      })
      .strict(),
  })
  .passthrough();
const renderSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z
            .object({
              nodes: z.object({ camera_input: z.object({ params: cameraInputSchema }).passthrough() }).passthrough(),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough(),
  endedAtMs: z.number().nullable(),
});

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: { ...process.env, RAWENGINE_DEV_SERVER_PORT: String(port), VITE_RAWENGINE_BROWSER_TAURI_HARNESS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const capture = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', capture);
server.stderr.on('data', capture);

const waitForServer = async () => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${baseUrl}.`);
};

const stopServer = async () => {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => server.once('exit', () => resolve())),
    Bun.sleep(5_000).then(() => server.kill('SIGKILL')),
  ]);
};

const calls = async (page: Page, command: string) =>
  page.evaluate(
    (name) => window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === name) ?? [],
    command,
  );

const waitForCount = async (page: Page, command: string, expected: number, phase = 'unspecified') => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await calls(page, command)).length >= expected) return;
    await page.waitForTimeout(50);
  }
  const observed = (await calls(page, command)).length;
  throw new Error(
    `Timed out waiting for ${String(expected)} ${command} calls during ${phase}; observed ${String(observed)}.`,
  );
};

const waitForCompletedCall = async (page: Page, command: string, index: number) => {
  await page.waitForFunction(
    ({ commandName, targetIndex }) => {
      const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === commandName)[
        targetIndex
      ];
      return typeof call?.endedAtMs === 'number';
    },
    { commandName: command, targetIndex: index },
    { timeout: 10_000 },
  );
};

const waitForToolbarIdle = async (page: Page) => {
  await waitForPageCondition(
    page,
    () => document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
    { timeout: 10_000 },
  );
};

const countAutoWhiteBalanceTransactions = async (page: Page, source: string, kelvin: number) =>
  page.evaluate(
    ({ expectedKelvin, expectedSource }) =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ args, command }) => {
        if (command !== 'save_metadata_and_update_thumbnail') return false;
        const payload = args as
          | {
              adjustments?: { whiteBalanceTechnical?: { kelvin?: number; mode?: string } };
              path?: string;
              transaction?: unknown;
            }
          | undefined;
        return (
          payload?.path === expectedSource &&
          payload.transaction !== undefined &&
          payload.adjustments?.whiteBalanceTechnical?.mode === 'auto' &&
          payload.adjustments.whiteBalanceTechnical.kelvin === expectedKelvin
        );
      }).length ?? 0,
    { expectedKelvin: kelvin, expectedSource: source },
  );

const waitForRenderedCameraInput = async (
  page: Page,
  profile: string,
  expected: { duv: number; kelvin: number; mode: string },
) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderSchema.safeParse((await calls(page, 'apply_adjustments')).at(-1));
    const params = parsed.success ? parsed.data.args.request.editDocumentV2.nodes.camera_input.params : null;
    if (
      parsed.success &&
      parsed.data.endedAtMs !== null &&
      params?.cameraProfile === profile &&
      params.whiteBalanceTechnical.mode === expected.mode &&
      params.whiteBalanceTechnical.kelvin === expected.kelvin &&
      params.whiteBalanceTechnical.duv === expected.duv
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for Camera Input profile=${profile}, WB=${JSON.stringify(expected)}.`);
};

const waitForSelectedSource = async (page: Page, source: string) => {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === expected,
    source,
    { timeout: 10_000 },
  );
};

const queueAutoWhiteBalanceResponse = async (
  page: Page,
  response: { delayMs: number; duv: number; kelvin: number },
) => {
  await page.evaluate(({ delayMs, duv, kelvin }) => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.autoAdjustResponses.push({
      delayMs,
      value: {
        blacks: 0,
        brightness: 0,
        centré: 0,
        clarity: 0,
        contrast: 0,
        dehaze: 0,
        exposure: 0,
        highlights: 0,
        shadows: 0,
        vibrance: 0,
        vignetteAmount: 0,
        whiteBalanceTechnical: {
          adaptation: 'cat16_v1',
          confidence: 0.9,
          contract: 'rapidraw.white_balance.v1',
          duv,
          inputSemantics: 'raw_scene_linear',
          kelvin,
          mode: 'auto',
          presetId: null,
          sampleCount: 512,
          source: 'auto',
          synchronization: { mode: 'per_image', referenceSourceIdentity: null },
          x: 0.35,
          y: 0.36,
        },
        whites: 0,
      },
    });
  }, response);
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1360 } });
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { html_url: 'https://github.com/CyberTimon/RapidRAW/releases/latest', tag_name: 'v0.0.0-browser' },
      status: 200,
    });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  const thumbnail = page.getByRole('button', { name: /browser-harness\.ARW/u }).first();
  await thumbnail.waitFor({ timeout: 10_000 });
  await thumbnail.dblclick();
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await provisionalBadge.waitFor({ state: 'visible', timeout: 10_000 });
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  const adjustmentsPanelButton = page.getByTestId('right-panel-switcher-button-adjustments');
  if ((await adjustmentsPanelButton.getAttribute('aria-pressed')) !== 'true') await adjustmentsPanelButton.click();
  await page.getByTestId('adjustments-inspector').waitFor({ timeout: 10_000 });
  const colorPanelButton = page.getByTestId('right-panel-switcher-button-color');
  await colorPanelButton.click();
  await page.getByTestId('color-workspace-tab-foundation').click();
  const profileControls = page.getByTestId('profile-tone-controls');
  const quickControls = page.getByTestId('quick-color-controls');
  await profileControls.waitFor({ timeout: 10_000 });
  await quickControls.waitFor({ timeout: 10_000 });
  const identity = await profileControls.evaluate((element) => ({
    revision: element.dataset.commitAdjustmentRevision,
    session: element.dataset.commitImageSession,
    source: element.dataset.commitSourceIdentity,
  }));
  if (identity.source !== sourcePath || identity.session === undefined || identity.revision === undefined) {
    throw new Error(`Camera Input controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }
  await page.waitForTimeout(150);

  const baselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const baselineRenders = (await calls(page, 'apply_adjustments')).length;
  const profileBrowser = page.getByTestId('camera-profile-browser');
  await profileBrowser.getByRole('button', { name: 'Profile preset' }).click();
  await page
    .getByTestId('camera-profile-browser-popover')
    .getByRole('button', { name: 'Neutral', exact: true })
    .click();
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1, 'profile');
  await waitForCount(page, 'apply_adjustments', baselineRenders + 1);
  await waitForRenderedCameraInput(page, 'camera_neutral', { duv: 0, kelvin: 6504, mode: 'as_shot' });
  if ((await profileControls.getAttribute('data-camera-profile')) !== 'camera_neutral') {
    throw new Error('Neutral camera profile was not visibly selected.');
  }

  await page.getByTestId('color-white-balance-mode').selectOption('kelvin_tint');
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 2, 'kelvin mode');
  await waitForCount(page, 'apply_adjustments', baselineRenders + 2);
  await waitForRenderedCameraInput(page, 'camera_neutral', { duv: 0, kelvin: 6504, mode: 'kelvin_tint' });
  await page.getByTestId('color-white-balance-kelvin').waitFor();

  const persistence = persistenceSchema.parse((await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args);
  if (
    persistence.adjustments.cameraProfile !== 'camera_neutral' ||
    persistence.adjustments.whiteBalanceTechnical.mode !== 'kelvin_tint' ||
    persistence.transaction.nextAdjustmentRevision !== persistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Camera Input did not persist one exact transaction: ${JSON.stringify(persistence)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.click();
  await waitForCount(page, 'apply_adjustments', baselineRenders + 3);
  await waitForRenderedCameraInput(page, 'camera_neutral', { duv: 0, kelvin: 6504, mode: 'as_shot' });
  await undo.click();
  await waitForCount(page, 'apply_adjustments', baselineRenders + 4);
  await waitForRenderedCameraInput(page, 'camera_standard', { duv: 0, kelvin: 6504, mode: 'as_shot' });

  const sourceRaceAutoCalls = (await calls(page, 'calculate_auto_adjustments')).length;
  const sourceRaceAutoTransactions = await countAutoWhiteBalanceTransactions(page, sourcePath, 4100);
  await queueAutoWhiteBalanceResponse(page, { delayMs: 600, duv: 0.01, kelvin: 4100 });
  await page.getByTestId('color-white-balance-mode').selectOption('auto');
  await waitForCount(page, 'calculate_auto_adjustments', sourceRaceAutoCalls + 1);
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${successorPath}"]`).click();
  await waitForSelectedSource(page, successorPath);
  await waitForToolbarIdle(page);
  await waitForCompletedCall(page, 'calculate_auto_adjustments', sourceRaceAutoCalls);
  await page.waitForTimeout(100);
  if ((await countAutoWhiteBalanceTransactions(page, sourcePath, 4100)) !== sourceRaceAutoTransactions) {
    throw new Error('A delayed Auto white-balance result persisted into the successor image session.');
  }

  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${sourcePath}"]`).click();
  await waitForSelectedSource(page, sourcePath);
  await waitForToolbarIdle(page);
  if ((await colorPanelButton.getAttribute('aria-pressed')) !== 'true') await colorPanelButton.click();
  await page.getByTestId('color-workspace-tab-foundation').click();

  const presetBaselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  await page.getByTestId('color-white-balance-mode').selectOption('preset');
  await waitForCount(page, 'save_metadata_and_update_thumbnail', presetBaselineSaves + 1, 'preset mode');
  await waitForRenderedCameraInput(page, 'camera_standard', { duv: 0, kelvin: 6504, mode: 'preset' });
  const presetAutoCalls = (await calls(page, 'calculate_auto_adjustments')).length;
  const presetAutoTransactions = await countAutoWhiteBalanceTransactions(page, sourcePath, 6900);
  await queueAutoWhiteBalanceResponse(page, { delayMs: 600, duv: -0.006, kelvin: 6900 });
  await page.getByTestId('color-white-balance-mode').selectOption('auto');
  await page.getByTestId('color-white-balance-preset').selectOption('tungsten');
  await waitForCount(page, 'save_metadata_and_update_thumbnail', presetBaselineSaves + 2, 'preset selection');
  await waitForRenderedCameraInput(page, 'camera_standard', { duv: 0, kelvin: 2856, mode: 'preset' });
  await waitForCompletedCall(page, 'calculate_auto_adjustments', presetAutoCalls);
  await page.waitForTimeout(100);
  if (
    (await calls(page, 'save_metadata_and_update_thumbnail')).length !== presetBaselineSaves + 2 ||
    (await countAutoWhiteBalanceTransactions(page, sourcePath, 6900)) !== presetAutoTransactions
  ) {
    throw new Error('A delayed Auto white-balance result replaced the newer preset intent.');
  }

  const resetBaselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const resetAutoCalls = (await calls(page, 'calculate_auto_adjustments')).length;
  const resetAutoTransactions = await countAutoWhiteBalanceTransactions(page, sourcePath, 5250);
  await queueAutoWhiteBalanceResponse(page, { delayMs: 500, duv: 0.002, kelvin: 5250 });
  await page.getByTestId('color-white-balance-mode').selectOption('auto');
  await page.getByTestId('color-white-balance-as-shot').click();
  await waitForCount(page, 'save_metadata_and_update_thumbnail', resetBaselineSaves + 1, 'as-shot reset');
  await waitForRenderedCameraInput(page, 'camera_standard', { duv: 0, kelvin: 6504, mode: 'as_shot' });
  await waitForCompletedCall(page, 'calculate_auto_adjustments', resetAutoCalls);
  await page.waitForTimeout(100);
  if (
    (await calls(page, 'save_metadata_and_update_thumbnail')).length !== resetBaselineSaves + 1 ||
    (await countAutoWhiteBalanceTransactions(page, sourcePath, 5250)) !== resetAutoTransactions
  ) {
    throw new Error('A delayed Auto white-balance result replaced the newer As Shot reset.');
  }

  const autoBaselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const autoBaselineRenders = (await calls(page, 'apply_adjustments')).length;
  const autoCalls = (await calls(page, 'calculate_auto_adjustments')).length;
  await queueAutoWhiteBalanceResponse(page, { delayMs: 20, duv: 0.004, kelvin: 4850 });
  await page.getByTestId('color-white-balance-mode').selectOption('auto');
  await waitForCompletedCall(page, 'calculate_auto_adjustments', autoCalls);
  await waitForCount(page, 'save_metadata_and_update_thumbnail', autoBaselineSaves + 1, 'auto commit');
  await waitForCount(page, 'apply_adjustments', autoBaselineRenders + 1);
  await waitForRenderedCameraInput(page, 'camera_standard', { duv: 0.004, kelvin: 4850, mode: 'auto' });
  const autoPersistence = persistenceSchema.parse(
    (await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args,
  );
  if (autoPersistence.transaction.nextAdjustmentRevision !== autoPersistence.transaction.baseAdjustmentRevision + 1) {
    throw new Error(`Auto white balance did not persist one exact revision: ${JSON.stringify(autoPersistence)}`);
  }
  await undo.click();
  await waitForCount(page, 'apply_adjustments', autoBaselineRenders + 2);
  await waitForRenderedCameraInput(page, 'camera_standard', { duv: 0, kelvin: 6504, mode: 'as_shot' });

  console.log('camera input edit transaction browser ok');
} catch (error) {
  console.error('camera input edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
