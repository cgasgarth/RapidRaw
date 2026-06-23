#!/usr/bin/env bun

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

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
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .waitFor({ timeout: 10_000 });
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('heading', { name: 'Adjustments' }).waitFor({ timeout: 10_000 });
  await page.getByText(/1024 × 768/u).waitFor({ timeout: 10_000 });

  const harnessProof = await page.evaluate(() => ({
    calls: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.map((call) => call.command) ?? [],
    enabled: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.enabled === true,
    hasTauriInternals: window.__TAURI_INTERNALS__ !== undefined,
  }));
  if (!harnessProof.enabled || !harnessProof.hasTauriInternals) {
    throw new Error('Browser Tauri harness was not installed.');
  }
  for (const requiredCommand of [
    'load_settings',
    'get_supported_file_types',
    'plugin:dialog|open',
    'get_folder_tree',
    'load_metadata',
    'load_image',
    'apply_adjustments',
  ]) {
    if (!harnessProof.calls.includes(requiredCommand)) {
      throw new Error(`Browser Tauri harness did not record ${requiredCommand}.`);
    }
  }
  const actionableErrors = consoleErrors.filter(
    (message) => !message.includes('React does not recognize the') && !message.includes('Clerk:'),
  );
  if (actionableErrors.length > 0) {
    throw new Error(`Unexpected browser harness console errors: ${actionableErrors.slice(0, 5).join(' | ')}`);
  }
  console.log('browser tauri harness ok');
} catch (error) {
  console.error('browser tauri harness failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}
