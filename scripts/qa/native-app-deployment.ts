import { createHash } from 'node:crypto';
import { access, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const NATIVE_QA_APP_NAME = 'RawEngine QA Current';
export const NATIVE_QA_BUNDLE_IDENTIFIER = 'dev.rawengine.RapidRAW.qa-current';

export interface NativeQaAppDeploymentPaths {
  identityPath: string;
  qaAppPath: string;
  qaExecutablePath: string;
  runtimeRoot: string;
  sourceAppPath: string;
}

export const resolveNativeQaAppDeploymentPaths = (
  worktree: string,
  temporaryRoot = '/private/tmp',
): NativeQaAppDeploymentPaths => {
  const resolvedWorktree = resolve(worktree);
  const worktreeIdentity = createHash('sha256').update(resolvedWorktree).digest('hex').slice(0, 20);
  const runtimeRoot = join(resolve(temporaryRoot), 'rawengine-native-qa', worktreeIdentity);
  const qaAppPath = join(runtimeRoot, `${NATIVE_QA_APP_NAME}.app`);
  return {
    identityPath: join(resolvedWorktree, 'src-tauri/target/debug/bundle/macos/rawengine-qa-identity.json'),
    qaAppPath,
    qaExecutablePath: join(qaAppPath, 'Contents/MacOS/RapidRAW'),
    runtimeRoot,
    sourceAppPath: join(resolvedWorktree, 'src-tauri/target/debug/bundle/macos/RapidRAW.app'),
  };
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const nativeQaRuntimeBundleIsReady = async (paths: NativeQaAppDeploymentPaths): Promise<boolean> =>
  (await exists(join(paths.qaAppPath, 'Contents/Info.plist'))) && (await exists(paths.qaExecutablePath));

export const removeNativeQaBuildBundle = async (paths: NativeQaAppDeploymentPaths): Promise<boolean> => {
  const existed = await exists(paths.sourceAppPath);
  await rm(paths.sourceAppPath, { force: true, recursive: true });
  return existed;
};
