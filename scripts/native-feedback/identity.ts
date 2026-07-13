import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';

const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const command = (args: readonly string[]): string => {
  const result = Bun.spawnSync([...args], { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`Native feedback identity command failed: ${args.join(' ')}`);
  return result.stdout.toString().trim();
};

export async function computeNativeSourceDigest(): Promise<string> {
  const paths = command(['git', 'ls-files', '-co', '--exclude-standard', '--', 'src-tauri'])
    .split('\n')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    hash.update(await readFile(resolve(path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function captureNativeFeedbackIdentity() {
  const cpu = cpus();
  const dirty = command(['git', 'status', '--porcelain=v1']);
  return {
    gitCommit: command(['git', 'rev-parse', 'HEAD']),
    dirtyDigest: digest(dirty),
    cargoLockDigest: digest(await readFile(resolve('src-tauri/Cargo.lock'))),
    workspaceManifestDigest: digest(await readFile(resolve('src-tauri/Cargo.toml'))),
    rustc: command(['rustc', '--version', '--verbose']),
    cargo: command(['cargo', '--version', '--verbose']),
    hardwareClass: digest(
      JSON.stringify({
        cpu: cpu[0]?.model ?? 'unknown',
        cores: cpu.length,
        memoryGiB: Math.round(totalmem() / 1024 ** 3),
      }),
    ),
  };
}
