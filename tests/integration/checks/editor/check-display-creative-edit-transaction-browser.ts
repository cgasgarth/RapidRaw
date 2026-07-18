#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const displayCreativeParamsSchema = z
  .object({
    grainAmount: z.number(),
    grainRoughness: z.number(),
    grainSize: z.number(),
    halationAmount: z.number(),
    vignetteAmount: z.number(),
    vignetteMidpoint: z.number(),
  })
  .passthrough();
const displayCreativeNodeSchema = z.object({ enabled: z.boolean(), params: displayCreativeParamsSchema }).passthrough();
const persistenceSchema = z
  .object({
    editDocumentV2: z
      .object({
        nodes: z.object({ display_creative: displayCreativeNodeSchema }).passthrough(),
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
const vignettePersistenceSchema = z
  .object({
    editDocumentV2: z
      .object({
        nodes: z
          .object({
            display_creative: displayCreativeNodeSchema.extend({
              params: displayCreativeParamsSchema.extend({
                vignetteAmount: z.literal(-32),
                vignetteMidpoint: z.literal(63),
              }),
            }),
          })
          .passthrough(),
      })
      .passthrough(),
    path: z.literal(sourcePath),
    transaction: persistenceSchema.shape.transaction,
  })
  .passthrough();
const halationPersistenceSchema = z
  .object({
    editDocumentV2: z
      .object({
        nodes: z
          .object({
            display_creative: displayCreativeNodeSchema.extend({
              params: displayCreativeParamsSchema.extend({ halationAmount: z.literal(24) }),
            }),
          })
          .passthrough(),
      })
      .passthrough(),
    path: z.literal(sourcePath),
    transaction: persistenceSchema.shape.transaction,
  })
  .passthrough();
const effectsEnablementPersistenceSchema = z
  .object({
    editDocumentV2: z
      .object({
        nodes: z
          .object({
            display_creative: displayCreativeNodeSchema.extend({
              params: displayCreativeParamsSchema.extend({
                vignetteAmount: z.literal(-32),
                vignetteMidpoint: z.literal(63),
              }),
            }),
          })
          .passthrough(),
      })
      .passthrough(),
    path: z.literal(sourcePath),
    transaction: persistenceSchema.shape.transaction,
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
                  display_creative: z
                    .object({
                      enabled: z.boolean(),
                      params: z
                        .object({
                          grainAmount: z.number(),
                          grainRoughness: z.number(),
                          grainSize: z.number(),
                          halationAmount: z.number(),
                          vignetteAmount: z.number(),
                          vignetteMidpoint: z.number(),
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

const waitForRenderedVignette = async (page: Page, expectedAmount: number, expectedMidpoint: number) => {
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
      call.data.args.request.editDocumentV2.nodes.display_creative.params['vignetteAmount'] === expectedAmount &&
      call.data.args.request.editDocumentV2.nodes.display_creative.params['vignetteMidpoint'] === expectedMidpoint
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Timed out waiting for rendered Vignette Amount ${String(expectedAmount)} and Midpoint ${String(expectedMidpoint)}.`,
  );
};

const waitForRenderedFilmEffects = async (
  page: Page,
  expected: { grainAmount: number; grainRoughness: number; grainSize: number; halationAmount: number },
) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const call = renderCallSchema.safeParse(
      await page.evaluate(() =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'apply_adjustments')
          .at(-1),
      ),
    );
    const params = call.success ? call.data.args.request.editDocumentV2.nodes.display_creative.params : null;
    if (
      call.success &&
      call.data.endedAtMs !== null &&
      params?.grainAmount === expected.grainAmount &&
      params.grainRoughness === expected.grainRoughness &&
      params.grainSize === expected.grainSize &&
      params.halationAmount === expected.halationAmount
    )
      return;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered film effects ${JSON.stringify(expected)}.`);
};

const waitForRenderedEffectsEnabled = async (page: Page, enabled: boolean) => {
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
      call.data.args.request.editDocumentV2.nodes.display_creative.enabled === enabled
    )
      return call.data.args.request.editDocumentV2.nodes.display_creative;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered Effects enabled=${String(enabled)}.`);
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

  const effectsSection = page.getByTestId('adjustments-section-effects');
  const disclosure = effectsSection.locator('button[aria-expanded]').first();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const controls = page.getByTestId('effects-controls');
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
    throw new Error(`Effects controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }

  const baselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const baselineApplies = await commandCount(page, 'apply_adjustments');
  await disclosure.click();
  await page.waitForTimeout(250);
  if (
    (await disclosure.getAttribute('aria-expanded')) !== 'false' ||
    (await commandCount(page, 'save_metadata_and_update_thumbnail')) !== baselineSaves ||
    (await commandCount(page, 'apply_adjustments')) !== baselineApplies
  ) {
    throw new Error('Collapsing Effects caused an edit, persistence write, or render.');
  }
  await disclosure.click();
  await controls.waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push(
      { color: [24, 200, 80], delayMs: 20 },
      { color: [60, 120, 220], delayMs: 20 },
      { color: [220, 130, 60], delayMs: 20 },
      { color: [180, 80, 200], delayMs: 20 },
      { color: [80, 180, 160], delayMs: 20 },
      { color: [160, 180, 80], delayMs: 20 },
    );
  });
  await page.getByTestId('effects-control-vignette-amount-value').click();
  const input = page.getByTestId('effects-control-vignette-amount-input');
  await input.fill('-32');
  await input.press('Enter');
  await page.getByTestId('effects-control-vignette-amount-value').waitFor({ state: 'visible', timeout: 10_000 });
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 1);
  if ((await page.getByTestId('effects-control-vignette-amount-value').textContent())?.trim() !== '-32') {
    throw new Error('Vignette Amount was not visibly committed.');
  }
  await waitForRenderedVignette(page, -32, 50);

  await page.getByTestId('effects-control-vignette-midpoint-value').click();
  const midpointInput = page.getByTestId('effects-control-vignette-midpoint-input');
  await midpointInput.fill('63');
  await midpointInput.press('Enter');
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 2);
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 2);
  if ((await page.getByTestId('effects-control-vignette-midpoint-value').textContent())?.trim() !== '63') {
    throw new Error('Vignette Midpoint was not visibly committed.');
  }

  const persisted = vignettePersistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (
    persisted.transaction.imageSessionId !== identity.imageSessionId ||
    persisted.transaction.baseAdjustmentRevision !== Number(identity.adjustmentRevision) + 1 ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(
      `Vignette controls did not persist sequential source-bound revisions: ${JSON.stringify(persisted)}`,
    );
  }
  await waitForRenderedVignette(page, -32, 63);

  await page.getByTestId('effects-advanced-toggle').click();
  await page.getByTestId('effects-control-halation-amount-value').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('effects-control-halation-amount-value').click();
  const halationInput = page.getByTestId('effects-control-halation-amount-input');
  await halationInput.fill('24');
  await halationInput.press('Enter');
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 3);
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 3);
  await waitForRenderedFilmEffects(page, {
    grainAmount: 0,
    grainRoughness: 50,
    grainSize: 25,
    halationAmount: 24,
  });

  await page.getByTestId('film-grain-preset-film_grain.ui_preset.iso_400_classic.v1').click();
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 4);
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 4);
  await waitForRenderedFilmEffects(page, {
    grainAmount: 28,
    grainRoughness: 50,
    grainSize: 34,
    halationAmount: 24,
  });

  const saveCalls = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ) ?? [],
  );
  const halationSave = halationPersistenceSchema.parse(saveCalls.at(-2)?.args);
  const grainSave = persistenceSchema.parse(saveCalls.at(-1)?.args);
  if (
    halationSave.editDocumentV2.nodes.display_creative.params.halationAmount !== 24 ||
    halationSave.transaction.nextAdjustmentRevision !== grainSave.transaction.baseAdjustmentRevision ||
    grainSave.transaction.nextAdjustmentRevision !== grainSave.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(
      `Film effects did not persist sequential current revisions: ${JSON.stringify({ grainSave, halationSave })}`,
    );
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Film effects commits did not create undo boundaries.');
  await undo.click();
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 5);
  await waitForRenderedFilmEffects(page, {
    grainAmount: 0,
    grainRoughness: 50,
    grainSize: 25,
    halationAmount: 24,
  });

  await undo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="effects-control-halation-amount-value"]')?.textContent?.trim() === '0',
    undefined,
    { timeout: 10_000 },
  );
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 6);
  await waitForRenderedFilmEffects(page, {
    grainAmount: 0,
    grainRoughness: 50,
    grainSize: 25,
    halationAmount: 0,
  });
  const summary = page.getByTestId('effects-active-summary');
  if (
    (await summary.getAttribute('data-active-effect-count')) !== '1' ||
    (await summary.textContent())?.includes('Halation') === true
  ) {
    throw new Error('Undo of manual Halation did not restore the prior active-effects summary.');
  }
  await page.getByTestId('effects-advanced-toggle').click();
  await page.getByTestId('effects-advanced').waitFor({ state: 'hidden', timeout: 10_000 });

  const enablementBaselineApplies = await commandCount(page, 'apply_adjustments');
  const enablementBaselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const previewLayer = page.getByTestId('svg-preview-base-layer').last();
  const enabledPreviewUrl = await previewLayer.getAttribute('href');
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push(
      { color: [210, 60, 120], delayMs: 20 },
      { color: [60, 210, 120], delayMs: 20 },
      { color: [120, 60, 210], delayMs: 20 },
      { color: [210, 120, 60], delayMs: 20 },
    );
  });
  const effectsEnableToggle = page.getByTestId('effects-enable-toggle');
  // The right inspector animates its content height as advanced controls collapse;
  // force the semantic toggle click through that transient overlay.
  await effectsEnableToggle.click({ force: true });
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', enablementBaselineSaves + 1);
  await waitForCommandCount(page, 'apply_adjustments', enablementBaselineApplies + 1);
  await page.waitForTimeout(200);
  if (
    (await commandCount(page, 'save_metadata_and_update_thumbnail')) !== enablementBaselineSaves + 1 ||
    (await commandCount(page, 'apply_adjustments')) !== enablementBaselineApplies + 1
  ) {
    throw new Error('Disabling Effects did not produce exactly one edit transaction.');
  }
  const disabledNode = await waitForRenderedEffectsEnabled(page, false);
  if (disabledNode.params['vignetteAmount'] !== -32 || disabledNode.params['vignetteMidpoint'] !== 63) {
    throw new Error(`Disabling Effects lost latent parameters: ${JSON.stringify(disabledNode.params)}`);
  }
  const disabledPreviewUrl = await page.getByTestId('svg-preview-base-layer').last().getAttribute('href');
  if (enabledPreviewUrl === null || disabledPreviewUrl === null || disabledPreviewUrl === enabledPreviewUrl) {
    throw new Error('Disabling Effects did not replace the visible preview output.');
  }
  const disabledPersistence = effectsEnablementPersistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args,
    ),
  );
  if (
    disabledPersistence.editDocumentV2.nodes.display_creative.enabled !== false ||
    disabledPersistence.editDocumentV2.nodes.display_creative.params.vignetteAmount !== -32
  ) {
    throw new Error(
      `Effects disablement was not persisted with latent parameters: ${JSON.stringify(disabledPersistence)}`,
    );
  }

  await effectsEnableToggle.click({ force: true });
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', enablementBaselineSaves + 2);
  await waitForCommandCount(page, 'apply_adjustments', enablementBaselineApplies + 2);
  const reenabledNode = await waitForRenderedEffectsEnabled(page, true);
  if (reenabledNode.params['vignetteAmount'] !== -32 || reenabledNode.params['vignetteMidpoint'] !== 63) {
    throw new Error(`Re-enabling Effects did not restore latent parameters: ${JSON.stringify(reenabledNode.params)}`);
  }

  await undo.click();
  await waitForCommandCount(page, 'apply_adjustments', enablementBaselineApplies + 3);
  await waitForRenderedEffectsEnabled(page, false);
  if ((await effectsEnableToggle.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('Undo did not restore disabled Effects UI state.');
  }

  const redoBaselineApplies = await commandCount(page, 'apply_adjustments');
  const redoBaselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const undoPreviewUrl = await page.getByTestId('svg-preview-base-layer').last().getAttribute('href');
  const redo = page.locator('button[data-command-id="redo"]:visible').first();
  if (!(await redo.isEnabled())) throw new Error('Effects enablement Undo did not create a Redo boundary.');
  await redo.click();
  await waitForCommandCount(page, 'apply_adjustments', redoBaselineApplies + 1);
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', redoBaselineSaves + 1);
  await page.waitForTimeout(200);
  if (
    (await commandCount(page, 'apply_adjustments')) !== redoBaselineApplies + 1 ||
    (await commandCount(page, 'save_metadata_and_update_thumbnail')) !== redoBaselineSaves + 1
  ) {
    throw new Error('Redoing Effects enablement did not produce exactly one render and persistence transaction.');
  }
  const redoneNode = await waitForRenderedEffectsEnabled(page, true);
  if (
    redoneNode.params['vignetteAmount'] !== -32 ||
    redoneNode.params['vignetteMidpoint'] !== 63 ||
    (await effectsEnableToggle.getAttribute('aria-pressed')) !== 'true'
  ) {
    throw new Error(`Redo did not restore enabled Effects with latent parameters: ${JSON.stringify(redoneNode)}`);
  }
  const redoPreviewUrl = await page.getByTestId('svg-preview-base-layer').last().getAttribute('href');
  if (undoPreviewUrl === null || redoPreviewUrl === null || redoPreviewUrl === undoPreviewUrl) {
    throw new Error('Redoing Effects enablement did not restore a new visible preview output.');
  }

  console.log('display creative edit transaction browser ok');
} catch (error) {
  console.error('display creative edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
