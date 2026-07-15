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
    adjustments: z.object({ lensVignetteAmount: z.literal(135) }).passthrough(),
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
  args: z.object({
    request: z.object({
      editDocumentV2: z.object({
        extensions: z.object({ legacyAdjustments: z.record(z.string(), z.unknown()) }).passthrough(),
        nodes: z
          .object({
            lens_correction: z.object({ params: z.object({ lensVignetteAmount: z.number() }).passthrough() }),
          })
          .passthrough(),
      }),
    }),
  }),
  endedAtMs: z.number().nullable(),
});

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: { ...process.env, RAWENGINE_DEV_SERVER_PORT: String(port), VITE_RAWENGINE_BROWSER_TAURI_HARNESS: '1' },
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
    new Promise<void>((resolve) => server.once('exit', () => resolve())),
    Bun.sleep(5_000).then(() => server.kill('SIGKILL')),
  ]);
};

const commandCount = async (page: Page, command: string) =>
  page.evaluate(
    (expectedCommand) =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === expectedCommand).length ??
      0,
    command,
  );

const waitForCommandCount = async (page: Page, command: string, expected: number) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await commandCount(page, command)) >= expected) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${String(expected)} ${command} calls.`);
};

const waitForRenderedLensAmount = async (page: Page, expected: number) => {
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
      call.data.args.request.editDocumentV2.nodes.lens_correction.params.lensVignetteAmount === expected
    ) {
      if ('lensVignetteAmount' in call.data.args.request.editDocumentV2.extensions.legacyAdjustments) {
        throw new Error('Lens amount leaked back into quarantined legacy adjustments.');
      }
      return;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered lens vignette amount ${String(expected)}.`);
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
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
      lensCorrectionMode: 'manual',
      lensDistortionParams: {
        k1: 0.1,
        k2: 0,
        k3: 0,
        model: 1,
        tca_vb: 0.99,
        tca_vr: 1.01,
        vig_k1: 0.2,
        vig_k2: 0,
        vig_k3: 0,
      },
      lensMaker: 'Harness Optics',
      lensModel: '35mm Prime',
    });
  }, sourcePath);
  await page.getByRole('button', { name: /Open Folder/u }).click();
  const thumbnail = page.getByRole('button', { name: /browser-harness\.ARW/u }).first();
  await thumbnail.waitFor({ timeout: 10_000 });
  await thumbnail.dblclick();
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await provisionalBadge.waitFor({ state: 'visible', timeout: 10_000 });
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  const panelButton = page.getByTestId('right-panel-switcher-button-adjustments');
  if ((await panelButton.getAttribute('aria-pressed')) !== 'true') await panelButton.click();

  const section = page.getByTestId('adjustments-section-transformLens');
  const disclosure = section.locator('button[aria-expanded]').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const controls = page.getByTestId('transform-lens-inspector');
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
    throw new Error(`Lens controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }

  const baselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const baselineApplies = await commandCount(page, 'apply_adjustments');
  await page.getByTestId('lens-control-vignette-amount-value').click();
  const input = page.getByTestId('lens-control-vignette-amount-input');
  await input.fill('135');
  await input.press('Enter');
  await page.getByTestId('lens-control-vignette-amount-value').waitFor({ state: 'visible', timeout: 10_000 });
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 1);
  const committedValue = (await page.getByTestId('lens-control-vignette-amount-value').textContent())?.trim();
  if (committedValue !== '135%') {
    throw new Error(`Persisted lens value is not visible: ${committedValue ?? 'missing'}.`);
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
    persisted.transaction.imageSessionId !== identity.imageSessionId ||
    persisted.transaction.baseAdjustmentRevision !== Number(identity.adjustmentRevision) ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Lens edit did not persist one source-bound revision: ${JSON.stringify(persisted)}`);
  }
  await waitForRenderedLensAmount(page, 135);

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Lens commit did not create an undo boundary.');
  await undo.click();
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 2);
  await waitForRenderedLensAmount(page, 100);
  const restoredValue = (await page.getByTestId('lens-control-vignette-amount-value').textContent())?.trim();
  if (restoredValue !== '100%') {
    throw new Error(`Undo rendered 100 but visible lens value is ${restoredValue ?? 'missing'}.`);
  }
  console.log('lens correction edit transaction browser ok');
} catch (error) {
  console.error('lens correction edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
