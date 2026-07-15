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
      .object({
        colorGrading: z.object({ balance: z.number() }).passthrough(),
        perceptualGradingV1: z.object({ balance: z.number() }).passthrough(),
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
const renderCallSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z
            .object({
              nodes: z
                .object({
                  perceptual_grading: z
                    .object({
                      params: z
                        .object({
                          colorGrading: z.object({ balance: z.number() }).passthrough(),
                          perceptualGradingV1: z.object({ balance: z.number() }).passthrough(),
                        })
                        .strict(),
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

const commandCount = async (page: Page, command: string) =>
  page.evaluate(
    ({ commandName }) =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === commandName).length ?? 0,
    { commandName: command },
  );

const waitForCommandCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await commandCount(page, command)) >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Timed out waiting for ${String(expected)} ${command} calls; observed ${String(await commandCount(page, command))}.`,
  );
};

const waitForRenderedPerceptualGrading = async (page: Page, expectedBalance: number) => {
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
      call.data.args.request.editDocumentV2.nodes.perceptual_grading.params.colorGrading.balance === expectedBalance
    )
      return call.data;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered Perceptual Grading balance=${String(expectedBalance)}.`);
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
  const adjustmentsPanelButton = page.getByTestId('right-panel-switcher-button-adjustments');
  if ((await adjustmentsPanelButton.getAttribute('aria-pressed')) !== 'true') await adjustmentsPanelButton.click();
  await page.getByTestId('adjustments-inspector').waitFor({ timeout: 10_000 });

  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByTestId('color-workspace-tab-grading').click();
  const controls = page.getByTestId('color-grading-controls');
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
    throw new Error(`Perceptual Grading controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }

  const presetTrigger = controls.locator('button[aria-haspopup="listbox"]');
  await presetTrigger.scrollIntoViewIfNeeded();
  const baselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const baselineApplies = await commandCount(page, 'apply_adjustments');
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push({ color: [40, 180, 96], delayMs: 20 });
  });
  await presetTrigger.click();
  await page.getByTestId('color-grading-preset-card').first().click();
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 1);
  if (Number(await page.getByTestId('color-grading-balance-range').inputValue()) !== 8) {
    throw new Error('Perceptual Grading preset balance was not visibly applied.');
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
    persisted.adjustments.colorGrading.balance !== 8 ||
    persisted.adjustments.perceptualGradingV1.balance !== 0.08 ||
    persisted.transaction.imageSessionId !== identity.imageSessionId ||
    persisted.transaction.baseAdjustmentRevision !== Number(identity.adjustmentRevision) ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Perceptual Grading did not persist one source-bound node revision: ${JSON.stringify(persisted)}`);
  }
  const rendered = await waitForRenderedPerceptualGrading(page, 8);
  if (Object.hasOwn(rendered.args.request, 'jsAdjustments')) {
    throw new Error('Perceptual Grading render escaped node authority through jsAdjustments.');
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Perceptual Grading commit did not create an undo boundary.');
  await undo.click();
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="color-grading-balance-range"]') as HTMLInputElement | null)?.value === '0',
    undefined,
    { timeout: 10_000 },
  );
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 2);
  await waitForRenderedPerceptualGrading(page, 0);

  console.log('perceptual grading edit transaction browser ok');
} catch (error) {
  console.error('perceptual grading edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
