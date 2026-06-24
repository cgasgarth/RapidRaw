#!/usr/bin/env bun

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const host = 'localhost';
const port = 1420;
const baseUrl = `http://${host}:${port}`;
const harnessSettingsStorageKey = 'rawengine-browser-tauri-harness-settings-v1';
const rootPath = '/tmp/rawengine-browser-harness';

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
  env: { ...process.env },
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
  await page.addInitScript(
    ({ key, root }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          editorPreviewResolution: 1024,
          exportPresets: [
            {
              dontEnlarge: true,
              enableResize: false,
              enableWatermark: false,
              fileFormat: 'jpeg',
              filenameTemplate: '{original_filename}',
              id: 'default-hq',
              jpegQuality: 95,
              keepMetadata: true,
              name: 'High Quality',
              resizeMode: 'longEdge',
              resizeValue: 2048,
              stripGps: false,
            },
            {
              dontEnlarge: true,
              enableResize: true,
              enableWatermark: false,
              fileFormat: 'jpeg',
              filenameTemplate: '{original_filename}_web',
              id: 'default-fast',
              jpegQuality: 80,
              keepMetadata: false,
              name: 'Fast (Web)',
              resizeMode: 'width',
              resizeValue: 2048,
              stripGps: true,
            },
          ],
          lastFolderState: {
            currentFolderPath: root,
            expandedFolders: [root],
          },
          lastRootPath: root,
          libraryViewMode: 'flat',
          rootFolders: [root],
          theme: 'dark',
          thumbnailSize: 'medium',
          useWgpuRenderer: false,
        }),
      );
    },
    { key: harnessSettingsStorageKey, root: rootPath },
  );

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Continue Session/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('button', { exact: true, name: 'Export' }).click();

  await page.getByTestId('export-recipe-readiness-summary').waitFor({ timeout: 10_000 });
  const summary = await page.getByTestId('export-recipe-readiness-summary').innerText();
  if (!summary.includes('2 recipes') || !summary.includes('2 valid') || !summary.includes('2 built-in')) {
    throw new Error(`Unexpected built-in recipe summary: ${summary}`);
  }

  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes('Custom recipe needs review')) {
    throw new Error('Valid built-in export presets were labeled as custom-review warnings.');
  }

  console.log('export built-in preset readiness ok');
} catch (error) {
  console.error('export built-in preset readiness failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}
