#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const cameraInputSchema = z
  .object({
    cameraProfile: z.string(),
    cameraProfileAmount: z.number(),
    creativeTemperature: z.number(),
    creativeTint: z.number(),
    whiteBalanceMigration: z.string(),
    whiteBalanceTechnical: z.object({ mode: z.string() }).passthrough(),
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

const waitForCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await calls(page, command)).length >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} ${command} calls.`);
};

const waitForRenderedCameraInput = async (page: Page, profile: string, mode: string) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderSchema.safeParse((await calls(page, 'apply_adjustments')).at(-1));
    const params = parsed.success ? parsed.data.args.request.editDocumentV2.nodes.camera_input.params : null;
    if (
      parsed.success &&
      parsed.data.endedAtMs !== null &&
      params?.cameraProfile === profile &&
      params.whiteBalanceTechnical.mode === mode
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for Camera Input profile=${profile}, mode=${mode}.`);
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
  await page.getByTestId('right-panel-switcher-button-color').click();
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
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 1);
  await waitForRenderedCameraInput(page, 'camera_neutral', 'as_shot');
  if ((await profileControls.getAttribute('data-camera-profile')) !== 'camera_neutral') {
    throw new Error('Neutral camera profile was not visibly selected.');
  }

  await page.getByTestId('color-white-balance-mode').selectOption('kelvin_tint');
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 2);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 2);
  await waitForRenderedCameraInput(page, 'camera_neutral', 'kelvin_tint');
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
  await waitForRenderedCameraInput(page, 'camera_neutral', 'as_shot');
  await undo.click();
  await waitForCount(page, 'apply_adjustments', baselineRenders + 4);
  await waitForRenderedCameraInput(page, 'camera_standard', 'as_shot');

  console.log('camera input edit transaction browser ok');
} catch (error) {
  console.error('camera input edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
