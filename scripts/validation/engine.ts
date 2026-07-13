import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readBoundedStream, writeBoundedOutput } from '../lib/ci/compact-output.ts';
import { acquireResourceLease, type ResourceLease } from '../lib/ci/resource-coordinator';
import type { ResourceClass, ValidationMode, ValidationNode } from './manifest';
import { classesForPath } from './ownership';

export interface PlanEntry {
  node: ValidationNode;
  reason: string;
  selected: boolean;
}

export interface RunOptions {
  mode: ValidationMode;
  changedPaths: readonly string[];
  noCache: boolean;
  verifyCache: boolean;
  explainCache: boolean;
  root: string;
  resourceCoordinatorRoot?: string;
}

export const validateManifest = (manifest: readonly ValidationNode[]): void => {
  const ids = new Set<string>();
  for (const node of manifest) {
    if (ids.has(node.id)) throw new Error(`duplicate validation node: ${node.id}`);
    ids.add(node.id);
    if (node.command.length === 0 || node.inputs.length === 0 || node.modes.length === 0 || node.timeoutMs <= 0) {
      throw new Error(`invalid validation node: ${node.id}`);
    }
  }
  for (const node of manifest) {
    for (const dependency of node.dependencies) {
      if (!ids.has(dependency)) throw new Error(`validation dependency missing: ${dependency}`);
      if (dependency === node.id) throw new Error(`validation node depends on itself: ${node.id}`);
    }
  }
};

export const planValidation = (
  manifest: readonly ValidationNode[],
  mode: ValidationMode,
  changedPaths: readonly string[],
): PlanEntry[] => {
  validateManifest(manifest);
  const full = mode === 'full' || mode === 'release' || changedPaths.length === 0;
  const changedClasses = new Set(changedPaths.flatMap(classesForPath));
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));
  const selected = new Set<string>();
  const reasons = new Map<string, string>();
  for (const entry of manifest) {
    if (!entry.modes.includes(mode)) continue;
    const affected = full || entry.inputs.some((input) => changedClasses.has(input));
    if (affected) {
      selected.add(entry.id);
      reasons.set(
        entry.id,
        full
          ? `${mode} confidence contract`
          : `affected ${entry.inputs.filter((input) => changedClasses.has(input)).join(',')}`,
      );
    }
  }
  const includeDependencies = (id: string): void => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`validation dependency missing: ${id}`);
    for (const dependency of entry.dependencies) {
      if (!selected.has(dependency)) {
        selected.add(dependency);
        reasons.set(dependency, `dependency of ${id}`);
        includeDependencies(dependency);
      }
    }
  };
  for (const id of [...selected]) includeDependencies(id);
  return manifest
    .filter((entry) => entry.modes.includes(mode))
    .map((entry) => ({
      node: entry,
      selected: selected.has(entry.id),
      reason: reasons.get(entry.id) ?? 'unaffected inputs',
    }));
};

const walkFiles = async (root: string, directory = root): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ['.git', 'node_modules', 'target', 'dist', 'artifacts', 'private-artifacts', '.validation-cache'].includes(
        entry.name,
      )
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walkFiles(root, path)));
    else if (entry.isFile()) result.push(relative(root, path));
  }
  return result;
};

const digest = (parts: readonly (string | Uint8Array)[]): string => {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const part of parts) hasher.update(part);
  return hasher.digest('hex');
};

export interface ValidationSnapshot {
  files: readonly string[];
  digests: ReadonlyMap<string, string>;
  identity: string;
  toolchainIdentity: string;
}

export const boundedToolIdentity = (label: string, command: readonly string[], timeoutMs = 250): string => {
  const result = Bun.spawnSync([...command], {
    killSignal: 'SIGKILL',
    maxBuffer: 4096,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: timeoutMs,
  });
  const disposition = result.exitedDueToTimeout
    ? 'timeout'
    : result.exitedDueToMaxBuffer
      ? 'max-buffer'
      : (result.signalCode ?? String(result.exitCode));
  return `${label}:${disposition}:${result.stdout.toString().trim()}`;
};

export const freezeValidationSnapshot = async (root: string): Promise<ValidationSnapshot> => {
  const files = (await walkFiles(root)).sort();
  const digests = new Map<string, string>();
  for (const path of files) digests.set(path, digest([await readFile(join(root, path))]));
  const identity = digest(files.flatMap((path) => [path, digests.get(path) ?? 'missing']));
  const toolchainIdentity = ['bun', 'cargo', 'rustc']
    .map((tool) => boundedToolIdentity(tool, [tool, '--version']))
    .join('|');
  return { files, digests, identity, toolchainIdentity };
};

