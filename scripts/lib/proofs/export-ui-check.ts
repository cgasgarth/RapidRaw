import { spawn } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';
import { allocateFreeTcpPort } from '../dev-server-port.ts';
import { stopDevServer, waitForDevServer } from './visual-smoke/capture-plumbing.ts';

export const exportHarnessRootPath = '/tmp/rawengine-browser-harness';

interface ExportUiCheckOptions {
  label: string;
  run: (page: Page) => Promise<void>;
  settings?: Readonly<Record<string, unknown>>;
}

export async function runExportUiCheck({ label, run, settings = {} }: ExportUiCheckOptions): Promise<void> {
  const host = '127.0.0.1';
  const port = await allocateFreeTcpPort(host);
  const baseUrl = `http://${host}:${port}`;
  const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
    env: { ...process.env, RAWENGINE_DEV_SERVER_PORT: String(port) },
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
    await waitForDevServer(baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: 'rawengine-browser-tauri-harness-settings-v1',
      value: JSON.stringify({
        editorPreviewResolution: 1024,
        lastFolderState: {
          currentFolderPath: exportHarnessRootPath,
          expandedFolders: [exportHarnessRootPath],
        },
        lastRootPath: exportHarnessRootPath,
        libraryViewMode: 'flat',
        rootFolders: [exportHarnessRootPath],
        theme: 'dark',
        thumbnailSize: 'medium',
        useWgpuRenderer: false,
        ...settings,
      }),
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Continue Session/u }).click();
    await page
      .getByRole('button', { name: /browser-harness\.ARW/u })
      .first()
      .dblclick();
    await page.getByRole('button', { exact: true, name: 'Export' }).click();

    await run(page);
    console.log(`${label} ok`);
  } catch (error) {
    console.error(`${label} failed`);
    if (serverOutput.trim()) console.error(serverOutput.trim());
    throw error;
  } finally {
    if (browser !== undefined) await browser.close();
    await stopDevServer(server);
  }
}
