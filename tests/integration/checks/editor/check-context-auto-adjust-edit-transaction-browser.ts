#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const autoAdjustments = (exposure: number) => ({
  blacks: -4,
  brightness: 1.2,
  clarity: 8,
  contrast: 18,
  dehaze: 5,
  exposure,
  highlights: -10,
  shadows: 12,
  vibrance: 16,
  vignetteAmount: -3,
  whiteBalanceTechnical: {
    adaptation: 'cat16_v1',
    confidence: 0.8,
    contract: 'rapidraw.white_balance.v1',
    duv: 0,
    inputSemantics: 'raw_scene_linear',
    kelvin: 6504,
    mode: 'auto',
    presetId: null,
    sampleCount: 256,
    source: 'auto',
    synchronization: { mode: 'per_image', referenceSourceIdentity: null },
    x: 0.31271,
    y: 0.32902,
  },
  whites: 6,
  centré: 2,
});
const persistenceSchema = z
  .object({
    adjustments: z.object({
      exposure: z.number(),
      whiteBalanceTechnical: z.object({ mode: z.string() }).passthrough(),
    }),
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
              nodes: z
                .object({ scene_global_color_tone: z.object({ params: z.object({ exposure: z.number() }) }) })
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

const waitForCompletedCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await calls(page, command)).filter(({ endedAtMs }) => endedAtMs !== null).length >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} completed ${command} calls.`);
};

const waitForRenderedExposure = async (page: Page, exposure: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const parsed = renderSchema.safeParse((await calls(page, 'apply_adjustments')).at(-1));
    if (
      parsed.success &&
      parsed.data.endedAtMs !== null &&
      parsed.data.args.request.editDocumentV2.nodes.scene_global_color_tone.params['exposure'] === exposure
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered exposure ${String(exposure)}.`);
};

const queueAutoResponse = async (page: Page, delayMs: number, exposure: number) => {
  await page.evaluate(
    ({ delayMs, value }) => {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.autoAdjustResponses.push({ delayMs, value });
    },
    { delayMs, value: autoAdjustments(exposure) },
  );
};

const triggerAutoAdjust = async (page: Page) => {
  await page.getByTestId('editor-image-preview-region').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Productivity', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Auto Adjust Image', exact: true }).first().click();
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

  await queueAutoResponse(page, 0, 0.35);
  const initialSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const initialRenders = (await calls(page, 'apply_adjustments')).length;
  await triggerAutoAdjust(page);
  await waitForCount(page, 'save_metadata_and_update_thumbnail', initialSaves + 1);
  await waitForCount(page, 'apply_adjustments', initialRenders + 1);
  await waitForRenderedExposure(page, 0.35);
  const acceptedPersistence = persistenceSchema.parse(
    (await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args,
  );
  if (
    acceptedPersistence.adjustments.exposure !== 0.35 ||
    acceptedPersistence.adjustments.whiteBalanceTechnical.mode !== 'auto' ||
    acceptedPersistence.transaction.nextAdjustmentRevision !==
      acceptedPersistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Auto Adjust did not persist one exact transaction: ${JSON.stringify(acceptedPersistence)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  const redo = page.locator('button[data-command-id="redo"]:visible').first();
  const savesBeforeUndo = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  await undo.click();
  await waitForRenderedExposure(page, 0);
  await waitForCount(page, 'save_metadata_and_update_thumbnail', savesBeforeUndo + 1);
  const undoPersistence = persistenceSchema.parse(
    (await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args,
  );
  if (
    undoPersistence.adjustments.exposure !== 0 ||
    !undoPersistence.transaction.transactionId.startsWith('history:') ||
    undoPersistence.transaction.baseAdjustmentRevision !== acceptedPersistence.transaction.nextAdjustmentRevision ||
    undoPersistence.transaction.nextAdjustmentRevision !== undoPersistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Undo did not persist one revisioned history transaction: ${JSON.stringify(undoPersistence)}`);
  }

  await redo.click();
  await waitForRenderedExposure(page, 0.35);
  await waitForCount(page, 'save_metadata_and_update_thumbnail', savesBeforeUndo + 2);
  const redoPersistence = persistenceSchema.parse(
    (await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args,
  );
  if (
    redoPersistence.adjustments.exposure !== 0.35 ||
    !redoPersistence.transaction.transactionId.startsWith('history:') ||
    redoPersistence.transaction.baseAdjustmentRevision !== undoPersistence.transaction.nextAdjustmentRevision ||
    redoPersistence.transaction.nextAdjustmentRevision !== redoPersistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Redo did not persist one revisioned history transaction: ${JSON.stringify(redoPersistence)}`);
  }

  await undo.click();
  await waitForRenderedExposure(page, 0);
  await waitForCount(page, 'save_metadata_and_update_thumbnail', savesBeforeUndo + 3);

  const raceSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const raceRenders = (await calls(page, 'apply_adjustments')).length;
  const raceInvokes = (await calls(page, 'calculate_auto_adjustments')).length;
  await queueAutoResponse(page, 1_200, 0.8);
  await queueAutoResponse(page, 0, 0.45);
  await triggerAutoAdjust(page);
  await waitForCount(page, 'calculate_auto_adjustments', raceInvokes + 1);
  await triggerAutoAdjust(page);
  await waitForCompletedCount(page, 'calculate_auto_adjustments', raceInvokes + 2);
  await waitForCount(page, 'save_metadata_and_update_thumbnail', raceSaves + 1);
  await waitForCount(page, 'apply_adjustments', raceRenders + 1);
  await waitForRenderedExposure(page, 0.45);
  await page.waitForTimeout(150);
  const racePersistenceCalls = await calls(page, 'save_metadata_and_update_thumbnail');
  if (racePersistenceCalls.length !== raceSaves + 1) {
    throw new Error(
      `Superseded Auto Adjust result performed an extra persistence write: ${JSON.stringify(
        racePersistenceCalls.map((call) => ({
          exposure: (call.args?.['adjustments'] as { exposure?: unknown } | undefined)?.exposure,
          transaction: call.args?.['transaction'],
        })),
      )}`,
    );
  }

  const noOpSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const noOpRenders = (await calls(page, 'apply_adjustments')).length;
  await queueAutoResponse(page, 0, 0.45);
  await triggerAutoAdjust(page);
  await waitForCompletedCount(page, 'calculate_auto_adjustments', raceInvokes + 3);
  await page.waitForTimeout(150);
  if (
    (await calls(page, 'save_metadata_and_update_thumbnail')).length !== noOpSaves ||
    (await calls(page, 'apply_adjustments')).length !== noOpRenders
  ) {
    throw new Error('Exact-repeat Auto Adjust performed persistence or render work.');
  }

  console.log('context Auto Adjust edit transaction browser ok');
} catch (error) {
  console.error('context Auto Adjust edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