export const nodeCacheKey = async (
  node: ValidationNode,
  root: string,
  dependencyKeys: readonly string[],
  files?: readonly string[],
  snapshot?: ValidationSnapshot,
): Promise<string> => {
  const candidates = files ?? snapshot?.files ?? (await walkFiles(root));
  const relevant = candidates
    .filter((path) => classesForPath(path).some((input) => node.inputs.includes(input)))
    .sort();
  const content: (string | Uint8Array)[] = [
    'validation-engine-v1',
    JSON.stringify(node),
    Bun.version,
    snapshot?.toolchainIdentity ?? 'toolchain-unmeasured',
    `${process.platform}:${process.arch}`,
    process.env.RUSTFLAGS ?? '',
    process.env.CARGO_FEATURES ?? '',
    process.env.RAWENGINE_VALIDATION_FEATURES ?? '',
    process.env.CI ?? '',
    ...dependencyKeys,
  ];
  for (const path of relevant) {
    content.push(path, snapshot?.digests.get(path) ?? (await readFile(join(root, path))));
  }
  return digest(content);
};

export interface CacheRecord {
  key: string;
  node: string;
  durationMs: number;
  status: 'success';
  outputDigest: string;
  createdAt: string;
  artifacts: Record<string, string>;
  metrics: NodeMetrics;
}

export interface NodeMetrics {
  cpuMs: number;
  peakRssBytes: number;
}

export interface ProcessTermination {
  reason:
    | 'completed'
    | 'nonzero-exit'
    | 'timeout'
    | 'interrupted'
    | 'possible-oom-or-external-sigkill'
    | 'external-signal';
  signal?: 'SIGINT' | 'SIGKILL' | 'SIGTERM';
}

export const classifyProcessTermination = (
  exitCode: number,
  context: { interrupted: boolean; timedOut: boolean },
): ProcessTermination => {
  if (context.timedOut) return { reason: 'timeout', signal: exitCode === 137 ? 'SIGKILL' : 'SIGTERM' };
  if (context.interrupted) return { reason: 'interrupted', signal: 'SIGINT' };
  if (exitCode === 137) return { reason: 'possible-oom-or-external-sigkill', signal: 'SIGKILL' };
  if (exitCode === 130) return { reason: 'external-signal', signal: 'SIGINT' };
  if (exitCode === 143) return { reason: 'external-signal', signal: 'SIGTERM' };
  return { reason: exitCode === 0 ? 'completed' : 'nonzero-exit' };
};

