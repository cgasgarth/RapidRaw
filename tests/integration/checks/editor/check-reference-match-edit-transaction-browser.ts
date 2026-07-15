#!/usr/bin/env bun

import { spawn } from 'node:child_process';

import { chromium, type Page } from '@playwright/test';

import { allocateFreeTcpPort } from '../../../../scripts/lib/dev-server-port';

const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${String(port)}`;
const referencePath = '/tmp/rawengine-browser-harness/browser-harness.ARW';
const targetPath = '/tmp/rawengine-browser-harness/browser-harness-2.ARW';
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
  await page.waitForFunction(
    ({ commandName, expectedCount }) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === commandName).length ??
        0) >= expectedCount,
    { commandName: command, expectedCount: expected },
    { timeout: 10_000 },
  );
};

const publishHistogram = async (
  page: Page,
  peaks: { blue: number; green: number; luma: number; red: number },
  target?: string,
) => {
  await page.evaluate(
    async ({ imagePath, peakByChannel }) => {
      const module = await import('/src/store/useEditorStore.ts');
      const state = module.useEditorStore.getState();
      const bins = (peak: number) => Array.from({ length: 256 }, (_, index) => (index === peak ? 8_192 : 0));
      const histogram = {
        blue: { color: 'blue', data: bins(peakByChannel.blue) },
        green: { color: 'green', data: bins(peakByChannel.green) },
        luma: { color: 'white', data: bins(peakByChannel.luma) },
        red: { color: 'red', data: bins(peakByChannel.red) },
      };
      if (imagePath === undefined) {
        state.setEditor({ histogram });
        return;
      }
      const current = state.selectedImage;
      if (current === null) throw new Error('Reference Match browser fixture requires an open image.');
      state.setEditor({
        finalPreviewUrl: `blob:${imagePath}:preview`,
        histogram,
        imageSession: module.createEditorImageSession({
          generation: state.imageSessionId + 1,
          path: imagePath,
          source: 'cache',
        }),
        selectedImage: {
          ...current,
          originalUrl: `blob:${imagePath}:original`,
          path: imagePath,
          thumbnailUrl: `blob:${imagePath}:thumbnail`,
        },
      });
    },
    { imagePath: target, peakByChannel: peaks },
  );
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
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  const adjustmentsPanelButton = page.getByTestId('right-panel-switcher-button-adjustments');
  if ((await adjustmentsPanelButton.getAttribute('aria-pressed')) !== 'true') await adjustmentsPanelButton.click();
  await page.getByTestId('reference-match-panel').waitFor({ timeout: 10_000 });

  await publishHistogram(page, { blue: 120, green: 170, luma: 180, red: 200 });
  await page.getByTestId('reference-match-capture').click();
  await page.locator(`[data-reference-path="${referencePath}"]`).waitFor({ timeout: 10_000 });
  await publishHistogram(page, { blue: 120, green: 100, luma: 80, red: 90 }, targetPath);
  await page.getByTestId('reference-match-propose').click();
  await page.getByTestId('reference-match-proposal').waitFor({ timeout: 10_000 });

  const baselineSaves = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const baselineRenders = (await calls(page, 'apply_adjustments')).length;
  await page.getByTestId('reference-match-apply').click();
  await waitForCount(page, 'save_metadata_and_update_thumbnail', baselineSaves + 1);
  await waitForCount(page, 'apply_adjustments', baselineRenders + 1);
  const globalCommit = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return {
      exposure: state.adjustments.exposure,
      historyIndex: state.historyIndex,
      receipt: state.adjustments.referenceMatchApplicationReceipt,
      transactionReceipt: state.lastEditApplicationReceipt,
    };
  });
  if (
    globalCommit.exposure === 0 ||
    globalCommit.historyIndex !== 1 ||
    globalCommit.receipt?.destination !== 'global-adjustments' ||
    globalCommit.transactionReceipt?.source !== 'reference-match' ||
    globalCommit.transactionReceipt.persistence !== 'commit'
  ) {
    throw new Error(`Reference Match global transaction was not authoritative: ${JSON.stringify(globalCommit)}`);
  }
  const save = (await calls(page, 'save_metadata_and_update_thumbnail')).at(-1)?.args as
    | {
        adjustments?: { referenceMatchApplicationReceipt?: { destination?: string } };
        path?: string;
        transaction?: unknown;
      }
    | undefined;
  if (
    save?.path !== targetPath ||
    save.transaction === undefined ||
    save.adjustments?.referenceMatchApplicationReceipt?.destination !== 'global-adjustments'
  ) {
    throw new Error(`Reference Match persistence omitted transaction provenance: ${JSON.stringify(save)}`);
  }

  await page.keyboard.press('Meta+z');
  await page.waitForFunction(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return state.historyIndex === 0 && state.adjustments.referenceMatchApplicationReceipt === null;
  });

  await page.getByTestId('reference-match-normalize').click();
  await page.getByTestId('reference-match-apply-layer').click();
  await page.waitForFunction(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return (
      state.adjustments.masks[0]?.referenceMatchApplicationReceipt?.destination === 'adjustment-layer' &&
      state.lastEditApplicationReceipt?.source === 'reference-match'
    );
  });
  const layerCommit = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return {
      activeLayer: state.activeMaskContainerId,
      historyIndex: state.historyIndex,
      layer: state.adjustments.masks[0],
    };
  });
  if (
    layerCommit.historyIndex !== 1 ||
    layerCommit.activeLayer !== layerCommit.layer?.id ||
    layerCommit.layer.referenceMatchApplicationReceipt?.destination !== 'adjustment-layer'
  ) {
    throw new Error(`Reference Match layer transaction was not authoritative: ${JSON.stringify(layerCommit)}`);
  }

  console.log('reference match edit transaction browser ok');
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  await browser?.close();
  await stopServer();
}
