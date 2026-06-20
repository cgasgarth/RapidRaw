#!/usr/bin/env bun

import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

const REVIEW_PAGE_PATH = 'docs/validation/goal-review-2026-06-11.html';
const SCREENSHOT_PATH = 'docs/validation/goal-review-screenshot-2026-06-18.png';
const update = process.argv.includes('--update');

const pngInfoSchema = z
  .object({
    byteLength: z.number().int().min(20_000),
    height: z.literal(900),
    width: z.literal(1280),
  })
  .strict();

if (update) {
  await captureScreenshot();
}

if (!existsSync(SCREENSHOT_PATH)) {
  throw new Error(`Missing ${SCREENSHOT_PATH}; run bun run check:goal-review-screenshot:update.`);
}

pngInfoSchema.parse(await readPngInfo(SCREENSHOT_PATH));
console.log('goal review screenshot ok');

async function captureScreenshot(): Promise<void> {
  await mkdir(dirname(SCREENSHOT_PATH), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { height: 900, width: 1280 },
    });
    await page.goto(pathToFileURL(resolve(REVIEW_PAGE_PATH)).toString(), { waitUntil: 'load' });
    await page.screenshot({ fullPage: false, path: SCREENSHOT_PATH });
  } finally {
    await browser.close();
  }
}

async function readPngInfo(path: string): Promise<z.infer<typeof pngInfoSchema>> {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG file.`);
  return {
    byteLength: buffer.byteLength,
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}
