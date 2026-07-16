#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const maskSchema = z.object({ id: z.string().min(1), visible: z.boolean() }).passthrough();
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
    adjustments: z.object({ masks: z.array(maskSchema) }).passthrough(),
    path: z.literal(sourcePath),
    transaction: transactionSchema,
  })
  .passthrough();
const renderSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z
            .object({
              layers: z.object({ masks: z.array(maskSchema) }).strict(),
              nodes: z
                .object({
                  layers: z.object({ params: z.object({ masks: z.array(maskSchema) }).strict() }).passthrough(),
                })
                .passthrough(),
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

const waitForRenderedMasks = async (page: Page, expected: ReadonlyArray<{ id: string; visible: boolean }>) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderSchema.safeParse((await calls(page, 'apply_adjustments')).at(-1));
    if (parsed.success && parsed.data.endedAtMs !== null) {
      const document = parsed.data.args.request.editDocumentV2;
      const nodeMasks = document.nodes.layers.params['masks'];
      const projected = nodeMasks.map(({ id, visible }) => ({ id, visible }));
      if (
        JSON.stringify(projected) === JSON.stringify(expected) &&
        JSON.stringify(nodeMasks) === JSON.stringify(document.layers.masks)
      )
        return;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered Layers ${JSON.stringify(expected)}.`);
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
  const row = page.locator('[data-testid^="mask-container-row-"]').first();
  await row.waitFor({ timeout: 10_000 });
  const maskId = (await row.getAttribute('data-testid'))?.replace('mask-container-row-', '');
  if (!maskId) throw new Error('Created mask row did not expose its identity.');
  await waitForCount(page, 'save_metadata_and_update_thumbnail', 1);
  const baselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const baselineRenders = (await calls(page, 'apply_adjustments')).length;

  await row.getByRole('button', { name: 'Hide Mask' }).click();
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 1);
  await waitForRenderedMasks(page, [{ id: maskId, visible: false }]);
  if ((await row.getAttribute('data-mask-container-visible')) !== 'false') {
    throw new Error('Mask visibility was not visibly committed.');
  }

  await row.hover();
  await row.getByRole('button', { name: 'Delete Mask' }).click();
  await row.waitFor({ state: 'detached', timeout: 10_000 });
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 2);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 2);
  await waitForRenderedMasks(page, []);

  const saves = await calls(page, 'save_metadata_and_update_thumbnail');
  const visibility = persistenceSchema.parse(saves.at(-2)?.args);
  const deletion = persistenceSchema.parse(saves.at(-1)?.args);
  if (
    visibility.adjustments.masks[0]?.visible !== false ||
    deletion.adjustments.masks.length !== 0 ||
    visibility.transaction.nextAdjustmentRevision !== deletion.transaction.baseAdjustmentRevision ||
    visibility.transaction.imageSessionId !== deletion.transaction.imageSessionId ||
    deletion.transaction.nextAdjustmentRevision !== deletion.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(
      `Mask visibility/delete did not persist as sequential Layers transactions: ${JSON.stringify({ deletion, visibility })}`,
    );
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.click();
  await row.waitFor({ timeout: 10_000 });
  await waitForCount(page, 'apply_adjustments', baselineRenders + 3);
  await waitForRenderedMasks(page, [{ id: maskId, visible: false }]);
  await undo.click();
  await waitForCount(page, 'apply_adjustments', baselineRenders + 4);
  await waitForRenderedMasks(page, [{ id: maskId, visible: true }]);
  if ((await row.getAttribute('data-mask-container-visible')) !== 'true') {
    throw new Error('Undo did not visibly restore mask visibility.');
  }

  console.log('mask layer edit transaction browser ok');
} catch (error) {
  console.error('mask layer edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
