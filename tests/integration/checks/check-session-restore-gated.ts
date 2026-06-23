#!/usr/bin/env bun

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;
const harnessSettingsStorageKey = 'rawengine-browser-tauri-harness-settings-v1';
const restoredRootPath = '/Users/cgas/Pictures/Capture One/Alaska';
const forbiddenStartupCommands = new Set(['get_pinned_folder_trees', 'list_images_in_dir', 'list_images_recursive']);

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
    ({ key, rootPath }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          editorPreviewResolution: 1024,
          lastFolderState: {
            currentFolderPath: rootPath,
            expandedFolders: [rootPath],
          },
          lastRootPath: rootPath,
          libraryViewMode: 'flat',
          rootFolders: [rootPath],
          theme: 'dark',
          thumbnailSize: 'medium',
          useWgpuRenderer: false,
        }),
      );
    },
    { key: harnessSettingsStorageKey, rootPath: restoredRootPath },
  );
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
  await page.getByRole('button', { name: /Continue Session/u }).waitFor({ timeout: 10_000 });

  const startupCalls = await page.evaluate(() => window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []);
  const forbiddenStartupCall = startupCalls.find((call) => forbiddenStartupCommands.has(call.command));
  if (forbiddenStartupCall !== undefined) {
    throw new Error(`Session restore touched folders before user consent: ${forbiddenStartupCall.command}`);
  }

  await page.getByRole('button', { name: /Continue Session/u }).click();
  await page.waitForFunction(() => {
    const commands = (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).map((call) => call.command);
    return commands.includes('get_pinned_folder_trees') && commands.includes('list_images_in_dir');
  });

  console.log('session restore gated ok');
} catch (error) {
  console.error('session restore gated failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}
