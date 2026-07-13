import type { Page } from '@playwright/test';

export async function openEmptyFixture(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
}

export async function openLibraryFixture(page: Page): Promise<void> {
  await openEmptyFixture(page);
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .waitFor({ timeout: 10_000 });
}

export async function openEditorFixture(page: Page): Promise<void> {
  await openLibraryFixture(page);
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('image-canvas').waitFor({ timeout: 10_000 });
}

export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: /Command Palette/u }).waitFor({ timeout: 10_000 });
}
