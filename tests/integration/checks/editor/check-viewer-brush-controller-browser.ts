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
const pointSchema = z.object({ pressure: z.number().optional(), x: z.number(), y: z.number() }).passthrough();
const lineSchema = z
  .object({ flow: z.number().optional(), points: z.array(pointSchema).min(1), tool: z.enum(['brush', 'eraser']) })
  .passthrough();
const subMaskSchema = z
  .object({
    id: z.string().min(1),
    parameters: z.object({ lines: z.array(lineSchema).optional() }).passthrough(),
    type: z.string(),
  })
  .passthrough();
const saveSchema = z.object({
  args: z
    .object({
      adjustments: z
        .object({ masks: z.array(z.object({ subMasks: z.array(subMaskSchema) }).passthrough()) })
        .passthrough(),
      path: z.string(),
      transaction: z
        .object({ imageSessionId: z.string(), nextAdjustmentRevision: z.number().int().positive() })
        .passthrough(),
    })
    .passthrough(),
});
const renderSchema = z.object({
  args: z
    .object({
      request: z
        .object({
          editDocumentV2: z.object({
            layers: z
              .object({ masks: z.array(z.object({ subMasks: z.array(subMaskSchema) }).passthrough()) })
              .passthrough(),
          }),
        })
        .passthrough(),
    })
    .passthrough(),
  endedAtMs: z.number().nullable(),
});

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
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited before startup.');
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
const waitForCallCount = async (page: Page, command: string, expected: number) => {
  await page.waitForFunction(
    ({ count, name }) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === name).length ?? 0) >=
      count,
    { count: expected, name: command },
    { timeout: 10_000 },
  );
};
const framePoint = async (page: Page, x: number, y: number) => {
  const box = await page.locator('[data-editor-image-frame="edited"]').first().boundingBox();
  if (box === null) throw new Error('Edited frame has no bounds.');
  return { x: box.x + box.width * x, y: box.y + box.height * y };
};
const drawMouseStroke = async (page: Page) => {
  const start = await framePoint(page, 0.28, 0.38);
  const end = await framePoint(page, 0.7, 0.62);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  const captureElement = page.getByTestId('image-canvas-brush-command-capture');
  try {
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[data-testid="image-canvas-brush-command-capture"]')
            ?.getAttribute('data-brush-live-preview-point-count'),
        ) >= 2,
      undefined,
      { timeout: 10_000 },
    );
  } catch {
    const diagnostic = await page.evaluate(({ x, y }) => {
      const capture = document.querySelector<HTMLElement>('[data-testid="image-canvas-brush-command-capture"]');
      const target = document.elementFromPoint(x, y);
      return {
        active: capture?.dataset.brushControllerActive,
        captureBounds: capture?.getBoundingClientRect().toJSON(),
        pointCount: capture?.dataset.brushLivePreviewPointCount,
        target: target instanceof HTMLElement ? { className: target.className, tag: target.tagName } : null,
      };
    }, end);
    throw new Error(`Brush stage did not publish a live line: ${JSON.stringify(diagnostic)}`);
  }
  const overlay = await captureElement.evaluate((element) => ({
    firstX: Number(element.dataset.brushLivePreviewFirstX),
    firstY: Number(element.dataset.brushLivePreviewFirstY),
    lastX: Number(element.dataset.brushLivePreviewLastX),
    lastY: Number(element.dataset.brushLivePreviewLastY),
    mode: element.dataset.brushLivePreviewMode,
  }));
  await page.mouse.up();
  return overlay;
};
const assertOnePersistedStroke = async (
  page: Page,
  baseline: number,
  type: 'brush' | 'flow',
  overlay: Awaited<ReturnType<typeof drawMouseStroke>>,
) => {
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', baseline + 1);
  await page.waitForTimeout(250);
  const saves = await calls(page, 'save_metadata_and_update_thumbnail');
  if (saves.length !== baseline + 1)
    throw new Error(`${type} stroke persisted ${String(saves.length - baseline)} times.`);
  const saved = saveSchema.parse(saves.at(-1));
  const subMask = saved.args.adjustments.masks.flatMap(({ subMasks }) => subMasks).find((item) => item.type === type);
  const line = subMask?.parameters.lines?.at(-1);
  const first = line?.points[0];
  const last = line?.points.at(-1);
  if (
    saved.args.path !== sourcePath ||
    line === undefined ||
    first === undefined ||
    last === undefined ||
    line.tool !== 'brush' ||
    Math.abs(first.x - overlay.firstX) > 0.000001 ||
    Math.abs(first.y - overlay.firstY) > 0.000001 ||
    Math.abs(last.x - overlay.lastX) > 0.000001 ||
    Math.abs(last.y - overlay.lastY) > 0.000001
  ) {
    throw new Error(`${type} overlay and persisted command diverged: ${JSON.stringify({ first, last, overlay })}`);
  }
  if (type === 'flow' && !(typeof line.flow === 'number' && line.flow > 0)) {
    throw new Error('Flow stroke did not preserve its flow output parameter.');
  }
  await page.waitForFunction(
    ({ maskType, strokeCount }) =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command, endedAtMs }) => command === 'apply_adjustments' && endedAtMs !== null)
        .some(({ args }) => {
          const request = args?.request;
          if (!request || typeof request !== 'object' || !('editDocumentV2' in request)) return false;
          const document = request.editDocumentV2;
          if (!document || typeof document !== 'object' || !('layers' in document)) return false;
          const layers = document.layers;
          if (!layers || typeof layers !== 'object' || !('masks' in layers) || !Array.isArray(layers.masks))
            return false;
          return layers.masks.some((mask) => {
            if (!mask || typeof mask !== 'object' || !('subMasks' in mask) || !Array.isArray(mask.subMasks))
              return false;
            return mask.subMasks.some((subMask) => {
              if (!subMask || typeof subMask !== 'object' || !('type' in subMask) || subMask.type !== maskType)
                return false;
              if (!('parameters' in subMask) || !subMask.parameters || typeof subMask.parameters !== 'object')
                return false;
              return (
                'lines' in subMask.parameters &&
                Array.isArray(subMask.parameters.lines) &&
                subMask.parameters.lines.length >= strokeCount
              );
            });
          });
        }) === true,
    { maskType: type, strokeCount: subMask.parameters.lines?.length ?? 1 },
    { timeout: 10_000 },
  );
  const rendered = (await calls(page, 'apply_adjustments'))
    .map((call) => renderSchema.safeParse(call))
    .findLast(
      (parsed) =>
        parsed.success &&
        parsed.data.endedAtMs !== null &&
        parsed.data.args.request.editDocumentV2.layers.masks
          .flatMap(({ subMasks }) => subMasks)
          .some(
            (candidate) =>
              candidate.type === type &&
              (candidate.parameters.lines?.length ?? 0) >= (subMask.parameters.lines?.length ?? 1),
          ),
    );
  if (!rendered?.success) throw new Error(`${type} stroke never reached a completed render document.`);
  return line;
};
const selectSource = async (page: Page, path: string) => {
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${path}"]`).evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Filmstrip source is not interactive.');
    element.click();
  });
  await page.waitForFunction(
    (source) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === source,
    path,
    { timeout: 10_000 },
  );
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 1000, width: 1600 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: { tag_name: 'v0.0.0-browser' }, status: 200 });
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Open Folder/u }).click();
  const thumbnail = page.getByRole('button', { name: /browser-harness\.ARW/u }).first();
  await thumbnail.waitFor({ timeout: 10_000 });
  await thumbnail.dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('right-panel-switcher-button-masks').click();
  await page.getByTestId('layer-create-brush-local-adjustment').click();
  const initialBrushSubMask = page.locator('[data-testid^="mask-submask-row-"]').first();
  await initialBrushSubMask.waitFor({ timeout: 10_000 });
  await initialBrushSubMask.click();
  const brushStage = page.getByTestId('image-canvas-brush-command-capture');
  await brushStage.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="image-canvas-brush-command-capture"]')
        ?.getAttribute('data-brush-controller-active') === 'true',
    undefined,
    { timeout: 10_000 },
  );
  await waitForCallCount(page, 'save_metadata_and_update_thumbnail', 1);

  const brushBaselineSaves = await calls(page, 'save_metadata_and_update_thumbnail');
  const brushBaseline = brushBaselineSaves.length;
  const brushBaselineStrokeCount =
    saveSchema
      .parse(brushBaselineSaves.at(-1))
      .args.adjustments.masks.flatMap(({ subMasks }) => subMasks)
      .find(({ type }) => type === 'brush')?.parameters.lines?.length ?? 0;
  const brushOverlay = await drawMouseStroke(page);
  if (brushOverlay.mode !== 'brush') throw new Error('Brush live overlay did not expose paint mode.');
  await assertOnePersistedStroke(page, brushBaseline, 'brush', brushOverlay);
  const brushReceiptStrokeCount = await brushStage.getAttribute('data-brush-command-stroke-count');
  if (brushReceiptStrokeCount !== String(brushBaselineStrokeCount + 1)) {
    throw new Error(
      `Brush receipt did not advance by one stroke: ${String(brushBaselineStrokeCount)} -> ${String(brushReceiptStrokeCount)}`,
    );
  }

  await page.getByTestId('mask-contextual-create-more').click();
  await page.getByRole('menuitem', { name: /Other/u }).hover();
  await page.getByRole('menuitem', { name: /Flow/u }).click();
  await page.getByRole('button', { name: /Flow/u }).first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(100);
  const flowBaseline = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const flowOverlay = await drawMouseStroke(page);
  await assertOnePersistedStroke(page, flowBaseline, 'flow', flowOverlay);

  const cancelWithoutPersistence = async (cancel: () => Promise<void>) => {
    const baseline = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
    const start = await framePoint(page, 0.34, 0.42);
    const end = await framePoint(page, 0.58, 0.55);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await cancel();
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
    if (after !== baseline) throw new Error(`Canceled brush stroke persisted ${String(after - baseline)} edits.`);
  };

  await cancelWithoutPersistence(async () => {
    await page.getByTestId('image-canvas').dispatchEvent('lostpointercapture', { pointerId: 1, pointerType: 'mouse' });
  });
  await cancelWithoutPersistence(async () => {
    const surface = page.getByTestId('image-canvas');
    await surface.focus();
    await page.keyboard.press('Escape');
  });
  await cancelWithoutPersistence(async () => {
    await page.getByRole('button', { name: 'Zoom in' }).evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Zoom in is not a button.');
      element.click();
    });
    await page.waitForTimeout(100);
  });
  await cancelWithoutPersistence(async () => {
    await selectSource(page, successorPath);
    await selectSource(page, sourcePath);
    await page.getByTestId('image-canvas-brush-command-capture').waitFor({ timeout: 10_000 });
  });

  const unmountBaseline = (await calls(page, 'save_metadata_and_update_thumbnail')).length;
  const pendingStart = await framePoint(page, 0.38, 0.44);
  const pendingEnd = await framePoint(page, 0.62, 0.57);
  await page.mouse.move(pendingStart.x, pendingStart.y);
  await page.mouse.down();
  await page.mouse.move(pendingEnd.x, pendingEnd.y, { steps: 3 });
  await page
    .locator('button[data-command-id="back-to-library"]:visible')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Back to library is not a button.');
      element.click();
    });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ state: 'detached', timeout: 10_000 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  if ((await calls(page, 'save_metadata_and_update_thumbnail')).length !== unmountBaseline) {
    throw new Error('Brush committed after ImageCanvas unmount.');
  }
  if (pageErrors.length > 0) throw new Error(`Brush journey emitted page errors: ${pageErrors.join(' | ')}`);
  console.log('viewer brush controller browser ok');
} catch (error) {
  console.error('viewer brush controller browser failed');
  if (serverOutput.trim()) console.error(serverOutput.trim());
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer();
}
