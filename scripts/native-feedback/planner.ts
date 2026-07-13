import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NativeFeedbackProfile } from './model';

const leafCrates = ['rapidraw-ai', 'rapidraw-codecs', 'rapidraw-computational', 'rapidraw-types'] as const;

export const nativeCiPartitionPlanSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(['commit', 'push', 'pr', 'full', 'release']),
  changedPaths: z.array(z.string()),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      cwd: z.literal('src-tauri'),
      command: z.array(z.string().min(1)).min(2),
      dependencies: z.array(z.string()),
      resourceClass: z.literal('native-heavy'),
      cachePolicy: z.enum(['local', 'local-ci', 'none']),
      cacheKey: z.string().regex(/^[0-9a-f]{64}$/u),
      required: z.boolean(),
      reason: z.string().min(1),
    }),
  ),
  integrations: z.object({
    affectedValidation: z.object({
      schemaVersion: z.literal(1),
      kind: z.literal('validation-nodes'),
      nodeIds: z.array(z.string()),
    }),
    performanceArtifacts: z.object({
      schemaVersion: z.literal(1),
      kind: z.literal('performance-artifact-inputs'),
      producerIds: z.array(z.string()),
    }),
  }),
});

export type NativeCiPartitionPlan = z.infer<typeof nativeCiPartitionPlanSchema>;

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createNativeCiPartitionPlan(options: {
  mode: 'commit' | 'push' | 'pr' | 'full' | 'release';
  changedPaths: readonly string[];
  profile: NativeFeedbackProfile;
  identity: {
    cargoLockDigest: string;
    workspaceManifestDigest: string;
    sourceDigest: string;
    rustc: string;
    environment: string;
  };
}): NativeCiPartitionPlan {
  const paths = [...new Set(options.changedPaths.map((path) => path.replaceAll('\\', '/')))].sort();
  const selectedLeaves = leafCrates.filter((crate) =>
    paths.some((path) => path.startsWith(`src-tauri/crates/${crate}/`)),
  );
  const nativeChanged = paths.some((path) => path.startsWith('src-tauri/') || path === 'Cargo.lock');
  const coreChanged = paths.some(
    (path) =>
      path === 'Cargo.lock' ||
      path === 'src-tauri/Cargo.toml' ||
      (path.startsWith('src-tauri/') && !path.startsWith('src-tauri/crates/')),
  );
  const nodes: NativeCiPartitionPlan['nodes'] = [];
  for (const crate of selectedLeaves) {
    const id = `native-leaf:${crate}`;
    const command = ['cargo', 'test', '-p', crate, '--profile', options.profile.cargoProfile, '--locked'];
    nodes.push({
      id,
      cwd: 'src-tauri',
      command,
      dependencies: [],
      resourceClass: 'native-heavy',
      cachePolicy: 'local-ci',
      cacheKey: digest({
        version: 1,
        id,
        command,
        dependencies: [],
        identity: options.identity,
        profile: options.profile,
      }),
      required: false,
      reason: `changed workspace leaf ${crate}`,
    });
  }
  if (coreChanged) {
    const id = 'native-core:rapidraw-lib';
    const command = [
      'cargo',
      'test',
      '--lib',
      '--profile',
      options.profile.cargoProfile,
      '--locked',
      '--no-default-features',
      '--features',
      'required-ci,tauri-test',
    ];
    const dependencies = selectedLeaves.map((crate) => `native-leaf:${crate}`);
    nodes.push({
      id,
      cwd: 'src-tauri',
      command,
      dependencies,
      resourceClass: 'native-heavy',
      cachePolicy: 'local-ci',
      cacheKey: digest({
        version: 1,
        id,
        command,
        dependencyKeys: nodes.filter(({ id: nodeId }) => dependencies.includes(nodeId)).map(({ cacheKey }) => cacheKey),
        identity: options.identity,
        profile: options.profile,
      }),
      required: false,
      reason: 'root native/core input changed',
    });
  }
  if (['pr', 'full', 'release'].includes(options.mode)) {
    const id = 'native-full:required';
    const command = [
      'cargo',
      'test',
      '--locked',
      '--all-targets',
      '--no-default-features',
      '--features',
      'required-ci,tauri-test',
      '--no-fail-fast',
    ];
    const dependencies = nodes.map(({ id: dependency }) => dependency);
    nodes.push({
      id,
      cwd: 'src-tauri',
      command,
      dependencies,
      resourceClass: 'native-heavy',
      cachePolicy: 'none',
      cacheKey: digest({
        version: 1,
        id,
        command,
        dependencyKeys: nodes.filter(({ id: nodeId }) => dependencies.includes(nodeId)).map(({ cacheKey }) => cacheKey),
        identity: options.identity,
      }),
      required: true,
      reason: `${options.mode} confidence contract always includes full native validation`,
    });
  } else if (!nativeChanged) {
    nodes.length = 0;
  }
  return nativeCiPartitionPlanSchema.parse({
    schemaVersion: 1,
    mode: options.mode,
    changedPaths: paths,
    nodes,
    integrations: {
      affectedValidation: { schemaVersion: 1, kind: 'validation-nodes', nodeIds: nodes.map(({ id }) => id) },
      performanceArtifacts: {
        schemaVersion: 1,
        kind: 'performance-artifact-inputs',
        producerIds: nodes.filter(({ id }) => id !== 'native-full:required').map(({ id }) => `native-feedback:${id}`),
      },
    },
  });
}
