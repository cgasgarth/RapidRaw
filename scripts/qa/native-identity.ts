import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

export interface NativeQaIdentity {
  native: string;
  frontend: string;
  bundle: string;
  scenario: string;
  worktree: string;
}

const hashFiles = async (paths: readonly string[], salt: string): Promise<string> => {
  const hash = createHash('sha256').update(salt);
  for (const path of [...paths].sort()) {
    const stat = await lstat(path);
    hash.update(relative(process.cwd(), path)).update(String(stat.mode));
    if (stat.isFile()) hash.update(await readFile(path));
  }
  return hash.digest('hex');
};

export async function computeNativeQaIdentity(features: string): Promise<NativeQaIdentity> {
  const worktree = resolve('.');
  const listed = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard']);
  if (listed.exitCode !== 0) throw new Error('Unable to enumerate native QA identity inputs.');
  const paths = listed.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((path) => resolve(path));
  const nativePaths = paths.filter((path) => path.includes('/src-tauri/') || path.endsWith('/Cargo.lock'));
  const frontendPaths = paths.filter(
    (path) => path.includes('/src/') || /\/(?:package\.json|bun\.lock|vite\.config\.)/u.test(path),
  );
  const scenarioPaths = paths.filter((path) => path.includes('/scripts/qa/') || path.includes('/tests/integration/'));
  const bundlePaths = nativePaths.filter((path) => /(?:tauri\.conf|Info\.plist|entitlements|icons?)/u.test(path));
  return {
    worktree,
    native: await hashFiles(nativePaths, `native:${features}`),
    frontend: await hashFiles(frontendPaths, 'frontend'),
    scenario: await hashFiles(scenarioPaths, 'scenario'),
    bundle: await hashFiles(bundlePaths, `bundle:${features}`),
  };
}

export function planNativeQaDeployment(
  previous: NativeQaIdentity | undefined,
  next: NativeQaIdentity,
  options: { clean: boolean; devServer: boolean },
): { build: boolean; copy: boolean; sign: boolean; reason: string } {
  if (options.clean || previous === undefined)
    return { build: true, copy: true, sign: true, reason: options.clean ? 'clean' : 'uncached' };
  if (previous.worktree !== next.worktree) return { build: true, copy: true, sign: true, reason: 'worktree-changed' };
  if (previous.native !== next.native) return { build: true, copy: true, sign: true, reason: 'native-changed' };
  if (previous.bundle !== next.bundle) return { build: true, copy: true, sign: true, reason: 'bundle-changed' };
  if (!options.devServer && previous.frontend !== next.frontend)
    return { build: true, copy: true, sign: true, reason: 'frontend-changed' };
  return {
    build: false,
    copy: false,
    sign: false,
    reason: previous.scenario === next.scenario ? 'identity-hit' : 'scenario-only',
  };
}
