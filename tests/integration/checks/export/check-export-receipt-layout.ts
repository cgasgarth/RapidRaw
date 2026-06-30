#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

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
  await page.getByText('File Settings').waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'TIFF' }).click({ force: true });
  await page.getByRole('button', { name: /Export Image/u }).click();

  const receipt = page.getByTestId('export-success-receipt');
  await receipt.waitFor({ timeout: 10_000 });

  const detailsBox = await page.getByTestId('export-success-receipt-details').boundingBox();
  const actionsBox = await page.getByTestId('export-success-receipt-actions').boundingBox();
  const policyBox = await page.getByTestId('export-success-color-policy').boundingBox();
  const transformBox = await page.getByTestId('export-success-color-managed-transform').boundingBox();

  if (!detailsBox || detailsBox.width < 240) {
    throw new Error(`Receipt details column collapsed: ${detailsBox?.width ?? 'missing'}`);
  }
  if (!actionsBox || actionsBox.width < 240) {
    throw new Error(`Receipt actions row collapsed: ${actionsBox?.width ?? 'missing'}`);
  }
  if (!policyBox || policyBox.height > 36) {
    throw new Error(`Receipt policy text wrapped too tall: ${policyBox?.height ?? 'missing'}`);
  }
  if (!transformBox || transformBox.height > 36) {
    throw new Error(`Receipt transform text wrapped too tall: ${transformBox?.height ?? 'missing'}`);
  }

  console.log('export receipt layout ok');
} catch (error) {
  console.error('export receipt layout failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}
