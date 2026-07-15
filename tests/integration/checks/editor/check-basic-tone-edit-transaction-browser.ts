#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const persistenceSchema = z
  .object({
    adjustments: z.object({ exposure: z.number() }).passthrough(),
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

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: {
    ...process.env,
    RAWENGINE_DEV_SERVER_PORT: String(port),
    VITE_RAWENGINE_BROWSER_TAURI_HARNESS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const captureServerOutput = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', captureServerOutput);
server.stderr.on('data', captureServerOutput);

const waitForServer = async () => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited before startup.');
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        await Bun.sleep(500);
        if ((await fetch(baseUrl)).ok) return;
      }
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
    new Promise<void>((resolve) => {
      server.once('exit', () => resolve());
    }),
    Bun.sleep(5_000).then(() => server.kill('SIGKILL')),
  ]);
};

const saveCount = async (page: Page) =>
  page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );

const renderCount = async (page: Page) =>
  page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );

const waitForSaveCount = async (page: Page, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await saveCount(page)) === expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} saves; observed ${String(await saveCount(page))}.`);
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 820, width: 1360 } });
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

  const controls = page.getByTestId('basic-light-controls');
  const identity = await controls.evaluate((element) => ({
    adjustmentRevision: element.dataset.commitAdjustmentRevision,
    imageSessionId: element.dataset.commitImageSession,
    sourceIdentity: element.dataset.commitSourceIdentity,
  }));
  if (
    identity.sourceIdentity !== sourcePath ||
    identity.imageSessionId === undefined ||
    identity.adjustmentRevision === undefined
  ) {
    throw new Error(`Basic controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }
  const exposureRange = page.getByTestId('basic-control-exposure-range');
  const rangeBox = await exposureRange.boundingBox();
  if (rangeBox === null) throw new Error('Exposure range did not have layout bounds.');
  const startX = rangeBox.x + rangeBox.width / 2;
  const pointerY = rangeBox.y + rangeBox.height / 2;
  const baselineSaves = await saveCount(page);
  const baselineRenders = await renderCount(page);
  await page.mouse.move(startX, pointerY);
  await page.mouse.down();
  for (const fraction of [0.53, 0.56, 0.59, 0.62, 0.65]) {
    await page.mouse.move(rangeBox.x + rangeBox.width * fraction, pointerY);
    await page.waitForTimeout(60);
  }
  await page.waitForFunction(
    (before) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0) >=
      before + 2,
    baselineRenders,
    { timeout: 10_000 },
  );
  if ((await saveCount(page)) !== baselineSaves) {
    throw new Error('Exposure drag persisted before its release boundary.');
  }
  await page.mouse.up();
  await waitForSaveCount(page, baselineSaves + 1);
  const committedExposure = Number((await page.getByTestId('basic-control-exposure-value').textContent())?.trim());
  if (!Number.isFinite(committedExposure) || committedExposure === 0) {
    throw new Error('Exposure was not visibly committed.');
  }

  const persisted = persistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (
    persisted.adjustments.exposure !== committedExposure ||
    persisted.transaction.imageSessionId !== identity.imageSessionId ||
    persisted.transaction.baseAdjustmentRevision !== Number(identity.adjustmentRevision) ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Exposure did not persist one source-bound tone revision: ${JSON.stringify(persisted)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Exposure commit did not create an undo boundary.');
  const undoBaselineSaves = await saveCount(page);
  await undo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim() === '0',
    undefined,
    { timeout: 10_000 },
  );
  await waitForSaveCount(page, undoBaselineSaves + 1);
  await page.waitForTimeout(320);

  const cancelBaselineSaves = await saveCount(page);
  const cancelBaselineRenders = await renderCount(page);
  await page.mouse.move(startX, pointerY);
  await page.mouse.down();
  await page.mouse.move(rangeBox.x + rangeBox.width * 0.35, pointerY);
  await page.waitForFunction(
    (before) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0) > before,
    cancelBaselineRenders,
    { timeout: 10_000 },
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(500);
  if ((await saveCount(page)) !== cancelBaselineSaves) {
    throw new Error('Cancelled exposure drag created a persistence transaction.');
  }
  if ((await page.getByTestId('basic-control-exposure-value').textContent())?.trim() !== '0') {
    throw new Error('Cancelled exposure drag did not restore the canonical control value.');
  }

  console.log('basic tone edit transaction browser ok');
} catch (error) {
  console.error('basic tone edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
