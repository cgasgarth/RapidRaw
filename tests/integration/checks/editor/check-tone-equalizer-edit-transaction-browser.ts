#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';
import { z } from 'zod';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const sourcePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const successorPath = '/tmp/rawengine-browser-harness/browser-harness-2.ARW';
const toneEqualizerSchema = z
  .object({
    autoPlacement: z.boolean(),
    enabled: z.boolean(),
    pivotEv: z.number(),
    rangeEv: z.number(),
  })
  .passthrough();
const persistenceSchema = z
  .object({
    adjustments: z.object({ toneEqualizer: toneEqualizerSchema }).passthrough(),
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
                  tone_equalizer: z
                    .object({
                      params: z.object({ toneEqualizer: toneEqualizerSchema }).strict(),
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

const waitForCompletedCommand = async (page: Page, command: string, index: number) => {
  await page.waitForFunction(
    ({ commandName, targetIndex }) => {
      const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === commandName)[
        targetIndex
      ];
      return typeof call?.endedAtMs === 'number';
    },
    { commandName: command, targetIndex: index },
    { timeout: 10_000 },
  );
};

const waitForSelectedSource = async (page: Page, source: string) => {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === expected,
    source,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
    undefined,
    { timeout: 10_000 },
  );
};

const queueTonePlacement = async (
  page: Page,
  response: { delayMs: number; pivotEv: number; rangeEv: number; sourceIdentity?: string },
) => {
  await page.evaluate(({ delayMs, pivotEv, rangeEv, sourceIdentity }) => {
    const source = sourceIdentity ?? '/tmp/rawengine-browser-harness/browser-harness.ARW';
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.tonePlacementResponses.push({
      delayMs,
      value: {
        confidence: 0.91,
        histogram: Array.from({ length: 32 }, (_, index) => index + 1),
        pivotEv,
        rangeEv,
        sceneBlackEv: pivotEv - rangeEv / 2,
        sceneWhiteEv: pivotEv + rangeEv / 2,
        sourceFingerprint: '0123456789abcdef',
        sourceIdentity: source,
      },
    });
  }, response);
};

const countTonePlacementTransactions = async (page: Page, pivotEv: number, rangeEv: number) =>
  page.evaluate(
    ({ expectedPivot, expectedRange, expectedSource }) =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ args, command }) => {
        if (command !== 'save_metadata_and_update_thumbnail') return false;
        const payload = args as
          | {
              adjustments?: { toneEqualizer?: { autoPlacement?: boolean; pivotEv?: number; rangeEv?: number } };
              path?: string;
              transaction?: unknown;
            }
          | undefined;
        return (
          payload?.path === expectedSource &&
          payload.transaction !== undefined &&
          payload.adjustments?.toneEqualizer?.autoPlacement === true &&
          payload.adjustments.toneEqualizer.pivotEv === expectedPivot &&
          payload.adjustments.toneEqualizer.rangeEv === expectedRange
        );
      }).length ?? 0,
    { expectedPivot: pivotEv, expectedRange: rangeEv, expectedSource: sourcePath },
  );

