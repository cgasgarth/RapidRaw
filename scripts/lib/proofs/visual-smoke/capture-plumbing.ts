import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (milliseconds: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

export async function waitForDevServer(baseUrl: string): Promise<void> {
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

export async function stopDevServer(server: ChildProcessWithoutNullStreams): Promise<void> {
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

export async function readPngDimensions(path: string): Promise<{ height: number; width: number }> {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

export async function readPngDataUrl(path: string): Promise<string> {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export async function readJpegDataUrl(path: string): Promise<string> {
  const buffer = await readFile(path);
  if (buffer.toString('hex', 0, 2) !== 'ffd8') {
    throw new Error(`${path} is not a JPEG file.`);
  }
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function runSipsPngThumbnail(sourcePath: string, outputPath: string, maxDimension: number): Promise<void> {
  await new Promise((resolveSips, rejectSips) => {
    const child = spawn('sips', ['-Z', String(maxDimension), sourcePath, '--out', outputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-1_000);
    });
    child.once('error', rejectSips);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveSips(undefined);
        return;
      }

      rejectSips(new Error(`sips thumbnail failed for ${sourcePath}: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

export async function readLayerMaskPreviewDataUrl(path: string): Promise<string> {
  const dimensions = await readPngDimensions(path);
  const maxPreviewDimension = 720;
  if (Math.max(dimensions.width, dimensions.height) <= maxPreviewDimension) {
    return readPngDataUrl(path);
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'rawengine-layer-preview-'));
  const outputPath = join(tempDir, 'preview.png');

  try {
    await runSipsPngThumbnail(path, outputPath, maxPreviewDimension);
    return await readPngDataUrl(outputPath);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export async function sha256File(path: string): Promise<string> {
  return `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}
