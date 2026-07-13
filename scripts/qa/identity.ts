import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { QaDaemonIdentity } from './daemon-model';

const hashFiles = async (worktree: string, paths: readonly string[]): Promise<string> => {
  const hash = createHash('sha256');
  for (const relative of paths) {
    const path = resolve(worktree, relative);
    hash.update(relative).update('\0');
    try {
      hash.update(await readFile(path));
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT') throw error;
      hash.update('<missing>');
    }
  }
  return hash.digest('hex');
};

function gitEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && value !== undefined) environment[key] = value;
  }
  return environment;
}

export async function createQaDaemonIdentity(worktree: string, headed: boolean): Promise<QaDaemonIdentity> {
  const git = (args: readonly string[]) => Bun.spawnSync(['git', '-C', worktree, ...args], { env: gitEnvironment() });
  const configuration = await hashFiles(worktree, [
    'bun.lock',
    'package.json',
    'vite.config.js',
    'tsconfig.json',
    'src-tauri/tauri.conf.json',
  ]);
  const sourceHash = createHash('sha256')
    .update(git(['rev-parse', 'HEAD']).stdout.toString())
    .update(git(['diff', '--binary', 'HEAD', '--', ':!private-artifacts']).stdout);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .stdout.toString()
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const relative of untracked) {
    sourceHash
      .update(relative)
      .update('\0')
      .update(await readFile(resolve(worktree, relative)));
  }
  const source = sourceHash.digest('hex');
  return { worktree: resolve(worktree), configuration, source, headed };
}

export async function processStartToken(pid: number): Promise<string | undefined> {
  if (process.platform === 'linux') {
    try {
      return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ')[21];
    } catch {
      return undefined;
    }
  }
  const result = Bun.spawnSync(['ps', '-o', 'lstart=', '-p', String(pid)]);
  if (result.exitCode !== 0) return undefined;
  const token = result.stdout.toString().trim();
  return token || undefined;
}

export async function pathModifiedAt(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}
