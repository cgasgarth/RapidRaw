#!/usr/bin/env bun
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedGitEnvironment } from '../lib/ci/git-environment';
import { planValidation, runValidation } from './engine';
import { type InputClass, type ValidationNode, validationManifest } from './manifest';

const root = await mkdtemp(join(tmpdir(), 'rapidraw-validation-replay-'));
const fixtureInit = Bun.spawnSync(['git', 'init', '-q'], {
  cwd: root,
  env: isolatedGitEnvironment(),
  stderr: 'pipe',
});
if (fixtureInit.exitCode !== 0) throw new Error(fixtureInit.stderr.toString());
const scenarios = [
  ['docs-only', 'guide.md', 'docs'],
  ['ts-component', 'src/component.ts', 'frontend'],
  ['schema', 'packages/rawengine-schema/schema.ts', 'schema'],
  ['rust-leaf', 'src-tauri/src/lib.rs', 'rust'],
  ['workflow', '.github/workflows/lint.yml', 'workflows'],
  ['dependency', 'src-tauri/Cargo.lock', 'dependencies'],
  ['mixed', 'mixed.change', 'scripts'],
] as const;
for (const [, path] of scenarios) {
  await Bun.write(join(root, path), `fixture:${path}\n`);
}

const node = (id: string, input: InputClass, build = false): ValidationNode => ({
  id,
  command: build
    ? ['/bin/sh', '-c', 'mkdir -p dist; printf proof > dist/shared-build']
    : ['/bin/sh', '-c', 'printf proof >/dev/null'],
  dependencies: [],
  inputs: [input],
  outputs: build ? ['dist'] : [],
  resourceClass: input === 'rust' ? 'native-heavy' : 'light',
  cachePolicy: 'local',
  modes: ['commit', 'full'],
  timeoutMs: 5000,
});
const fixtureManifest = [
  node('docs', 'docs'),
  node('frontend-build', 'frontend', true),
  node('schema', 'schema'),
  node('rust', 'rust'),
  node('workflow', 'workflows'),
  node('dependency', 'dependencies'),
];
const fixtureCoordinatorRoot = join(root, 'resource-locks');
const replay = Array.from({ length: 100 }, (_, index) => scenarios[index % scenarios.length]);

interface Measurement {
  wallMs: number;
  cpuMs: number;
  peakRssBytes: number;
  processes: number;
  builds: number;
  cacheHits: number;
  successes: number;
}