const parseTimeMetrics = (stderr: string): NodeMetrics => {
  const macUser = Number(stderr.match(/\n\s*([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/)?.[2] ?? 0);
  const macSystem = Number(stderr.match(/\n\s*([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/)?.[3] ?? 0);
  const macRss = Number(stderr.match(/\n\s*(\d+)\s+maximum resident set size/)?.[1] ?? 0);
  const linuxUser = Number(stderr.match(/User time \(seconds\):\s*([\d.]+)/)?.[1] ?? 0);
  const linuxSystem = Number(stderr.match(/System time \(seconds\):\s*([\d.]+)/)?.[1] ?? 0);
  const linuxRssKiB = Number(stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/)?.[1] ?? 0);
  return {
    cpuMs: Math.round(1000 * (macUser + macSystem + linuxUser + linuxSystem)),
    peakRssBytes: Math.max(macRss, linuxRssKiB * 1024),
  };
};

const cacheRoot = async (root: string): Promise<string> => {
  if (process.env.RAWENGINE_VALIDATION_CACHE_ROOT) return resolve(root, process.env.RAWENGINE_VALIDATION_CACHE_ROOT);
  const command = Bun.spawnSync(['git', 'rev-parse', '--git-common-dir'], { cwd: root, stdout: 'pipe' });
  const common = command.exitCode === 0 ? command.stdout.toString().trim() : '.git';
  return resolve(root, common, 'codex-validation-cache-v1');
};

export const readCacheRecord = async (
  path: string,
  key: string,
  ttlMs = 7 * 24 * 60 * 60_000,
): Promise<CacheRecord | undefined> => {
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as CacheRecord;
    return record.key === key &&
      record.status === 'success' &&
      typeof record.metrics?.cpuMs === 'number' &&
      typeof record.artifacts === 'object' &&
      Date.now() - Date.parse(record.createdAt) <= ttlMs
      ? record
      : undefined;
  } catch {
    return undefined;
  }
};

const capacities: Record<ResourceClass, number> = {
  light: 4,
  'cpu-heavy': 2,
  'suite-exclusive': 1,
  'native-heavy': 1,
  browser: 1,
  network: 1,
};

export const runValidation = async (manifest: readonly ValidationNode[], options: RunOptions): Promise<number> => {
  const plan = planValidation(manifest, options.mode, options.changedPaths);
  for (const entry of plan) console.log(`${entry.selected ? 'RUN' : 'SKIP'} ${entry.node.id} (${entry.reason})`);
  const pending = new Map(plan.filter((entry) => entry.selected).map((entry) => [entry.node.id, entry.node]));
  const completed = new Map<string, { ok: boolean; key: string }>();
  const active = new Map<string, Promise<void>>();
  const activeResources = new Map<ResourceClass, number>();
  const cacheDirectory = await cacheRoot(options.root);
  await mkdir(cacheDirectory, { recursive: true });
  const snapshot = await freezeValidationSnapshot(options.root);
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  let failed = false;
  let interrupted = false;
  const terminateChildren = (): void => {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        if (!children.has(child)) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, 1500).unref();
    }
  };
  const onInterrupt = (): void => {
    interrupted = true;
    process.exitCode = 130;
    terminateChildren();
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);

  const artifactDigests = async (node: ValidationNode): Promise<Record<string, string>> => {
    const artifacts: Record<string, string> = {};
    for (const output of node.outputs ?? []) {
      const path = join(options.root, output);
      try {
        const metadata = await stat(path);
        if (metadata.isDirectory()) {
          const parts: (string | Uint8Array)[] = [];
          for (const file of (await walkFiles(path)).sort()) {
            const filePath = join(path, file);
            const fileMetadata = await stat(filePath);
            parts.push(`${file}:${fileMetadata.mode}:${fileMetadata.size}`, await readFile(filePath));
          }
          artifacts[output] = digest(parts);
        } else {
          artifacts[output] = digest([`${metadata.mode}:${metadata.size}`, await readFile(path)]);
        }
      } catch {
        artifacts[output] = 'missing';
      }
    }
    return artifacts;
  };

  const start = async (node: ValidationNode): Promise<void> => {
    const dependencyKeys = node.dependencies.map((id) => completed.get(id)?.key ?? 'missing');
    const key = await nodeCacheKey(node, options.root, dependencyKeys, undefined, snapshot);
    const recordPath = join(cacheDirectory, `${node.id}-${key}.json`);
    const coordinatedClass = ['cpu-heavy', 'suite-exclusive', 'native-heavy', 'browser', 'network'].includes(
      node.resourceClass,
    );
    const classLease = coordinatedClass
      ? await acquireResourceLease({
          capacity: capacities[node.resourceClass],
          label: `validation-class-${node.resourceClass}:${node.id}`,
          resource: `validation-class-${node.resourceClass}`,
          root: options.resourceCoordinatorRoot,
        })
      : undefined;
    let cacheLease: ResourceLease | undefined;
    try {
      cacheLease =
        node.cachePolicy === 'none'
          ? undefined
          : await acquireResourceLease({
              label: `validation-cache-${node.id}`,
              resource: `validation-cache-${node.id}-${key.slice(0, 20)}`,
              root: options.resourceCoordinatorRoot,
            });
      let cached = !options.noCache && node.cachePolicy !== 'none' ? await readCacheRecord(recordPath, key) : undefined;
      if (cached && JSON.stringify(cached.artifacts) !== JSON.stringify(await artifactDigests(node)))
        cached = undefined;
      if (cached && !options.verifyCache) {
        console.log(`CACHE ${node.id} (${key.slice(0, 12)}, ${cached.durationMs}ms)`);
        completed.set(node.id, { ok: true, key });
        return;
      }
      if (interrupted) throw new Error('validation_interrupted');
      if (options.explainCache) console.log(`${cached ? 'VERIFY' : 'MISS'} ${node.id} key=${key}`);
      const before = Bun.spawnSync(['git', 'status', '--porcelain=v1', '--untracked-files=no'], {
        cwd: options.root,
        stdout: 'pipe',
      }).stdout.toString();
      const started = performance.now();
      const timedCommand =
        process.platform === 'darwin'
          ? ['/usr/bin/time', '-l', ...node.command]
          : ['/usr/bin/time', '-v', ...node.command];
      const child = Bun.spawn(timedCommand, {
        cwd: options.root,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
        detached: true,
      });
      let timedOut = false;
      children.add(child);
      await cacheLease?.updateOwnerPid(child.pid);
      await classLease?.updateOwnerPid(child.pid);
      const killGroup = (signal: 'SIGTERM' | 'SIGKILL'): void => {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        killGroup('SIGTERM');
        setTimeout(() => {
          if (children.has(child)) killGroup('SIGKILL');
        }, 1500).unref();
      }, node.timeoutMs);
      const [stdout, stderr, exitCode] = await Promise.all([
        readBoundedStream(child.stdout),
        readBoundedStream(child.stderr),
        child.exited,
      ]);
      clearTimeout(timeout);
      children.delete(child);
      const durationMs = Math.round(performance.now() - started);
      const metrics = parseTimeMetrics(stderr);
      const termination = classifyProcessTermination(exitCode, { interrupted, timedOut });
      const after = Bun.spawnSync(['git', 'status', '--porcelain=v1', '--untracked-files=no'], {
        cwd: options.root,
        stdout: 'pipe',
      }).stdout.toString();
      const ok = exitCode === 0 && before === after;
      if (!ok) {
        failed = true;
        console.error(
          `FAIL ${node.id} (${durationMs}ms exit=${exitCode} signal=${termination.signal ?? 'none'} termination=${termination.reason} cpu=${metrics.cpuMs}ms rss=${metrics.peakRssBytes} trackedMutation=${before !== after}) reproduce: ${node.command.join(' ')}`,
        );
        writeBoundedOutput(`${node.id} stdout`, stdout);
        writeBoundedOutput(`${node.id} stderr`, stderr);
      } else {
        console.log(`PASS ${node.id} (${durationMs}ms cpu=${metrics.cpuMs}ms rss=${metrics.peakRssBytes})`);
        if (node.cachePolicy !== 'none') {
          const record: CacheRecord = {
            key,
            node: node.id,
            durationMs,
            status: 'success',
            outputDigest: digest([stdout, stderr]),
            createdAt: new Date().toISOString(),
            artifacts: await artifactDigests(node),
            metrics,
          };
          await mkdir(dirname(recordPath), { recursive: true });
          await writeFile(recordPath, `${JSON.stringify(record)}\n`);
        }
      }
      completed.set(node.id, { ok, key });
    } finally {
      await cacheLease?.release();
      await classLease?.release();
    }
  };

  while (pending.size > 0 || active.size > 0) {
    let launched = false;
    for (const [id, node] of pending) {
      if (interrupted || (failed && (options.mode === 'commit' || options.mode === 'push'))) break;
      if (!node.dependencies.every((dependency) => completed.get(dependency)?.ok)) continue;
      const count = activeResources.get(node.resourceClass) ?? 0;
      if (count >= capacities[node.resourceClass]) continue;
      pending.delete(id);
      activeResources.set(node.resourceClass, count + 1);
      const promise = start(node)
        .catch((error) => {
          console.error(`FAIL ${id} (runner error: ${error instanceof Error ? error.message : String(error)})`);
          failed = true;
          completed.set(id, { ok: false, key: 'runner-error' });
        })
        .finally(() => {
          active.delete(id);
          activeResources.set(node.resourceClass, (activeResources.get(node.resourceClass) ?? 1) - 1);
        });
      active.set(id, promise);
      launched = true;
    }
    if (active.size > 0) await Promise.race(active.values());
    else if (!launched && pending.size > 0) {
      for (const [id, node] of pending) {
        if (failed || interrupted || node.dependencies.some((dependency) => completed.get(dependency)?.ok === false)) {
          console.error(`BLOCKED ${id} (failed dependency)`);
          completed.set(id, { ok: false, key: 'blocked' });
          pending.delete(id);
        }
      }
      if (pending.size > 0) throw new Error(`validation DAG stalled: ${[...pending.keys()].join(', ')}`);
    }
  }
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
  const finalSnapshot = await freezeValidationSnapshot(options.root);
  if (finalSnapshot.identity !== snapshot.identity) {
    const changed = [...new Set([...snapshot.files, ...finalSnapshot.files])]
      .filter((path) => snapshot.digests.get(path) !== finalSnapshot.digests.get(path))
      .slice(0, 20);
    console.error(`FAIL frozen-snapshot (inputs changed during validation: ${changed.join(', ')})`);
    return 1;
  }
  if (interrupted) return 130;
  return !failed && [...completed.values()].every((result) => result.ok) ? 0 : 1;
};
