import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  nativeQaRuntimeBundleIsReady,
  removeNativeQaBuildBundle,
  resolveNativeQaAppDeploymentPaths,
} from '../../../scripts/qa/native-app-deployment';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'rapidraw-native-qa-deployment-'));
  temporaryRoots.push(root);
  return root;
};

describe('native QA app deployment isolation', () => {
  test('places each transient app outside its worktree with a stable isolated identity', async () => {
    const root = await temporaryRoot();
    const first = resolveNativeQaAppDeploymentPaths(join(root, 'worktree-a'), join(root, 'runtime'));
    const repeated = resolveNativeQaAppDeploymentPaths(join(root, 'worktree-a'), join(root, 'runtime'));
    const second = resolveNativeQaAppDeploymentPaths(join(root, 'worktree-b'), join(root, 'runtime'));

    expect(first).toEqual(repeated);
    expect(first.qaAppPath).not.toBe(second.qaAppPath);
    expect(first.qaAppPath.startsWith(join(root, 'runtime', 'rawengine-native-qa'))).toBe(true);
    expect(first.qaAppPath.startsWith(join(root, 'worktree-a'))).toBe(false);
    expect(first.sourceAppPath.startsWith(join(root, 'worktree-a'))).toBe(true);
  });

  test('requires both bundle metadata and executable before reusing a runtime app', async () => {
    const root = await temporaryRoot();
    const paths = resolveNativeQaAppDeploymentPaths(join(root, 'worktree'), join(root, 'runtime'));

    expect(await nativeQaRuntimeBundleIsReady(paths)).toBe(false);
    await mkdir(dirname(paths.qaExecutablePath), { recursive: true });
    await writeFile(paths.qaExecutablePath, 'binary');
    expect(await nativeQaRuntimeBundleIsReady(paths)).toBe(false);
    await mkdir(join(paths.qaAppPath, 'Contents'), { recursive: true });
    await writeFile(join(paths.qaAppPath, 'Contents/Info.plist'), 'plist');
    expect(await nativeQaRuntimeBundleIsReady(paths)).toBe(true);
  });

  test('removes only the generated Tauri source bundle after deployment', async () => {
    const root = await temporaryRoot();
    const worktree = join(root, 'worktree');
    const paths = resolveNativeQaAppDeploymentPaths(worktree, join(root, 'runtime'));
    const unrelated = join(worktree, 'src-tauri/target/debug/bundle/macos/Unrelated.app/keep');
    await mkdir(dirname(paths.sourceAppPath), { recursive: true });
    await writeFile(paths.sourceAppPath, 'generated bundle');
    await mkdir(dirname(unrelated), { recursive: true });
    await writeFile(unrelated, 'keep');

    expect(await removeNativeQaBuildBundle(paths)).toBe(true);
    expect(await Bun.file(paths.sourceAppPath).exists()).toBe(false);
    expect(await Bun.file(unrelated).text()).toBe('keep');
    expect(await removeNativeQaBuildBundle(paths)).toBe(false);
  });
});
