import { afterEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { isolatedGitEnvironment } from '../../scripts/lib/ci/git-environment';
import { acquireResourceLease } from '../../scripts/lib/ci/resource-coordinator';
import { selectAffectedPerformanceScenarios } from '../../scripts/perf/affected';
import { createPerformanceBisectPlan, executePerformanceBisect, renderBisectPlan } from '../../scripts/perf/bisect';
import {
  appendApprovedBaseline,
  comparePerformanceTrend,
  exportBaselineHistory,
  importBaselineHistory,
  importBaselineHistoryOrQuarantine,
  selectApprovedBaseline,
} from '../../scripts/perf/history';
import type { PerformanceIdentity, PerformanceScenario } from '../../scripts/perf/model';
import { createRegressionArtifact, performanceRegressionArtifactSchema } from '../../scripts/perf/regression';
import { runPerformanceScenario } from '../../scripts/perf/runner';
import { performanceScenarios } from '../../scripts/perf/scenarios';

const { privateKey } = generateKeyPairSync('ed25519');
const approval = (reason: string, approvedAt: string) => ({
  actor: 'performance-reviewer',
  reason,
  approvedAt,
  signingKey: privateKey,
});

const identity = (commit: string): PerformanceIdentity => ({
  git: { commit, dirtyDigest: 'b'.repeat(64) },
  build: { profile: 'test', runtime: 'bun-test' },
  hardware: { classId: 'c'.repeat(64), cpuCores: 8, cpuModelHash: 'd'.repeat(64), memoryGiB: 16 },
  environment: { arch: 'arm64', bun: 'test', os: 'test-os' },
});

const scenario = (latency: number): PerformanceScenario => ({
  id: 'editor.synthetic-proof',
  version: 1,
  fixtureDigest: `sha256:${'d'.repeat(64)}`,
  cacheMode: 'warm',
  warmupRuns: 0,
  measuredRuns: 3,
  budgets: { latencyMs: { absolute: 2, relative: 0.15 } },
  maxRelativeMad: 0.2,
  metricUnits: { latencyMs: 'ms', work: 'count' },
  async runSample() {
    return { assertions: 1, metrics: { latencyMs: latency, work: latency } };
  },
});

const clock = (iso: string) => () => new Date(iso);

type PerformanceBisectOptions = Parameters<typeof executePerformanceBisect>[0];
const activeBisects = new Map<AbortController, Promise<unknown>>();

const beginOwnedPerformanceBisect = (options: Omit<PerformanceBisectOptions, 'signal'>) => {
  const controller = new AbortController();
  const result = executePerformanceBisect({ ...options, signal: controller.signal });
  activeBisects.set(controller, result);
  void result.then(
    () => activeBisects.delete(controller),
    () => activeBisects.delete(controller),
  );
  return { abort: () => controller.abort(), result };
};

const executeOwnedPerformanceBisect = (options: Omit<PerformanceBisectOptions, 'signal'>) =>
  beginOwnedPerformanceBisect(options).result;

afterEach(async () => {
  const executions = [...activeBisects.entries()];
  for (const [controller] of executions) controller.abort();
  await Promise.allSettled(executions.map(([, result]) => result));
});

describe('performance baseline history', () => {
  test('appends only reviewed passing baselines and preserves prior entries', async () => {
    const baseline = await runPerformanceScenario({
      scenario: scenario(10),
      identity: identity('a'.repeat(40)),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const first = appendApprovedBaseline(
      undefined,
      baseline,
      approval('reviewed stable run', '2026-01-02T00:00:00.000Z'),
    );
    const secondReceipt = { ...baseline, runId: 'run-z', startedAt: '2026-01-02T01:00:00.000Z' };
    const second = appendApprovedBaseline(
      first,
      secondReceipt,
      approval('second reviewed run', '2026-01-03T00:00:00.000Z'),
    );
    expect(first.entries).toHaveLength(1);
    expect(second.entries.slice(0, first.entries.length)).toEqual(first.entries);
    expect(() =>
      appendApprovedBaseline(second, baseline, approval('duplicate reviewed run', '2026-01-04T00:00:00.000Z')),
    ).toThrow('duplicate run ID');
    expect(() =>
      appendApprovedBaseline(
        undefined,
        { ...baseline, status: 'regression' },
        approval('bad baseline reason', '2026-01-02T00:00:00.000Z'),
      ),
    ).toThrow('Only passing receipts');
    expect(() =>
      appendApprovedBaseline(undefined, baseline, approval('premature approval', '2025-12-31T00:00:00.000Z')),
    ).toThrow('before its run ended');
  });

  test('selects the latest compatible non-future baseline deterministically', async () => {
    const baseline = await runPerformanceScenario({
      scenario: scenario(10),
      identity: identity('a'.repeat(40)),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const candidate = await runPerformanceScenario({
      scenario: scenario(11),
      identity: identity('f'.repeat(40)),
      now: clock('2026-01-10T00:00:00.000Z'),
    });
    const first = appendApprovedBaseline(undefined, baseline, approval('reviewed run a', '2026-01-02T00:00:00.000Z'));
    const second = appendApprovedBaseline(
      first,
      { ...baseline, runId: 'z' },
      approval('reviewed run z', '2026-01-05T00:00:00.000Z'),
    );
    const history = appendApprovedBaseline(
      second,
      { ...baseline, runId: 'future' },
      approval('future reviewed run', '2026-01-11T00:00:00.000Z'),
    );
    expect(selectApprovedBaseline(history, candidate).receipt.runId).toBe('z');
    const trend = comparePerformanceTrend(history, candidate, scenario(1).budgets);
    expect(trend.selectedBaselineRunId).toBe('z');
    expect(trend.points.map(({ baselineRunId }) => baselineRunId)).toEqual([baseline.runId, 'z']);
  });

  test('round-trips canonical signed history and quarantines tampering without deleting its source', async () => {
    const baseline = await runPerformanceScenario({
      scenario: scenario(10),
      identity: identity('a'.repeat(40)),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const history = appendApprovedBaseline(
      undefined,
      baseline,
      approval('reviewed canonical run', '2026-01-02T00:00:00.000Z'),
    );
    const exported = exportBaselineHistory(history);
    expect(exportBaselineHistory(importBaselineHistory(exported))).toBe(exported);
    expect(history.entries[0]).toMatchObject({
      actor: 'performance-reviewer',
      source: { runId: baseline.runId, commit: baseline.identity.git.commit },
      previousHash: 'genesis',
      signature: { algorithm: 'ed25519' },
    });
    const tampered = exported.replace('reviewed canonical run', 'reviewed tampered run');
    expect(() => importBaselineHistory(tampered)).toThrow('entry hash');
    const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-perf-quarantine-'));
    try {
      const result = await importBaselineHistoryOrQuarantine({
        text: tampered,
        sourcePath: resolve(directory, 'history.json'),
        quarantineRoot: resolve(directory, 'quarantine'),
        quarantinedAt: '2026-01-03T00:00:00.000Z',
      });
      expect(result).toMatchObject({ status: 'quarantined', quarantinedAt: '2026-01-03T00:00:00.000Z' });
      if (result.status !== 'quarantined') throw new Error('Expected corruption quarantine.');
      expect(await readFile(result.quarantinePath, 'utf8')).toBe(tampered);
      expect(result.quarantinePath).toContain(result.sha256.slice(0, 16));
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe('performance regression diagnosis and routing', () => {
  test('emits a typed regression artifact with an exact dry-run bisect command', async () => {
    const baseline = await runPerformanceScenario({
      scenario: scenario(10),
      identity: identity('a'.repeat(40)),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const candidate = await runPerformanceScenario({
      scenario: scenario(14),
      identity: identity('f'.repeat(40)),
      baseline,
      now: clock('2026-01-02T00:00:00.000Z'),
    });
    expect(candidate.status).toBe('regression');
    const withStage = (receipt: typeof baseline, durationMs: number) => ({
      ...receipt,
      observability: {
        clock: { domain: 'runner-monotonic' as const, unit: 'ms' as const },
        spans: [{ durationMs, run: 0, source: 'frontend' as const, stage: 'preview.render', startOffsetMs: 0 }],
      },
    });
    const artifact = createRegressionArtifact(withStage(baseline, 10), withStage(candidate, 14), {
      flag: '--baseline',
      path: "/tmp/baseline's receipt.json",
    });
    expect(performanceRegressionArtifactSchema.parse(artifact).likelyDivergentMetric).toBe('latencyMs');
    expect(artifact.likelyDivergentStage).toMatchObject({ source: 'frontend', stage: 'preview.render' });
    expect(artifact.likelyWorkAmplification).toMatchObject({ metric: 'work', unit: 'count' });
    expect(artifact.bisectPlanCommand).toContain("'\\''");
  });

  test('generates a non-mutating automated bisect plan with a skip-safe evaluator', () => {
    const plan = createPerformanceBisectPlan({
      good: 'a'.repeat(40),
      bad: 'f'.repeat(40),
      scenarioId: 'editor.preview-scheduling',
      baselineSource: { flag: '--history', path: '/tmp/perf history.json' },
    });
    expect(plan.dryRun).toBe(true);
    expect(plan.commands[1]).toEqual({
      command: 'git',
      args: [
        'bisect',
        'run',
        'bun',
        'perf',
        'run',
        'editor.preview-scheduling',
        '--history',
        '/tmp/perf history.json',
        '--profile',
        'development',
      ],
    });
    expect(renderBisectPlan(plan)[1]).toContain("'/tmp/perf history.json'");
  });

  test('executes git bisect and reports exact or skipped-candidate synthetic regressions', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-perf-bisect-'));
    const coordinationRoot = await mkdtemp(resolve(tmpdir(), 'rapidraw-perf-bisect-coordination-'));
    const evaluatorMilestone = resolve(coordinationRoot, 'evaluator-started');
    const environment = isolatedGitEnvironment();
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], {
        cwd: directory,
        env: environment,
        stderr: 'pipe',
        stdout: 'pipe',
      });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    try {
      git('init', '--quiet');
      // Keep the cleanliness probe honest when an fsmonitor hook emits a benign
      // diagnostic on stderr without starting Git's long-lived fsmonitor daemon.
      await writeFile(
        resolve(directory, 'fsmonitor-warning.sh'),
        "#!/bin/sh\necho 'synthetic fsmonitor diagnostic' >&2\nexit 1\n",
        { mode: 0o755 },
      );
      git('config', 'core.fsmonitor', './fsmonitor-warning.sh');
      await writeFile(
        resolve(directory, 'evaluate.sh'),
        `#!/bin/sh
value="$(cat value)"
echo "$value" >> ${JSON.stringify(evaluatorMilestone)}
if [ "\${1:-}" = "$value" ]; then exit 125; fi
if [ "$value" -lt 3 ]; then exit 0; fi
exit 1
`,
        { mode: 0o755 },
      );
      const commits: string[] = [];
      for (let value = 0; value < 5; value += 1) {
        await writeFile(resolve(directory, 'value'), `${value}\n`);
        git('add', '.');
        git(
          '-c',
          'user.email=performance-lab@example.invalid',
          '-c',
          'user.name=Performance Lab',
          'commit',
          '--quiet',
          '-m',
          `value ${value}`,
        );
        commits.push(git('rev-parse', 'HEAD'));
      }
      const good = commits[0];
      const firstBad = commits[3];
      const bad = commits[4];
      if (good === undefined || firstBad === undefined || bad === undefined)
        throw new Error('Synthetic commits missing.');
      const report = await executeOwnedPerformanceBisect({
        cwd: directory,
        good,
        bad,
        evaluator: { command: './evaluate.sh', args: [] },
      });
      expect(report).toMatchObject({ good, bad, firstBadCommit: firstBad, candidateCommits: [firstBad] });
      const skipped = await executeOwnedPerformanceBisect({
        cwd: directory,
        good,
        bad,
        evaluator: { command: './evaluate.sh', args: ['2'] },
      });
      expect(skipped).toMatchObject({ good, bad, candidateCommits: [commits[2], firstBad] });
      expect(skipped.firstBadCommit).toBeUndefined();
      expect(git('rev-parse', 'HEAD')).toBe(bad);
      expect(git('status', '--porcelain=v1')).toBe('');

      for (let repetition = 0; repetition < 3; repetition += 1) {
        await rm(evaluatorMilestone, { force: true });
        const holder = await acquireResourceLease({
          label: `synthetic-native-load-${repetition}`,
          resource: 'native-heavy',
          root: coordinationRoot,
        });
        let markQueued: (() => void) | undefined;
        const queued = new Promise<void>((resolveQueued) => {
          markQueued = resolveQueued;
        });
        const execution = executeOwnedPerformanceBisect({
          cwd: directory,
          good,
          bad,
          evaluator: { command: './evaluate.sh', args: [] },
          coordination: { root: coordinationRoot, onQueued: () => markQueued?.() },
        });
        try {
          await queued;
          expect(await Bun.file(evaluatorMilestone).exists()).toBeFalse();
        } finally {
          await holder.release();
        }
        await expect(execution).resolves.toMatchObject({ firstBadCommit: firstBad });
        expect(await Bun.file(evaluatorMilestone).exists()).toBeTrue();
      }
    } finally {
      await rm(coordinationRoot, { force: true, recursive: true });
      await rm(directory, { force: true, recursive: true });
    }
  }, 0);

  test('forced cancellation while queued never starts a bisect or leaks its lease ticket', async () => {
    const coordinationRoot = await mkdtemp(resolve(tmpdir(), 'rapidraw-perf-bisect-wait-cancel-'));
    const holder = await acquireResourceLease({
      label: 'native-build',
      resource: 'native-heavy',
      root: coordinationRoot,
    });
    let markQueued: (() => void) | undefined;
    const queued = new Promise<void>((resolveQueued) => {
      markQueued = resolveQueued;
    });
    const execution = beginOwnedPerformanceBisect({
      cwd: coordinationRoot,
      good: 'a'.repeat(40),
      bad: 'b'.repeat(40),
      evaluator: { command: 'must-not-run', args: [] },
      coordination: { root: coordinationRoot, onQueued: () => markQueued?.() },
    });
    try {
      await queued;
      execution.abort();
      await expect(execution.result).rejects.toThrow('performance_bisect_cancelled');
      expect(
        (await readFile(resolve(coordinationRoot, 'native-heavy.owner.json'), 'utf8')).includes('native-build'),
      ).toBeTrue();
      expect(await Bun.file(resolve(coordinationRoot, 'native-heavy.queue')).exists()).toBeFalse();
    } finally {
      execution.abort();
      await Promise.allSettled([execution.result]);
      await holder.release();
      await rm(coordinationRoot, { force: true, recursive: true });
    }
  }, 0);

  test('forced bisect cancellation terminates and reaps the evaluator process group', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-perf-bisect-cancel-'));
    const evaluatorPidPath = resolve(tmpdir(), `rapidraw-perf-bisect-evaluator-${randomUUID()}.pid`);
    const environment = isolatedGitEnvironment();
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], {
        cwd: directory,
        env: environment,
        stderr: 'pipe',
        stdout: 'pipe',
      });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    let execution: ReturnType<typeof beginOwnedPerformanceBisect> | undefined;
    try {
      git('init', '--quiet');
      await writeFile(
        resolve(directory, 'evaluate-blocking.sh'),
        `#!/bin/sh\necho $$ > ${JSON.stringify(evaluatorPidPath)}\nwhile :; do sleep 1; done\n`,
        { mode: 0o755 },
      );
      const commits: string[] = [];
      for (let value = 0; value < 3; value += 1) {
        await writeFile(resolve(directory, 'value'), `${value}\n`);
        git('add', '.');
        git(
          '-c',
          'user.email=performance-lab@example.invalid',
          '-c',
          'user.name=Performance Lab',
          'commit',
          '--quiet',
          '-m',
          `value ${value}`,
        );
        commits.push(git('rev-parse', 'HEAD'));
      }
      const good = commits[0];
      const bad = commits[2];
      if (good === undefined || bad === undefined) throw new Error('Synthetic commits missing.');
      execution = beginOwnedPerformanceBisect({
        cwd: directory,
        good,
        bad,
        evaluator: { command: './evaluate-blocking.sh', args: [] },
      });
      for (let attempt = 0; attempt < 200 && !(await Bun.file(evaluatorPidPath).exists()); attempt += 1)
        await Bun.sleep(10);
      if (!(await Bun.file(evaluatorPidPath).exists())) throw new Error('Blocking evaluator did not start.');
      const evaluatorPid = Number((await readFile(evaluatorPidPath, 'utf8')).trim());

      execution.abort();
      await expect(execution.result).rejects.toThrow('performance_bisect_cancelled');
      expect(() => process.kill(evaluatorPid, 0)).toThrow();
      expect(git('rev-parse', 'HEAD')).toBe(bad);
      expect(git('status', '--porcelain=v1')).toBe('');
    } finally {
      execution?.abort();
      await Promise.allSettled(execution === undefined ? [] : [execution.result]);
      await rm(evaluatorPidPath, { force: true });
      await rm(directory, { force: true, recursive: true });
    }
  }, 0);

  test('publishes a conservative affected-validation contract for #5396', () => {
    expect(selectAffectedPerformanceScenarios(['src/utils/adjustmentSnapshots.ts'], performanceScenarios)).toEqual({
      schemaVersion: 1,
      kind: 'performance-scenarios',
      scenarioIds: ['editor.preview-scheduling'],
      nodes: [
        {
          id: 'perf:editor.preview-scheduling:v1',
          scenarioId: 'editor.preview-scheduling',
          scenarioVersion: 1,
        },
      ],
      conservativeFallback: false,
    });
    expect(
      selectAffectedPerformanceScenarios(['src/components/panel/editor/CompareOverlay.tsx'], performanceScenarios)
        .scenarioIds,
    ).toEqual(['browser.editor-compare']);
    expect(
      selectAffectedPerformanceScenarios(['src/components/panel/editor/CropPanel.tsx'], performanceScenarios)
        .scenarioIds,
    ).toEqual(['browser.editor-crop']);
    expect(
      selectAffectedPerformanceScenarios(['src/utils/progressiveImageFrame.ts'], performanceScenarios).scenarioIds,
    ).toEqual([
      'browser.editor-culling-navigation',
      'browser.editor-navigation',
      'browser.editor-open',
      'browser.editor-pan-zoom',
    ]);
    expect(
      selectAffectedPerformanceScenarios(
        ['src/components/modals/navigation/CopyPasteSettingsModal.tsx'],
        performanceScenarios,
      ).scenarioIds,
    ).toEqual(['browser.editor-copy-paste-settings']);
    expect(
      selectAffectedPerformanceScenarios(['src/components/panel/right/export/ExportPanel.tsx'], performanceScenarios)
        .scenarioIds,
    ).toEqual(['jobs.export-mixed-batch']);
    expect(
      selectAffectedPerformanceScenarios(
        ['src/components/modals/navigation/ImportSettingsModal.tsx'],
        performanceScenarios,
      ).scenarioIds,
    ).toEqual(['jobs.import-batch']);
    expect(
      selectAffectedPerformanceScenarios(['src/hooks/ai/useAiConnectorStatus.ts'], performanceScenarios).scenarioIds,
    ).toEqual(['jobs.ai-capability-first-use-cold', 'jobs.ai-capability-first-use-warm']);
    expect(
      selectAffectedPerformanceScenarios(
        ['src/components/modals/computational-merge/HdrModal.tsx'],
        performanceScenarios,
      ).scenarioIds,
    ).toEqual(['jobs.computational-hdr-merge']);
    expect(
      selectAffectedPerformanceScenarios(['src/components/panel/MainLibrary.tsx'], performanceScenarios).scenarioIds,
    ).toEqual([
      'browser.library-folder-tree-expand',
      'browser.library-open',
      'browser.library-open-100k',
      'browser.library-open-10k',
      'browser.library-open-50k',
      'browser.library-search-filter-sort',
      'browser.library-sidecar-change',
      'browser.library-thumbnail-scroll',
    ]);
    expect(
      selectAffectedPerformanceScenarios(['src-tauri/src/gpu/gpu_processing.rs'], performanceScenarios).scenarioIds,
    ).toEqual(['native.editor-raw-open-cold', 'native.editor-raw-open-warm']);
    expect(selectAffectedPerformanceScenarios(['unknown/new-file.ts'], performanceScenarios)).toMatchObject({
      scenarioIds: [
        'browser.editor-compare',
        'browser.editor-copy-paste-settings',
        'browser.editor-crop',
        'browser.editor-culling-navigation',
        'browser.editor-exposure-flood',
        'browser.editor-local-mask',
        'browser.editor-navigation',
        'browser.editor-open',
        'browser.editor-pan-zoom',
        'browser.library-folder-tree-expand',
        'browser.library-open',
        'browser.library-open-100k',
        'browser.library-open-10k',
        'browser.library-open-50k',
        'browser.library-search-filter-sort',
        'browser.library-sidecar-change',
        'browser.library-thumbnail-scroll',
        'editor.preview-scheduling',
        'jobs.ai-capability-first-use-cold',
        'jobs.ai-capability-first-use-warm',
        'jobs.computational-hdr-merge',
        'jobs.export-mixed-batch',
        'jobs.import-batch',
        'native.editor-raw-open-cold',
        'native.editor-raw-open-warm',
        'native.startup-shell-cold',
        'native.startup-shell-warm',
      ],
      conservativeFallback: true,
    });
    expect(selectAffectedPerformanceScenarios([], performanceScenarios).scenarioIds).toEqual([]);
  });
});
