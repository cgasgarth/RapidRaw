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
const sampleCallSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          geometryEpoch: z.number().int().nonnegative(),
          graphRevision: z.string().min(1),
          imageIdentity: z.string().min(1),
          normalizedImagePoint: z.object({ x: z.number(), y: z.number() }).strict(),
          requestIdentity: z.string().min(1),
          target: z.enum(['edited', 'original', 'softProof']),
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

const sampleCalls = async (page: Page) =>
  z
    .array(sampleCallSchema)
    .parse(
      await page.evaluate(() =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'sample_viewer_pixel'),
      ),
    );

const waitForSampleCount = async (page: Page, expected: number) => {
  await page.waitForFunction(
    (count) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'sample_viewer_pixel')
        .length ?? 0) >= count,
    expected,
    { timeout: 10_000 },
  );
};

const waitForSampleCompletion = async (page: Page, index: number) => {
  await page.waitForFunction(
    (targetIndex) =>
      typeof window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'sample_viewer_pixel',
      )[targetIndex]?.endedAtMs === 'number',
    index,
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

const framePoint = async (page: Page, x: number, y: number) => {
  const frame = page.locator('[data-editor-image-frame="edited"]').first();
  await frame.waitFor({ timeout: 10_000 });
  const box = await frame.boundingBox();
  if (box === null) throw new Error('Edited preview frame has no rendered bounds.');
  return { x: box.x + box.width * x, y: box.y + box.height * y };
};

const queueSamples = async (page: Page, responses: Array<{ delayMs: number; rgb: [number, number, number] }>) => {
  await page.evaluate((queued) => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.viewerSampleResponses.push(...queued);
  }, responses);
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
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

  const baseline = (await sampleCalls(page)).length;
  await queueSamples(page, [
    { delayMs: 300, rgb: [0.9, 0.1, 0.1] },
    { delayMs: 20, rgb: [0.1, 0.8, 0.2] },
  ]);
  const first = await framePoint(page, 0.2, 0.35);
  await page.mouse.move(first.x, first.y);
  await waitForSampleCount(page, baseline + 1);
  const intermediate = await framePoint(page, 0.45, 0.5);
  const latest = await framePoint(page, 0.72, 0.64);
  await page.mouse.move(intermediate.x, intermediate.y);
  await page.mouse.move(latest.x, latest.y);
  await waitForSampleCompletion(page, baseline);
  await waitForSampleCount(page, baseline + 2);
  await waitForSampleCompletion(page, baseline + 1);
  await page.waitForTimeout(100);
  const coalescedCalls = await sampleCalls(page);
  if (coalescedCalls.length !== baseline + 2) {
    throw new Error(`Sampler did not coalesce to first + latest request: ${String(coalescedCalls.length - baseline)}`);
  }
  const latestRequest = coalescedCalls[baseline + 1]?.args.request;
  if (latestRequest === undefined) throw new Error('Latest sampler request is missing.');
  const overlay = page.getByTestId('viewer-sampler-overlay');
  await overlay.waitFor({ timeout: 10_000 });
  const overlayProof = await overlay.evaluate((element) => ({
    normalizedX: Number(element.dataset.normalizedX),
    normalizedY: Number(element.dataset.normalizedY),
    operationGeneration: Number(element.dataset.operationGeneration),
    requestIdentity: element.dataset.requestIdentity,
    status: element.dataset.samplerStatus,
  }));
  const overlayBox = await overlay.boundingBox();
  if (
    overlayProof.requestIdentity !== latestRequest.requestIdentity ||
    overlayProof.status !== 'available' ||
    Math.abs(overlayProof.normalizedX - latestRequest.normalizedImagePoint.x) > 0.000001 ||
    Math.abs(overlayProof.normalizedY - latestRequest.normalizedImagePoint.y) > 0.000001 ||
    overlayBox === null ||
    Math.abs(overlayBox.x + overlayBox.width / 2 - latest.x) > 1.5 ||
    Math.abs(overlayBox.y + overlayBox.height / 2 - latest.y) > 1.5
  ) {
    throw new Error(
      `Sampler overlay/command coordinates diverged: ${JSON.stringify({ latest, latestRequest, overlayBox, overlayProof })}`,
    );
  }
  const hud = page.locator('[data-testid="viewer-sampler-hud"]:visible').first();
  await hud.waitFor({ timeout: 10_000 });
  if (!((await hud.textContent()) ?? '').includes('R 26 G 204 B 51')) {
    throw new Error(`Late first result replaced the latest sampler output: ${(await hud.textContent()) ?? ''}`);
  }

  const staleBaseline = coalescedCalls.length;
  await queueSamples(page, [
    { delayMs: 500, rgb: [0.95, 0.05, 0.05] },
    { delayMs: 20, rgb: [0.1, 0.2, 0.9] },
  ]);
  const staleA = await framePoint(page, 0.3, 0.4);
  await page.mouse.move(staleA.x, staleA.y);
  await waitForSampleCount(page, staleBaseline + 1);
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${successorPath}"]`).click();
  await waitForSelectedSource(page, successorPath);
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${sourcePath}"]`).click();
  await waitForSelectedSource(page, sourcePath);
  const reopenedA = await framePoint(page, 0.68, 0.58);
  await page.mouse.move(reopenedA.x, reopenedA.y);
  await waitForSampleCompletion(page, staleBaseline);
  await waitForSampleCount(page, staleBaseline + 2);
  await waitForSampleCompletion(page, staleBaseline + 1);
  await page.waitForTimeout(100);
  const reopenedCalls = await sampleCalls(page);
  const reopenedRequest = reopenedCalls[staleBaseline + 1]?.args.request;
  if (
    reopenedCalls.length !== staleBaseline + 2 ||
    reopenedRequest === undefined ||
    (await overlay.getAttribute('data-request-identity')) !== reopenedRequest.requestIdentity ||
    !((await hud.textContent()) ?? '').includes('R 26 G 51 B 230')
  ) {
    throw new Error('A delayed A result published into the reopened A image session.');
  }

  const unmountBaseline = reopenedCalls.length;
  await queueSamples(page, [{ delayMs: 400, rgb: [0.8, 0.8, 0.1] }]);
  const pending = await framePoint(page, 0.52, 0.46);
  await page.mouse.move(pending.x, pending.y);
  await waitForSampleCount(page, unmountBaseline + 1);
  await page.evaluate(() => {
    const proofWindow = window as typeof window & {
      __RAWENGINE_SAMPLER_POST_UNMOUNT_PUBLICATIONS__?: number;
      __RAWENGINE_SAMPLER_POST_UNMOUNT_OBSERVER__?: MutationObserver;
    };
    proofWindow.__RAWENGINE_SAMPLER_POST_UNMOUNT_PUBLICATIONS__ = 0;
    proofWindow.__RAWENGINE_SAMPLER_POST_UNMOUNT_OBSERVER__ = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches('[data-testid="viewer-sampler-overlay"], [data-testid="viewer-sampler-hud"]') ||
              node.querySelector('[data-testid="viewer-sampler-overlay"], [data-testid="viewer-sampler-hud"]'))
          ) {
            proofWindow.__RAWENGINE_SAMPLER_POST_UNMOUNT_PUBLICATIONS__ =
              (proofWindow.__RAWENGINE_SAMPLER_POST_UNMOUNT_PUBLICATIONS__ ?? 0) + 1;
          }
        }
      }
    });
    proofWindow.__RAWENGINE_SAMPLER_POST_UNMOUNT_OBSERVER__.observe(document.body, { childList: true, subtree: true });
  });
  await page
    .locator('button[data-command-id="back-to-library"]:visible')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Back to library command is not a button.');
      element.click();
    });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ state: 'detached', timeout: 10_000 });
  await waitForSampleCompletion(page, unmountBaseline);
  await page.waitForTimeout(100);
  const postUnmountPublications = await page.evaluate(() => {
    const proofWindow = window as typeof window & {
      __RAWENGINE_SAMPLER_POST_UNMOUNT_PUBLICATIONS__?: number;
      __RAWENGINE_SAMPLER_POST_UNMOUNT_OBSERVER__?: MutationObserver;
    };
    proofWindow.__RAWENGINE_SAMPLER_POST_UNMOUNT_OBSERVER__?.disconnect();
    return proofWindow.__RAWENGINE_SAMPLER_POST_UNMOUNT_PUBLICATIONS__ ?? 0;
  });
  if (postUnmountPublications !== 0) {
    throw new Error(`Sampler published ${String(postUnmountPublications)} DOM updates after ImageCanvas unmount.`);
  }
  if (pageErrors.length > 0) throw new Error(`Sampler journey emitted page errors: ${pageErrors.join(' | ')}`);

  console.log('viewer sampler controller browser ok');
} catch (error) {
  console.error('viewer sampler controller browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