const measure = async (kind: 'baseline' | 'cold' | 'warm'): Promise<Measurement> => {
  const started = performance.now();
  let cpuMs = 0;
  let peakRssBytes = 0;
  let processes = 0;
  let builds = 0;
  let cacheHits = 0;
  let successes = 0;
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => {
    const line = values.join(' ');
    if (line.startsWith('PASS ')) {
      processes += 1;
      successes += 1;
      if (line.includes('frontend-build')) builds += 1;
      cpuMs += Number(line.match(/cpu=(\d+)ms/)?.[1] ?? 0);
      peakRssBytes = Math.max(peakRssBytes, Number(line.match(/rss=(\d+)/)?.[1] ?? 0));
    }
    if (line.startsWith('CACHE ')) cacheHits += 1;
  };
  console.error = () => {};
  try {
    for (const [, path] of replay) {
      const result = await runValidation(fixtureManifest, {
        mode: kind === 'baseline' ? 'full' : 'commit',
        changedPaths: kind === 'baseline' ? [] : [path],
        noCache: kind !== 'warm',
        verifyCache: false,
        explainCache: false,
        root,
        resourceCoordinatorRoot: fixtureCoordinatorRoot,
      });
      if (result !== 0) throw new Error(`${kind} replay failed for ${path}`);
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return {
    wallMs: Math.round(performance.now() - started),
    cpuMs,
    peakRssBytes,
    processes,
    builds,
    cacheHits,
    successes,
  };
};

if (!process.argv.includes('--real-only')) {
  const baseline = await measure('baseline');
  const cold = await measure('cold');
  const warm = await measure('warm');
  const fullSelected = planValidation(fixtureManifest, 'full', []).filter((entry) => entry.selected).length;
  if (fullSelected !== fixtureManifest.length || baseline.successes !== replay.length * fixtureManifest.length) {
    throw new Error('full-equivalence proof failed');
  }
  const artifact = await Bun.file(join(root, 'dist/shared-build')).text();
  if (artifact !== 'proof') throw new Error('shared build artifact mismatch');

  const failureStarted = performance.now();
  const failureResult = await runValidation(
    [{ ...fixtureManifest[0], id: 'intentional-failure', command: ['/usr/bin/false'], cachePolicy: 'none' }],
    {
      mode: 'commit',
      changedPaths: ['guide.md'],
      noCache: true,
      verifyCache: false,
      explainCache: false,
      root,
      resourceCoordinatorRoot: fixtureCoordinatorRoot,
    },
  );
  if (failureResult !== 1) throw new Error('first-failure proof did not fail');

  await writeFile(join(root, 'benchmark-receipt.json'), JSON.stringify({ baseline, cold, warm }));
  console.log(
    JSON.stringify({
      schemaVersion: 2,
      replayCount: replay.length,
      baseline,
      affectedCold: cold,
      affectedWarm: warm,
      cacheHitRate: warm.cacheHits / Math.max(1, warm.cacheHits + warm.processes),
      wallReductionColdPercent: Number(((1 - cold.wallMs / baseline.wallMs) * 100).toFixed(1)),
      wallReductionWarmPercent: Number(((1 - warm.wallMs / baseline.wallMs) * 100).toFixed(1)),
      firstFailureMs: Math.round(performance.now() - failureStarted),
      fullEquivalence: {
        selected: fullSelected,
        expected: fixtureManifest.length,
        artifactSha256: Bun.hash(artifact).toString(),
      },
    }),
  );
}

if (process.argv.includes('--real') || process.argv.includes('--real-only')) {
  const repositoryRoot = process.cwd();
  const realScenarios = scenarios.map(([name, path]) => [name, path] as const);
  const legacyNode = (
    id: string,
    command: readonly string[],
    resourceClass: ValidationNode['resourceClass'] = 'light',
  ): ValidationNode => ({
    id,
    command,
    dependencies: [],
    inputs: ['scripts'],
    resourceClass,
    cachePolicy: 'none',
    modes: ['full'],
    timeoutMs: 20 * 60_000,
  });
  const legacyManifest: readonly ValidationNode[] = [
    legacyNode('legacy-lint', ['bun', 'run', 'lint']),
    legacyNode('legacy-format', ['bun', 'run', 'format:check']),
    legacyNode('legacy-typecheck', ['bun', 'run', 'typecheck'], 'cpu-heavy'),
    legacyNode('legacy-unit', ['bun', 'run', 'test:unit'], 'cpu-heavy'),
    legacyNode('legacy-unsafe-casts', ['bun', 'tests/integration/checks/check-unsafe-casts.ts']),
    legacyNode('legacy-rustfmt', ['bun', 'run', 'check:rust:fmt']),
    legacyNode('legacy-rust-clippy', ['bun', 'run', 'check:rust:clippy'], 'native-heavy'),
    legacyNode('legacy-schema', ['bun', 'run', 'check:schema'], 'cpu-heavy'),
    legacyNode('legacy-bundle', ['bun', 'run', 'check:bundle'], 'cpu-heavy'),
    legacyNode('legacy-actions', ['bun', 'run', 'check:actions'], 'network'),
    legacyNode('legacy-action-pins', ['bun', 'tests/integration/checks/check-github-action-pins.ts']),
    legacyNode('legacy-security', ['bun', 'run', 'check:security'], 'network'),
    legacyNode('legacy-browser', ['bun', 'run', 'check:browser-harness'], 'browser'),
    legacyNode('legacy-tauri-commands', ['bun', 'tests/integration/checks/tauri/check-tauri-command-registration.ts']),
    legacyNode('legacy-tauri-schemas', ['bun', 'tests/integration/checks/tauri/check-tauri-schema-validation.ts']),
    legacyNode('legacy-script-types', ['bun', 'tests/integration/checks/check-script-type-coverage.ts']),
    legacyNode('legacy-rust-cfg', ['bun', 'tests/integration/checks/check-rust-platform-cfg-dead-code.ts']),
    legacyNode('legacy-native-contract', ['bun', 'tests/integration/checks/check-native-contract-boundary.ts']),
    legacyNode('legacy-native-leaves', ['bun', 'tests/integration/checks/check-native-feature-leaves.ts']),
    legacyNode('legacy-perf', ['bun', 'scripts/checks/ci/check-performance-smoke.ts'], 'cpu-heavy'),
    legacyNode('legacy-i18n', ['bunx', 'i18next-cli', 'lint'], 'cpu-heavy'),
    legacyNode('legacy-i18n-extract', ['bunx', 'i18next-cli', 'extract', '--ci', '--dry-run'], 'cpu-heavy'),
    legacyNode('legacy-unused', ['bunx', 'knip', '--config', 'knip.jsonc', '--dependencies', '--reporter', 'compact']),
    legacyNode('legacy-docs', ['bun', 'run', 'check:docs']),
  ];
  const outputIdentity = (): string => {
    const result = Bun.spawnSync(
      ['/bin/sh', '-c', 'find dist -type f -print0 2>/dev/null | sort -z | xargs -0 shasum -a 256 2>/dev/null || true'],
      { cwd: repositoryRoot, stdout: 'pipe' },
    );
    return Bun.hash(result.stdout).toString();
  };
  const measureReal = async (
    label: 'full' | 'affected-cold' | 'affected-warm',
    manifest: readonly ValidationNode[],
  ): Promise<Measurement & { scenarios: number; perScenario: Record<string, Measurement> }> => {
    const started = performance.now();
    let cpuMs = 0;
    let peakRssBytes = 0;
    let processes = 0;
    let builds = 0;
    let cacheHits = 0;
    let successes = 0;
    let scenarioCpuMs = 0;
    let scenarioPeakRssBytes = 0;
    const perScenario: Record<string, Measurement> = {};
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values: unknown[]) => {
      const line = values.join(' ');
      if (line.startsWith('PASS ')) {
        processes += 1;
        successes += 1;
        if (line.includes('bundle-build')) builds += 1;
        cpuMs += Number(line.match(/cpu=(\d+)ms/)?.[1] ?? 0);
        scenarioCpuMs += Number(line.match(/cpu=(\d+)ms/)?.[1] ?? 0);
        const rss = Number(line.match(/rss=(\d+)/)?.[1] ?? 0);
        peakRssBytes = Math.max(peakRssBytes, rss);
        scenarioPeakRssBytes = Math.max(scenarioPeakRssBytes, rss);
      }
      if (line.startsWith('CACHE ')) cacheHits += 1;
    };
    console.error = (...values: unknown[]) => originalError(...values);
    try {
      const selectedScenarios = label === 'full' ? ([['full', '']] as const) : realScenarios;
      for (const [scenarioName, path] of selectedScenarios) {
        const scenarioStarted = performance.now();
        const beforeProcesses = processes;
        const beforeBuilds = builds;
        const beforeCacheHits = cacheHits;
        const beforeSuccesses = successes;
        scenarioCpuMs = 0;
        scenarioPeakRssBytes = 0;
        const result = await runValidation(manifest, {
          mode: label === 'full' ? 'full' : 'commit',
          changedPaths: label === 'full' ? [] : [path],
          noCache: label !== 'affected-warm',
          verifyCache: false,
          explainCache: false,
          root: repositoryRoot,
        });
        if (result !== 0) throw new Error(`${label} RapidRaw validation failed for ${path || 'full'}`);
        perScenario[scenarioName] = {
          wallMs: Math.round(performance.now() - scenarioStarted),
          cpuMs: scenarioCpuMs,
          peakRssBytes: scenarioPeakRssBytes,
          processes: processes - beforeProcesses,
          builds: builds - beforeBuilds,
          cacheHits: cacheHits - beforeCacheHits,
          successes: successes - beforeSuccesses,
        };
      }
      return {
        wallMs: Math.round(performance.now() - started),
        cpuMs,
        peakRssBytes,
        processes,
        builds,
        cacheHits,
        successes,
        scenarios: selectedScenarios.length,
        perScenario,
      };
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  };
  const legacyFull = await measureReal('full', legacyManifest);
  const legacyOutputIdentity = outputIdentity();
  const dagFull = await measureReal('full', validationManifest);
  const dagOutputIdentity = outputIdentity();
  const realCold = await measureReal('affected-cold', validationManifest);
  const realWarm = await measureReal('affected-warm', validationManifest);
  if (legacyOutputIdentity !== dagOutputIdentity) throw new Error('legacy/DAG output artifact parity failed');
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      kind: 'rapidraw-real-manifest',
      legacyFull,
      dagFull,
      affectedCold: realCold,
      affectedWarm: realWarm,
      warmCacheHitRate: realWarm.cacheHits / Math.max(1, realWarm.cacheHits + realWarm.processes),
      fullPlanEquivalent:
        planValidation(validationManifest, 'full', []).filter((entry) => entry.selected).length ===
        validationManifest.filter((node) => node.modes.includes('full')).length,
      outputArtifactParity: legacyOutputIdentity,
    }),
  );
}
