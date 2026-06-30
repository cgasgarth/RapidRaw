import { access, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, resolve } from 'node:path';

const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.dng', '.nef', '.orf', '.raf', '.rw2']);

export interface PrivateRawRootSourceResolution {
  privateRoot: string;
  source?: string;
}

export async function resolvePrivateRawRootSource(options: {
  fixtureRelativePath: string;
  privateRoot: string;
  source?: string;
  tempPrefix: string;
}): Promise<PrivateRawRootSourceResolution> {
  const privateRoot = resolve(options.privateRoot);
  const fixturePath = resolve(privateRoot, options.fixtureRelativePath);
  if (await pathExists(fixturePath)) return { privateRoot, source: options.source };
  if (options.source !== undefined) return { privateRoot, source: options.source };

  if (!(await hasTopLevelRaw(privateRoot))) return { privateRoot };

  return {
    privateRoot: await mkdtemp(resolve(tmpdir(), options.tempPrefix)),
    source: privateRoot,
  };
}

async function hasTopLevelRaw(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && RAW_EXTENSIONS.has(extname(entry.name).toLowerCase()));
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
