#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;

async function waitForDevServer(): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

async function stopServer(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => {
      server.once('exit', resolve);
    }),
    new Promise((resolve) =>
      setTimeout(() => {
        server.kill('SIGKILL');
        resolve(undefined);
      }, 5_000),
    ),
  ]);
}

const server = spawn('bun', ['run', 'dev', '--', '--host', host], {
  env: { ...process.env, VITE_RAWENGINE_BROWSER_TAURI_HARNESS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const captureServerOutput = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', captureServerOutput);
server.stderr.on('data', captureServerOutput);

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

try {
  await waitForDevServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  await page.addInitScript(() => window.localStorage.clear());
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        html_url: 'https://github.com/CyberTimon/RapidRAW/releases/latest',
        tag_name: 'v0.0.0-browser-harness',
      },
      status: 200,
    });
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('settings-panel').waitFor({ timeout: 10_000 });
  await page.getByTestId('settings-category-processing').click();
  const workerThreads = page.getByRole('slider', { name: 'Threads' });
  await workerThreads.evaluate((input: HTMLInputElement) => {
    input.value = '8';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Save & Relaunch' }).waitFor();
  await page.locator('label[for="switch-enable-live-previews"]').click();
  await page.waitForFunction(() =>
    (window.__RAWENGINE_BROWSER_TAURI_HARNESS__ ?? { calls: [] }).calls.some(
      (call) =>
        call.command === 'save_settings' &&
        call.args?.settings !== null &&
        typeof call.args?.settings === 'object' &&
        'enableLivePreviews' in call.args.settings &&
        call.args.settings.enableLivePreviews === false,
    ),
  );
  if ((await workerThreads.inputValue()) !== '8') {
    throw new Error('An immediate settings save erased the restart-required worker thread draft.');
  }
  await page.locator('[data-tooltip="Go to Home"]').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('settings-category-processing').click();
  if ((await page.getByRole('slider', { name: 'Threads' }).inputValue()) !== '4') {
    throw new Error('Leaving and reopening Settings did not explicitly discard the restart draft.');
  }
  if (await page.getByRole('button', { name: 'Save & Relaunch' }).isVisible()) {
    throw new Error('A discarded restart draft remained dirty after reopening Settings.');
  }

  await page.getByRole('slider', { name: 'Threads' }).evaluate((input: HTMLInputElement) => {
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'AI Connector' }).click();
  const connectorAddress = page.locator('#ai-connector-address');
  await connectorAddress.fill('127.0.0.1:9191');
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await page.waitForFunction(() =>
    (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).some(
      (call) => call.command === 'test_ai_connector_connection' && call.args?.address === '127.0.0.1:9191',
    ),
  );
  if ((await page.getByRole('slider', { name: 'Threads' }).inputValue()) !== '7') {
    throw new Error('Saving/testing the connector erased the restart-required draft.');
  }
  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__) {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.failNextSettingsSave = true;
    }
  });
  await page.getByRole('button', { name: 'Save & Relaunch' }).click();
  await page.waitForTimeout(100);
  let restartCalls = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter((call) => call.command === 'plugin:process|restart')
        .length ?? 0,
  );
  if (restartCalls !== 0) throw new Error('Settings relaunched after a failed save.');
  await page.getByRole('button', { name: 'Save & Relaunch' }).click();
  await page.waitForFunction(
    () =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).filter(
        (call) => call.command === 'plugin:process|restart',
      ).length === 1,
  );
  restartCalls = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter((call) => call.command === 'plugin:process|restart')
        .length ?? 0,
  );
  if (restartCalls !== 1) throw new Error('Settings did not relaunch exactly once after a successful save.');
  const restartPayload = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const restartIndex = calls.findIndex((call) => call.command === 'plugin:process|restart');
    return calls
      .slice(0, restartIndex)
      .filter((call) => call.command === 'save_settings')
      .at(-1)?.args?.settings;
  });
  if (
    restartPayload === null ||
    typeof restartPayload !== 'object' ||
    !('thumbnailWorkerThreads' in restartPayload) ||
    restartPayload.thumbnailWorkerThreads !== 7 ||
    !('enableLivePreviews' in restartPayload) ||
    restartPayload.enableLivePreviews !== false ||
    !('aiConnectorAddress' in restartPayload) ||
    restartPayload.aiConnectorAddress !== '127.0.0.1:9191'
  ) {
    throw new Error('Save & Relaunch did not persist one complete current-settings-plus-draft snapshot.');
  }
  const savedSettings = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return calls
      .filter((call) => call.command === 'save_settings')
      .map((call) => call.args?.settings)
      .at(-1);
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('settings-category-processing').click();
  const reloadProof = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const loaded = calls.filter((call) => call.command === 'load_settings').map((call) => call.args).length;
    return { loaded };
  });
  const livePreviewCheckedAfterReload = await page.getByLabel('Enable live previews').isChecked();

  if (reloadProof.loaded < 1) {
    throw new Error('Settings UI did not load settings through the Tauri boundary.');
  }
  if (
    savedSettings === null ||
    typeof savedSettings !== 'object' ||
    !('enableLivePreviews' in savedSettings) ||
    savedSettings.enableLivePreviews !== false
  ) {
    throw new Error('Settings UI did not persist the live preview preference through save_settings.');
  }
  if (livePreviewCheckedAfterReload) {
    throw new Error('Settings UI did not reload the saved live preview preference.');
  }

  console.log('settings UI ok');
} catch (error) {
  console.error('settings UI failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}
