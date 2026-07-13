import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { z } from 'zod';

export interface NativeQaIdentity {
  native: string;
  frontend: string;
  bundle: string;
  scenario: string;
  worktree: string;
}

const nativeQaDeploymentStageSchema = z.object({
  requested: z.boolean(),
  executed: z.boolean(),
  avoidedByIdentity: z.boolean(),
});

export const nativeQaDeploymentReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z.object({
      native: z.string().length(64),
      frontend: z.string().length(64),
      bundle: z.string().length(64),
      scenario: z.string().length(64),
      worktree: z.string().startsWith('/'),
    }),
    reason: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    completedAt: z.string().datetime(),
    stages: z.object({
      build: nativeQaDeploymentStageSchema,
      copy: nativeQaDeploymentStageSchema,
      sign: nativeQaDeploymentStageSchema,
    }),
  })
  .strict();

export function createNativeQaDeploymentReport(
  identity: NativeQaIdentity,
  deployment: ReturnType<typeof planNativeQaDeployment>,
  options: { shouldBuild: boolean; durationMs: number; completedAt: string },
): z.infer<typeof nativeQaDeploymentReportSchema> {
  return nativeQaDeploymentReportSchema.parse({
    schemaVersion: 1,
    identity,
    reason: deployment.reason,
    durationMs: options.durationMs,
    completedAt: options.completedAt,
    stages: {
      build: {
        requested: options.shouldBuild,
        executed: options.shouldBuild && deployment.build,
        avoidedByIdentity: options.shouldBuild && !deployment.build,
      },
      copy: { requested: true, executed: deployment.copy, avoidedByIdentity: !deployment.copy },
      sign: { requested: true, executed: deployment.sign, avoidedByIdentity: !deployment.sign },
    },
  });
}

export function assertNativeQaBuildAvailability(
  deployment: ReturnType<typeof planNativeQaDeployment>,
  shouldBuild: boolean,
): void {
  if (!shouldBuild && deployment.build) {
    throw new Error(
      `--no-build cannot satisfy native QA deployment reason ${deployment.reason}; rebuild before copying or launching.`,
    );
  }
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
