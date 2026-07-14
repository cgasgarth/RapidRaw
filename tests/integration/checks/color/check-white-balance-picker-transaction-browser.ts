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
        whiteBalanceTechnical: z.object({ source: z.literal('picker') }).passthrough(),
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
  await page.locator('[data-editor-image-frame="edited"]').first().waitFor({ timeout: 10_000 });
  const colorPanelButton = page.getByTestId('right-panel-switcher-button-color');
  if ((await colorPanelButton.getAttribute('aria-pressed')) !== 'true') await colorPanelButton.click();
  try {
    await page.getByTestId('color-workspace-panel').waitFor({ timeout: 10_000 });
  } catch {
    const panelState = await colorPanelButton.evaluate((element) => ({
      active: element.getAttribute('aria-pressed'),
      state: element.getAttribute('data-panel-state'),
    }));
    throw new Error(`Color panel did not activate after selection: ${JSON.stringify(panelState)}`);
  }
  await page.getByTestId('color-workspace-tab-foundation').click();
  const picker = page.getByTestId('color-white-balance-picker');
  await picker.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  const baseline = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return {
      previews: calls.filter(({ command }) => command === 'apply_adjustments').length,
      saves: calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length,
    };
  });
  await picker.click();
  if ((await picker.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('White Balance picker did not enter its active UI state.');
  }
  const bounds = await page.locator('[data-editor-image-frame="edited"]').first().boundingBox();
  if (bounds === null) throw new Error('White Balance picker could not resolve displayed image bounds.');
  const samplePoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(samplePoint.x - 10, samplePoint.y - 10);
  await page.mouse.move(samplePoint.x, samplePoint.y);
  await page.waitForFunction(
    (minimum) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0) > minimum,
    baseline.previews,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(500);
  const savesAfterHover = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  if (savesAfterHover !== baseline.saves) {
    throw new Error(
      `White Balance hover preview persisted metadata: ${String(baseline.saves)} -> ${String(savesAfterHover)}`,
    );
  }

  await page.mouse.click(samplePoint.x, samplePoint.y);
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    baseline.saves + 1,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(300);
  if ((await picker.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('White Balance picker did not deactivate after its one-shot commit.');
  }

  const persisted = persistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1) {
    throw new Error(`White Balance picker did not persist one canonical revision: ${JSON.stringify(persisted)}`);
  }
  const canvas = page.getByTestId('image-canvas');
  if ((await canvas.getAttribute('data-wb-picker-image-path')) !== sourcePath) {
    throw new Error('White Balance picker did not publish its visible source-bound receipt.');
  }
  const sampleRed = Number(await canvas.getAttribute('data-wb-picker-sample-red'));
  if (!Number.isFinite(sampleRed)) throw new Error('White Balance picker receipt omitted its sampled RGB proof.');

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('White Balance picker commit did not create an undo boundary.');
  await undo.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="color-quick-white-balance"]')?.getAttribute('data-white-balance-state') ===
      'as-shot',
    undefined,
    { timeout: 10_000 },
  );

  console.log('white balance picker transaction browser ok');
} catch (error) {
  console.error('white balance picker transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
