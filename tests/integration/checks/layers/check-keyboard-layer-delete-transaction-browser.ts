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
    adjustments: z
      .object({
        masks: z.array(z.unknown()),
        rawEngineArtifacts: z
          .object({
            layerStackSidecars: z.array(
              z
                .object({
                  graphRevision: z.string().min(1),
                  layers: z.array(z.unknown()),
                  sourceImagePath: z.string().min(1),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      })
      .passthrough(),
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
      if (response.ok) return;
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
    Bun.sleep(5_000).then(() => {
      server.kill('SIGKILL');
    }),
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
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });

  await page.getByTestId('right-panel-switcher-button-masks').click();
  await page.getByTestId('layer-stack-header').waitFor({ timeout: 10_000 });
  const layerRows = page.locator(
    '[data-testid^="layer-stack-layer-row-"]:not([data-testid="layer-stack-layer-row-base-raw-layer"])',
  );
  await page.getByTestId('layer-create-brush-local-adjustment').click();
  await layerRows.first().waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) >= 1,
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(400);
  const baselineSaves = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );

  await page.keyboard.press('Backspace');
  await layerRows.first().waitFor({ state: 'detached', timeout: 10_000 });
  await page.getByTestId('layer-stack-layer-row-base-raw-layer').waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    baselineSaves + 1,
    { timeout: 10_000 },
  );

  const rawPersistence = await page.evaluate(() => {
    const save = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
      .at(-1);
    return save?.args ?? null;
  });
  const persistence = persistenceSchema.parse(rawPersistence);
  const sidecar = persistence.adjustments.rawEngineArtifacts.layerStackSidecars.find(
    (candidate) => candidate.sourceImagePath === sourcePath,
  );
  if (
    persistence.adjustments.masks.length !== 0 ||
    sidecar === undefined ||
    sidecar.layers.length !== 0 ||
    persistence.transaction.nextAdjustmentRevision !== persistence.transaction.baseAdjustmentRevision + 1 ||
    !sidecar.graphRevision.includes(persistence.transaction.transactionId)
  ) {
    throw new Error(`Keyboard layer delete did not persist one canonical transaction: ${JSON.stringify(persistence)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]');
  if (!(await undo.isEnabled())) throw new Error('Keyboard layer delete did not create an undo boundary.');
  await undo.click();
  await layerRows.first().waitFor({ timeout: 10_000 });

  console.log('keyboard layer delete transaction browser ok');
} catch (error) {
  console.error('keyboard layer delete transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
