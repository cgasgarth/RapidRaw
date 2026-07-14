#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const transactionSchema = z
  .object({
    baseAdjustmentRevision: z.number().int().nonnegative(),
    imageSessionId: z.string().min(1),
    nextAdjustmentRevision: z.number().int().positive(),
    transactionId: z.string().min(1),
  })
  .strict();
const persistenceSchema = z
  .object({
    adjustments: z
      .object({
        masks: z.array(
          z
            .object({
              adjustments: z
                .object({
                  toneEqualizer: z.object({ enabled: z.boolean() }).passthrough(),
                })
                .passthrough(),
              id: z.string().min(1),
            })
            .passthrough(),
        ),
        rawEngineEditGraphVersion: z.number().int().positive(),
      })
      .passthrough(),
    path: z.literal(sourcePath),
    transaction: transactionSchema,
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
        if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited after startup.');
        const confirmation = await fetch(baseUrl);
        if (confirmation.ok) return;
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
    Bun.sleep(5_000).then(() => {
      server.kill('SIGKILL');
    }),
  ]);
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
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
  await page.getByTestId('layer-create-brush-local-adjustment').click();
  const toneEqualizerEnable = page.getByTestId('tone-equalizer-enable');
  await toneEqualizerEnable.scrollIntoViewIfNeeded();
  await toneEqualizerEnable.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) >= 1,
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const saves = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
      ({ command }) => command === 'save_metadata_and_update_thumbnail',
    );
    return { count: saves?.length ?? 0, last: saves?.at(-1)?.args ?? null };
  });
  const creationPersistence = persistenceSchema.parse(before.last);

  await toneEqualizerEnable.click();
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    before.count + 1,
    { timeout: 10_000 },
  );
  const tonePersistence = persistenceSchema.parse(
    await page.evaluate(() => {
      const save = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
        .at(-1);
      return save?.args ?? null;
    }),
  );
  const adjustedLayer = tonePersistence.adjustments.masks.find((mask) => mask.adjustments.toneEqualizer.enabled);
  if (
    adjustedLayer === undefined ||
    tonePersistence.adjustments.rawEngineEditGraphVersion !== 2 ||
    tonePersistence.transaction.baseAdjustmentRevision !== creationPersistence.transaction.nextAdjustmentRevision ||
    tonePersistence.transaction.nextAdjustmentRevision !== tonePersistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(
      `Mask Tone Equalizer did not promote and edit through one contiguous revision: ${JSON.stringify({ creationPersistence, tonePersistence })}`,
    );
  }
  if ((await toneEqualizerEnable.textContent())?.trim() !== 'On') {
    throw new Error('Mask Tone Equalizer did not expose its committed enabled state.');
  }

  const undo = page.locator('button[data-command-id="undo"]');
  if (!(await undo.isEnabled())) throw new Error('Mask Tone Equalizer edit did not create an undo boundary.');
  await undo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tone-equalizer-enable"]')?.textContent?.trim() === 'Enable',
  );

  console.log('mask tone equalizer transaction browser ok');
} catch (error) {
  console.error('mask tone equalizer transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
