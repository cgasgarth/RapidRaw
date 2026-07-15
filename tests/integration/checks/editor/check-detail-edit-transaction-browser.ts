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
    adjustments: z
      .object({ deblurEnabled: z.literal(true), deblurSigmaPx: z.literal(1.1), deblurStrength: z.literal(32) })
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
const renderCallSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z
            .object({
              nodes: z
                .object({
                  detail_denoise_dehaze: z
                    .object({
                      params: z
                        .object({
                          deblurEnabled: z.boolean(),
                          deblurSigmaPx: z.number(),
                          deblurStrength: z.number(),
                        })
                        .passthrough(),
                    })
                    .passthrough(),
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

const applyCount = async (page: Page) =>
  page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );

const waitForApplyCount = async (page: Page, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await applyCount(page)) >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} renders; observed ${String(await applyCount(page))}.`);
};

const waitForRenderedDeblur = async (page: Page, expected: { enabled: boolean; sigmaPx: number; strength: number }) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const call = renderCallSchema.safeParse(
      await page.evaluate(() =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'apply_adjustments')
          .at(-1),
      ),
    );
    if (
      call.success &&
      call.data.endedAtMs !== null &&
      call.data.args.request.editDocumentV2.nodes.detail_denoise_dehaze.params.deblurEnabled === expected.enabled &&
      call.data.args.request.editDocumentV2.nodes.detail_denoise_dehaze.params.deblurSigmaPx === expected.sigmaPx &&
      call.data.args.request.editDocumentV2.nodes.detail_denoise_dehaze.params.deblurStrength === expected.strength
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered Deblur ${JSON.stringify(expected)}.`);
};

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

  const detailSection = page.getByTestId('adjustments-section-details');
  const disclosure = detailSection.locator('button[aria-expanded]').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const controls = page.getByTestId('detail-controls');
  await controls.waitFor({ timeout: 10_000 });
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
    throw new Error(`Detail controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }
  const baselineSaves = await saveCount(page);
  const baselineApplies = await applyCount(page);
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push(
      { color: [24, 200, 80], delayMs: 20 },
      { color: [80, 120, 220], delayMs: 20 },
      { color: [220, 120, 80], delayMs: 20 },
    );
  });

  const enabled = page.locator('#detail-control-deblur-enabled');
  await page.locator('label[for="detail-control-deblur-enabled"]').click();
  await waitForSaveCount(page, baselineSaves + 1);
  await waitForApplyCount(page, baselineApplies + 1);
  if (!(await enabled.isChecked())) throw new Error('Deblur Enabled was not visibly committed.');
  await waitForRenderedDeblur(page, { enabled: true, sigmaPx: 0.8, strength: 0 });

  await page.getByTestId('detail-control-deblur-strength-value').click();
  const strengthInput = page.getByTestId('detail-control-deblur-strength-input');
  await strengthInput.fill('32');
  await strengthInput.press('Enter');
  await waitForSaveCount(page, baselineSaves + 2);
  await waitForApplyCount(page, baselineApplies + 2);
  await waitForRenderedDeblur(page, { enabled: true, sigmaPx: 0.8, strength: 32 });

  await page.getByTestId('detail-control-deblur-sigma-value').click();
  const sigmaInput = page.getByTestId('detail-control-deblur-sigma-input');
  await sigmaInput.fill('1.1');
  await sigmaInput.press('Enter');
  await waitForSaveCount(page, baselineSaves + 3);
  await waitForApplyCount(page, baselineApplies + 3);
  await waitForRenderedDeblur(page, { enabled: true, sigmaPx: 1.1, strength: 32 });

  const persisted = persistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (
    persisted.transaction.imageSessionId !== identity.imageSessionId ||
    persisted.transaction.baseAdjustmentRevision !== Number(identity.adjustmentRevision) + 2 ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(
      `Deblur did not persist three sequential source-bound Detail revisions: ${JSON.stringify(persisted)}`,
    );
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Deblur commits did not create Undo boundaries.');
  await undo.click();
  await waitForApplyCount(page, baselineApplies + 4);
  await waitForRenderedDeblur(page, { enabled: true, sigmaPx: 0.8, strength: 32 });

  await undo.click();
  await waitForApplyCount(page, baselineApplies + 5);
  await waitForRenderedDeblur(page, { enabled: true, sigmaPx: 0.8, strength: 0 });

  await undo.click();
  await waitForApplyCount(page, baselineApplies + 6);
  await waitForRenderedDeblur(page, { enabled: false, sigmaPx: 0.8, strength: 0 });
  if (await enabled.isChecked()) throw new Error('Undo did not visibly restore disabled Deblur state.');

  console.log('detail edit transaction browser ok');
} catch (error) {
  console.error('detail edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
