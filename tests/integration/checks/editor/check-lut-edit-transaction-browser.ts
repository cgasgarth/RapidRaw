#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const lutSchema = z
  .object({
    lutData: z.unknown().nullable(),
    lutIntensity: z.number(),
    lutName: z.string().nullable(),
    lutPath: z.string().nullable(),
    lutSize: z.number().int().nonnegative(),
  })
  .passthrough();
const persistenceSchema = z
  .object({
    adjustments: lutSchema,
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
              nodes: z.object({ display_creative: z.object({ params: lutSchema }).passthrough() }).passthrough(),
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

const waitForRenderedLut = async (page: Page, expectedPath: string | null, expectedIntensity: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderSchema.safeParse((await calls(page, 'apply_adjustments')).at(-1));
    const lut = parsed.success ? parsed.data.args.request.editDocumentV2.nodes.display_creative.params : null;
    if (
      parsed.success &&
      parsed.data.endedAtMs !== null &&
      lut?.lutPath === expectedPath &&
      lut.lutIntensity === expectedIntensity
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered LUT ${String(expectedPath)} at ${String(expectedIntensity)}%.`);
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
  await page.evaluate((path) => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.setAdjustmentsForPath(path, {
      lutData: null,
      lutIntensity: 47,
      lutName: 'Browser Warm.cube',
      lutPath: '/fixtures/browser-warm.cube',
      lutSize: 17,
    });
  }, sourcePath);
  await page.getByRole('button', { name: /Open Folder/u }).click();
  const thumbnail = page.getByRole('button', { name: /browser-harness\.ARW/u }).first();
  await thumbnail.waitFor({ timeout: 10_000 });
  await thumbnail.dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  const effects = page.getByTestId('adjustments-section-effects');
  const disclosure = effects.locator('button[aria-expanded]').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  await page.getByTestId('lut-control').waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Browser Warm.cube' }).waitFor();

  const baselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const baselineRenders = (await calls(page, 'apply_adjustments')).length;
  await page.getByTestId('lut-control').hover();
  await page.getByTestId('lut-control-clear').click();
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 1);
  await waitForRenderedLut(page, null, 100);
  await page.getByTestId('lut-control').getByRole('button', { name: 'Select' }).waitFor();

  const persistence = persistenceSchema.parse((await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args);
  if (
    persistence.adjustments.lutPath !== null ||
    persistence.adjustments.lutName !== null ||
    persistence.adjustments.lutSize !== 0 ||
    persistence.adjustments.lutIntensity !== 100 ||
    persistence.transaction.nextAdjustmentRevision !== persistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`LUT clear did not persist one complete identity transaction: ${JSON.stringify(persistence)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.click();
  await waitForCount(page, 'apply_adjustments', baselineRenders + 2);
  await waitForRenderedLut(page, '/fixtures/browser-warm.cube', 47);
  await page.getByRole('button', { name: 'Browser Warm.cube' }).waitFor();

  console.log('LUT edit transaction browser ok');
} catch (error) {
  console.error('LUT edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