const waitForRenderedToneEqualizer = async (
  page: Page,
  expected: { autoPlacement: boolean; enabled: boolean; pivotEv: number; rangeEv: number },
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
    if (
      call.success &&
      call.data.endedAtMs !== null &&
      Object.entries(expected).every(
        ([key, value]) =>
          call.data.args.request.editDocumentV2.nodes.tone_equalizer.params.toneEqualizer[
            key as keyof typeof expected
          ] === value,
      )
    )
      return call.data;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for rendered Tone Equalizer ${JSON.stringify(expected)}.`);
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

  const controls = page.getByTestId('basic-light-controls');
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
    throw new Error(`Basic controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }

  const enable = page.getByTestId('tone-equalizer-enable');
  await enable.scrollIntoViewIfNeeded();
  const baselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const baselineApplies = await commandCount(page, 'apply_adjustments');
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push({ color: [40, 180, 96], delayMs: 20 });
  });
  await enable.click();
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 1);
  if ((await enable.textContent())?.trim() !== 'On') throw new Error('Tone Equalizer was not visibly enabled.');

  const persisted = persistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (
    !persisted.adjustments.toneEqualizer.enabled ||
    persisted.transaction.imageSessionId !== identity.imageSessionId ||
    persisted.transaction.baseAdjustmentRevision !== Number(identity.adjustmentRevision) ||
    persisted.transaction.nextAdjustmentRevision !== persisted.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Tone Equalizer did not persist one source-bound node revision: ${JSON.stringify(persisted)}`);
  }
  const rendered = await waitForRenderedToneEqualizer(page, {
    autoPlacement: false,
    enabled: true,
    pivotEv: 0,
    rangeEv: 16,
  });
  if (Object.hasOwn(rendered.args.request, 'jsAdjustments')) {
    throw new Error('Tone Equalizer render escaped node authority through jsAdjustments.');
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Tone Equalizer commit did not create an undo boundary.');
  await undo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tone-equalizer-enable"]')?.textContent?.trim() === 'Enable',
    undefined,
    { timeout: 10_000 },
  );
  await waitForCommandCount(page, 'apply_adjustments', baselineApplies + 2);
  await waitForRenderedToneEqualizer(page, {
    autoPlacement: false,
    enabled: false,
    pivotEv: 0,
    rangeEv: 16,
  });

  const ensureAdvancedOpen = async () => {
    if ((await page.getByTestId('tone-equalizer-advanced').count()) === 0) {
      await page.getByTestId('tone-equalizer-advanced-toggle').click();
    }
    await page.getByTestId('tone-equalizer-advanced').waitFor({ timeout: 10_000 });
  };
  await ensureAdvancedOpen();

  const sourceAutoCalls = await commandCount(page, 'analyze_tone_equalizer_placement');
  const sourceTransactions = await countTonePlacementTransactions(page, -2, 10);
  await queueTonePlacement(page, { delayMs: 500, pivotEv: -2, rangeEv: 10 });
  await page.getByTestId('tone-equalizer-auto-place').click();
  await waitForCommandCount(page, 'analyze_tone_equalizer_placement', sourceAutoCalls + 1);
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${successorPath}"]`).click();
  await waitForSelectedSource(page, successorPath);
  await waitForCompletedCommand(page, 'analyze_tone_equalizer_placement', sourceAutoCalls);
  await page.waitForTimeout(100);
  if ((await countTonePlacementTransactions(page, -2, 10)) !== sourceTransactions) {
    throw new Error('A delayed tone placement persisted into a successor source.');
  }

  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${sourcePath}"]`).click();
  await waitForSelectedSource(page, sourcePath);
  await ensureAdvancedOpen();
  const sessionAutoCalls = await commandCount(page, 'analyze_tone_equalizer_placement');
  const sessionTransactions = await countTonePlacementTransactions(page, -1.5, 11);
  await queueTonePlacement(page, { delayMs: 800, pivotEv: -1.5, rangeEv: 11 });
  await page.getByTestId('tone-equalizer-auto-place').click();
  await waitForCommandCount(page, 'analyze_tone_equalizer_placement', sessionAutoCalls + 1);
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${successorPath}"]`).click();
  await waitForSelectedSource(page, successorPath);
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${sourcePath}"]`).click();
  await waitForSelectedSource(page, sourcePath);
  await waitForCompletedCommand(page, 'analyze_tone_equalizer_placement', sessionAutoCalls);
  await page.waitForTimeout(100);
  if ((await countTonePlacementTransactions(page, -1.5, 11)) !== sessionTransactions) {
    throw new Error('A delayed tone placement persisted into a same-source successor session.');
  }

  await ensureAdvancedOpen();
  const latestBaselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const latestBaselineApplies = await commandCount(page, 'apply_adjustments');
  const latestAutoCalls = await commandCount(page, 'analyze_tone_equalizer_placement');
  const slowTransactions = await countTonePlacementTransactions(page, 1, 8);
  const fastTransactions = await countTonePlacementTransactions(page, 2, 12);
  await queueTonePlacement(page, { delayMs: 600, pivotEv: 1, rangeEv: 8 });
  await queueTonePlacement(page, { delayMs: 20, pivotEv: 2, rangeEv: 12 });
  await page.getByTestId('tone-equalizer-auto-place').click();
  await page.getByTestId('tone-equalizer-auto-place').click();
  await waitForCompletedCommand(page, 'analyze_tone_equalizer_placement', latestAutoCalls + 1);
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', latestBaselineSaves + 1);
  await waitForCommandCount(page, 'apply_adjustments', latestBaselineApplies + 1);
  await waitForRenderedToneEqualizer(page, { autoPlacement: true, enabled: true, pivotEv: 2, rangeEv: 12 });
  await waitForCompletedCommand(page, 'analyze_tone_equalizer_placement', latestAutoCalls);
  await page.waitForTimeout(100);
  if (
    (await commandCount(page, 'save_metadata_and_update_thumbnail')) !== latestBaselineSaves + 1 ||
    (await countTonePlacementTransactions(page, 1, 8)) !== slowTransactions ||
    (await countTonePlacementTransactions(page, 2, 12)) !== fastTransactions + 1
  ) {
    throw new Error('Tone placement latest-intent authority did not preserve only the fast successor result.');
  }
  const placementPersistence = persistenceSchema.parse(
    await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1)?.args ?? null,
    ),
  );
  if (
    placementPersistence.adjustments.toneEqualizer.pivotEv !== 2 ||
    placementPersistence.adjustments.toneEqualizer.rangeEv !== 12 ||
    placementPersistence.transaction.nextAdjustmentRevision !==
      placementPersistence.transaction.baseAdjustmentRevision + 1
  ) {
    throw new Error(`Tone placement did not persist one exact node revision: ${JSON.stringify(placementPersistence)}`);
  }

  await undo.click();
  await waitForCommandCount(page, 'apply_adjustments', latestBaselineApplies + 2);
  await waitForRenderedToneEqualizer(page, {
    autoPlacement: false,
    enabled: false,
    pivotEv: 0,
    rangeEv: 16,
  });

  await ensureAdvancedOpen();
  const manualBaselineSaves = await commandCount(page, 'save_metadata_and_update_thumbnail');
  const manualBaselineApplies = await commandCount(page, 'apply_adjustments');
  const manualAutoCalls = await commandCount(page, 'analyze_tone_equalizer_placement');
  const rejectedManualTransactions = await countTonePlacementTransactions(page, 3, 9);
  await queueTonePlacement(page, { delayMs: 500, pivotEv: 3, rangeEv: 9 });
  await page.getByTestId('tone-equalizer-auto-place').click();
  await enable.click();
  await waitForCommandCount(page, 'save_metadata_and_update_thumbnail', manualBaselineSaves + 1);
  await waitForCommandCount(page, 'apply_adjustments', manualBaselineApplies + 1);
  await waitForRenderedToneEqualizer(page, {
    autoPlacement: false,
    enabled: true,
    pivotEv: 0,
    rangeEv: 16,
  });
  await waitForCompletedCommand(page, 'analyze_tone_equalizer_placement', manualAutoCalls);
  await page.waitForTimeout(100);
  if (
    (await commandCount(page, 'save_metadata_and_update_thumbnail')) !== manualBaselineSaves + 1 ||
    (await countTonePlacementTransactions(page, 3, 9)) !== rejectedManualTransactions
  ) {
    throw new Error('A delayed tone placement replaced a newer manual Tone Equalizer edit.');
  }

  console.log('tone equalizer edit transaction browser ok');
} catch (error) {
  console.error('tone equalizer edit transaction browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
