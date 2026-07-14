#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const persistenceSchema = z
  .object({
    adjustments: z.object({ crop: z.unknown().nullable(), rotation: z.number().finite() }).passthrough(),
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
  await page.getByRole('region', { name: 'Image preview' }).waitFor({ timeout: 10_000 });

  const cropPanelButton = page.getByTestId('right-panel-switcher-button-crop');
  if ((await cropPanelButton.getAttribute('aria-pressed')) !== 'true') await cropPanelButton.click();
  const straightenToggle = page.getByTestId('crop-panel-straighten-toggle');
  await straightenToggle.waitFor({ timeout: 10_000 });
  await straightenToggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const baselineSaves = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );

  await straightenToggle.click();
  const input = page.getByTestId('crop-straighten-input-surface');
  await input.waitFor({ timeout: 10_000 });
  const inputIdentity = await input.evaluate((element) => ({
    imageSessionId: element.dataset.controllerImageSession,
    operationGeneration: element.dataset.controllerOperationGeneration,
    sourceIdentity: element.dataset.controllerSourceIdentity,
    sourceRevision: element.dataset.controllerSourceRevision,
  }));
  if (
    inputIdentity.sourceIdentity !== sourcePath ||
    inputIdentity.imageSessionId === undefined ||
    inputIdentity.operationGeneration === undefined ||
    inputIdentity.sourceRevision === undefined
  ) {
    throw new Error(
      `Straighten input did not expose complete source/session identity: ${JSON.stringify(inputIdentity)}`,
    );
  }
  const bounds = await input.boundingBox();
  if (bounds === null || bounds.width < 100 || bounds.height < 100) {
    throw new Error('Straighten input did not expose a usable pointer surface.');
  }
  const start = { x: bounds.x + bounds.width * 0.3, y: bounds.y + bounds.height * 0.42 };
  const end = { x: bounds.x + bounds.width * 0.7, y: bounds.y + bounds.height * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.getByTestId('crop-straighten-guide').waitFor({ timeout: 10_000 });
  await page.mouse.up();

  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    baselineSaves + 1,
    { timeout: 10_000 },
  );
  await input.waitFor({ state: 'detached', timeout: 10_000 });
  if ((await straightenToggle.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('Straighten tool did not deactivate after its one-shot commit.');
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
    Math.abs(persisted.adjustments.rotation) < 1 ||
    persisted.adjustments.crop === null ||
    persisted.transaction.imageSessionId !== inputIdentity.imageSessionId ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Straighten did not persist one source-bound geometry revision: ${JSON.stringify(persisted)}`);
  }
  const resetRotation = page.getByTestId('crop-panel-reset-fine-rotation');
  if (!(await resetRotation.isEnabled())) throw new Error('Straighten rotation was not visibly committed.');

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Straighten commit did not create an undo boundary.');
  await undo.click();
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="crop-panel-reset-fine-rotation"]') as HTMLButtonElement)?.disabled,
    undefined,
    { timeout: 10_000 },
  );

  console.log('straighten edit transaction browser ok');
} catch (error) {
  console.error('straighten edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
