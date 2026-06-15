import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;
const outputDir = resolve('artifacts/visual-smoke');
const scenarios = [
  {
    marker: 'Editor Preview',
    mode: 'empty-library',
    outputPath: resolve(outputDir, 'empty-library.png'),
    sectionMinimum: 4,
  },
  {
    marker: 'Panorama setup',
    mode: 'panorama-ui',
    outputPath: resolve(outputDir, 'panorama-ui.png'),
    sectionMinimum: 1,
  },
];

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function waitForDevServer() {
  const startedAt = Date.now();
  const timeoutMs = 45_000;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

async function stopDevServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) {
    return;
  }

  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveStop) => {
      server.once('exit', resolveStop);
    }),
    sleep(5_000).then(() => {
      server.kill('SIGKILL');
    }),
  ]);
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const server = spawn('bun', ['run', 'dev', '--', '--host', host], {
    env: { ...process.env, RAWENGINE_VISUAL_SMOKE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
  });
  server.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  let browser;

  try {
    await waitForDevServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1440, height: 960 },
    });

    page.on('pageerror', (error) => {
      throw error;
    });

    for (const scenario of scenarios) {
      await page.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.mode}`, { waitUntil: 'networkidle' });
      await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await page.getByText(scenario.marker, { exact: true }).waitFor({ timeout: 10_000 });

      const sectionCount = await page.locator('[data-visual-smoke-section]').count();
      if (sectionCount < scenario.sectionMinimum) {
        throw new Error(`Expected at least ${scenario.sectionMinimum} visual smoke sections, found ${sectionCount}`);
      }

      await page.screenshot({ path: scenario.outputPath, fullPage: false });
      console.log(`Captured visual smoke screenshot: ${scenario.outputPath}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Executable doesn')) {
      console.error('Playwright Chromium is not installed. Run: bunx playwright install chromium');
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopDevServer(server);
  }
}

await main();
