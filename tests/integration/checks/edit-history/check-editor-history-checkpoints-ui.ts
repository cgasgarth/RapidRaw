#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;

async function waitForDevServer(server: ReturnType<typeof spawn>): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited before ${baseUrl} became available.`);
    }
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

async function setSlider(page: Page, label: string, value: string): Promise<void> {
  await page.getByRole('slider', { exact: true, name: label }).evaluate((input: HTMLInputElement, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
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
  await waitForDevServer(server);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 820, width: 1360 } });
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
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByRole('complementary', { name: 'Editor tools' }).waitFor({ timeout: 10_000 });
  await page.getByRole('slider', { exact: true, name: 'Brightness' }).waitFor({ timeout: 10_000 });
  await page.getByRole('slider', { exact: true, name: 'Contrast' }).waitFor({ timeout: 10_000 });

  await setSlider(page, 'Brightness', '0.35');
  await page.waitForFunction(() => document.body.textContent?.includes('2/2') === true, null, { timeout: 10_000 });
  await page.getByTestId('editor-history-depth-control').click();
  await page.getByTestId('editor-history-add-checkpoint').click();
  await page.getByRole('button', { name: 'Rename checkpoint' }).click();
  await page.getByTestId('editor-history-checkpoint-label-input').fill('Brightened base');
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { exact: true, name: 'Brightened base' }).waitFor({ timeout: 10_000 });
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await setSlider(page, 'Contrast', '18');
  await page.waitForFunction(() => document.body.textContent?.includes('3/3') === true, null, { timeout: 10_000 });
  await page.getByTestId('editor-history-depth-control').click();
  await page.getByRole('menuitem', { exact: true, name: 'Contrast' }).waitFor({ timeout: 10_000 });
  await page.getByRole('menuitem', { name: /Brightened base/u }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('2/3') === true, null, { timeout: 10_000 });

  const redoButton = page.getByRole('button', { name: /Redo/u }).first();
  if (!(await redoButton.isEnabled())) {
    throw new Error('Redo was not available after selecting an earlier checkpoint.');
  }

  await page.getByTestId('editor-history-depth-control').click();
  const activeCheckpoint = page.getByTestId('editor-history-active-checkpoint');
  await activeCheckpoint.waitFor({ timeout: 10_000 });
  const activeText = await activeCheckpoint.innerText();
  if (!activeText.includes('Brightened base')) {
    throw new Error(`Active checkpoint row did not show renamed label: ${activeText}`);
  }

  const harnessProof = await page.evaluate(() => ({
    adjustmentCalls:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter((call) => call.command === 'apply_adjustments').length ??
      0,
    enabled: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.enabled === true,
  }));
  if (!harnessProof.enabled || harnessProof.adjustmentCalls < 2) {
    throw new Error('Browser harness did not apply two visible editor adjustments.');
  }

  console.log('editor history checkpoints UI ok');
} catch (error) {
  console.error('editor history checkpoints UI failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}
