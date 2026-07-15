#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';
import { EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES } from '../../../../src/utils/editDocumentV2';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const persistenceSchema = z
  .object({
    adjustments: z.object({ brightness: z.number(), exposure: z.number() }).passthrough(),
    editDocumentV2: z
      .object({
        nodes: z
          .object({
            scene_global_color_tone: z.object({ enabled: z.boolean(), params: z.object({ exposure: z.number() }) }),
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

const commitNumericControl = async (page: Page, testId: string, value: string) => {
  await page.getByTestId(`${testId}-value`).click();
  const input = page.getByTestId(`${testId}-input`);
  await input.fill(value);
  await input.press('Enter');
  await page.getByTestId(`${testId}-value`).waitFor({ state: 'visible', timeout: 10_000 });
};

const saveCount = async (page: Page) =>
  page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );

const waitForSaveCount = async (page: Page, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await saveCount(page)) === expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} saves; observed ${String(await saveCount(page))}.`);
};

const waitForControlValue = async (page: Page, testId: string, expected: string) => {
  const value = page.getByTestId(`${testId}-value`);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await value.textContent())?.trim() === expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Timed out waiting for ${testId}=${expected}; observed ${(await value.textContent())?.trim() ?? 'missing'}.`,
  );
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

  const transferZone = page.getByTestId('editor-bottom-transfer-zone');
  await transferZone.getByRole('button', { exact: true, name: 'Copy & Paste Settings' }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Copy & Paste Settings' });
  await settingsDialog.waitFor({ timeout: 10_000 });
  if (
    (await settingsDialog.getByRole('checkbox').count()) !== EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES.length ||
    (await settingsDialog.getByText('Tone', { exact: true }).count()) !== 1 ||
    (await settingsDialog.getByText('Profile & Tone', { exact: true }).count()) !== 1 ||
    (await settingsDialog.getByText('Masks', { exact: true }).count()) !== 0
  ) {
    throw new Error('Copy/paste settings did not expose exactly the descriptor-approved creative nodes.');
  }
  await settingsDialog.getByRole('button', { name: 'Cancel' }).click();

  let saves = await saveCount(page);
  await commitNumericControl(page, 'basic-control-exposure', '0.65');
  await waitForSaveCount(page, saves + 1);
  saves += 1;
  await transferZone.getByRole('button', { exact: true, name: 'Copy Settings' }).click();

  const noOpApplyBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'apply_adjustments_to_paths',
      ).length ?? 0,
  );
  await transferZone.getByRole('button', { exact: true, name: 'Paste Settings' }).click();
  await page.waitForTimeout(300);
  if (
    (await saveCount(page)) !== saves ||
    (await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'apply_adjustments_to_paths',
        ).length ?? 0,
    )) !== noOpApplyBaseline
  ) {
    throw new Error('Selected-only no-op paste produced persistence or native side effects.');
  }

  await commitNumericControl(page, 'basic-control-exposure', '0.15');
  await waitForSaveCount(page, saves + 1);
  saves += 1;
  const applyBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'apply_adjustments_to_paths',
      ).length ?? 0,
  );
  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__) {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.applyAdjustmentsToPathsDelayMs = 800;
    }
  });

  await transferZone.getByRole('button', { exact: true, name: 'Paste Settings' }).click();
  await waitForControlValue(page, 'basic-control-exposure', '0.65');
  await waitForSaveCount(page, saves + 1);
  const pasteSave = persistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (
    pasteSave.adjustments.exposure !== 0.65 ||
    pasteSave.editDocumentV2.nodes.scene_global_color_tone.params.exposure !== 0.65 ||
    !pasteSave.editDocumentV2.nodes.scene_global_color_tone.enabled ||
    pasteSave.transaction.nextAdjustmentRevision !== pasteSave.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Paste did not persist one canonical revision: ${JSON.stringify(pasteSave)}`);
  }
  saves += 1;
  const nativePaste = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'apply_adjustments_to_paths')
        .at(-1)?.args.adjustments ?? null,
  );
  if (
    typeof nativePaste !== 'object' ||
    nativePaste === null ||
    Reflect.get(nativePaste, 'exposure') !== pasteSave.adjustments.exposure ||
    Reflect.get(nativePaste, 'referenceMatchApplicationReceipt') !== null ||
    Reflect.has(nativePaste, 'masks') ||
    Reflect.has(nativePaste, 'aiPatches')
  ) {
    throw new Error(
      `Native compatibility lowering diverged from canonical document output or leaked provenance: ${JSON.stringify(nativePaste)}`,
    );
  }

  await commitNumericControl(page, 'basic-control-brightness', '0.25');
  await waitForSaveCount(page, saves + 1);
  saves += 1;
  await page.waitForFunction(
    (expected) => {
      const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'apply_adjustments_to_paths')
        .at(expected);
      return call?.endedAtMs !== null && call?.endedAtMs !== undefined;
    },
    applyBaseline,
    { timeout: 10_000 },
  );
  if (
    (await page.getByTestId('basic-control-exposure-value').textContent())?.trim() !== '0.65' ||
    (await page.getByTestId('basic-control-brightness-value').textContent())?.trim() !== '0.25' ||
    (await saveCount(page)) !== saves
  ) {
    throw new Error('Late partial native paste receipt overwrote canonical adjustments or persisted twice.');
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.click();
  await waitForControlValue(page, 'basic-control-brightness', '0');
  await undo.click();
  await waitForControlValue(page, 'basic-control-exposure', '0.15');

  console.log('copy/paste edit transaction browser ok');
} catch (error) {
  console.error('copy/paste edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
