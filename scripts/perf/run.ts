#!/usr/bin/env bun

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { selectAffectedPerformanceScenarios } from './affected';
import {
  createPerformanceArtifactUploadManifest,
  performanceArtifactIndexSchema,
  planPerformanceArtifactRetention,
} from './artifacts';
import { createPerformanceBisectPlan, renderBisectPlan } from './bisect';
import { ciTrendGateExitCode, createPerformanceCiTrendGate } from './ci';
import {
  appendApprovedBaseline,
  comparePerformanceTrend,
  exportBaselineHistory,
  importBaselineHistory,
  importBaselineHistoryOrQuarantine,
  selectApprovedBaseline,
} from './history';
import { capturePerformanceIdentity } from './identity';
import { performanceRunReceiptSchema } from './model';
import { createRegressionArtifact } from './regression';
import { bisectExitCode, comparePerformanceReceipts, runPerformanceScenario } from './runner';
import { getPerformanceScenario, performanceScenarios } from './scenarios';

const args = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const readReceipt = async (path: string) =>
  performanceRunReceiptSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
const readHistory = async (path: string) => importBaselineHistory(await readFile(resolve(path), 'utf8'));
const readHistoryIfExists = async (path: string) => {
  try {
    return await readHistory(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
};
const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, target);
};
const writeTextAtomic = async (path: string, value: string): Promise<void> => {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, target);
};

if (args[0] === 'list') {
  for (const scenario of performanceScenarios)
    console.log(`${scenario.id}\tv${scenario.version}\t${scenario.cacheMode}\t${scenario.measuredRuns} samples`);
  process.exit(0);
}

if (args[0] === 'affected') {
  const explicitPaths = args.flatMap((arg, index) => (arg === '--path' ? [args[index + 1] ?? ''] : [])).filter(Boolean);
  const base = value('--base');
  const paths =
    base === undefined
      ? explicitPaths
      : Bun.spawnSync(['git', 'diff', '--name-only', `${base}...HEAD`])
          .stdout.toString()
          .trim()
          .split('\n')
          .filter(Boolean);
  console.log(JSON.stringify(selectAffectedPerformanceScenarios(paths, performanceScenarios)));
  process.exit(0);
}

if (args[0] === 'ci-gate') {
  const historyPath = value('--history');
  const candidatePath = value('--candidate');
  const outputPath = value('--output');
  if (historyPath === undefined || candidatePath === undefined || outputPath === undefined)
    throw new Error('Usage: bun perf ci-gate --history <history> --candidate <receipt> --output <gate.json>');
  const candidate = await readReceipt(candidatePath);
  const gate = createPerformanceCiTrendGate(
    await readHistory(historyPath),
    candidate,
    getPerformanceScenario(candidate.scenario.id),
  );
  await writeJsonAtomic(outputPath, gate);
  if (process.env.GITHUB_ACTIONS === 'true')
    console.log(
      `::${gate.status === 'pass' ? 'notice' : 'error'} title=${gate.annotation.title}::${gate.annotation.summary}`,
    );
  console.log(`${gate.status.toUpperCase()} ${gate.annotation.summary} gate=${resolve(outputPath)}`);
  process.exit(ciTrendGateExitCode(gate.status));
}

if (args[0] === 'artifact-manifest') {
  const receiptPath = value('--receipt');
  const outputPath = value('--output');
  const paths = args.flatMap((arg, index) => (arg === '--file' ? [args[index + 1] ?? ''] : [])).filter(Boolean);
  if (receiptPath === undefined || outputPath === undefined || paths.length === 0)
    throw new Error('Usage: bun perf artifact-manifest --receipt <receipt> --file <artifact>... --output <manifest>');
  const manifest = await createPerformanceArtifactUploadManifest({
    receipt: await readReceipt(receiptPath),
    paths,
    generatedAt: new Date().toISOString(),
  });
  await writeJsonAtomic(outputPath, manifest);
  console.log(`artifact manifest ${resolve(outputPath)} files=${manifest.files.length}`);
  process.exit(0);
}

if (args[0] === 'retention-plan') {
  const historyPath = value('--history');
  const indexPath = value('--index');
  if (historyPath === undefined || indexPath === undefined)
    throw new Error('Usage: bun perf retention-plan --history <history> --index <artifact-index>');
  const index = performanceArtifactIndexSchema.parse(JSON.parse(await readFile(resolve(indexPath), 'utf8')));
  console.log(
    JSON.stringify(
      planPerformanceArtifactRetention({
        history: await readHistory(historyPath),
        index,
        now: new Date().toISOString(),
      }),
    ),
  );
  process.exit(0);
}

if (args[0] === 'baseline-add') {
  const historyPath = args[1];
  const receiptPath = args[2];
  const reason = value('--reason');
  const actor = value('--actor');
  const signingKeyPath = value('--signing-key');
  if (
    historyPath === undefined ||
    receiptPath === undefined ||
    reason === undefined ||
    actor === undefined ||
    signingKeyPath === undefined
  )
    throw new Error(
      'Usage: bun perf baseline-add <history.json> <receipt.json> --actor <reviewer> --reason <reviewed-reason> --signing-key <ed25519-private.pem>',
    );
  const history = await readHistoryIfExists(historyPath);
  const updated = appendApprovedBaseline(history, await readReceipt(receiptPath), {
    actor,
    reason,
    approvedAt: new Date().toISOString(),
    signingKey: await readFile(resolve(signingKeyPath), 'utf8'),
  });
  await writeTextAtomic(historyPath, exportBaselineHistory(updated));
  console.log(`baseline appended ${resolve(historyPath)} entries=${updated.entries.length}`);
  process.exit(0);
}

if (args[0] === 'baseline-export') {
  const inputPath = args[1];
  const outputPath = args[2];
  if (inputPath === undefined || outputPath === undefined)
    throw new Error('Usage: bun perf baseline-export <history.json> <canonical-history.json>');
  await writeTextAtomic(outputPath, exportBaselineHistory(await readHistory(inputPath)));
  console.log(`baseline exported ${resolve(outputPath)}`);
  process.exit(0);
}

if (args[0] === 'baseline-import') {
  const inputPath = args[1];
  const outputPath = args[2];
  const quarantineRoot = value('--quarantine');
  if (inputPath === undefined || outputPath === undefined || quarantineRoot === undefined)
    throw new Error('Usage: bun perf baseline-import <input.json> <history.json> --quarantine <private-directory>');
  const result = await importBaselineHistoryOrQuarantine({
    text: await readFile(resolve(inputPath), 'utf8'),
    sourcePath: inputPath,
    quarantineRoot: resolve(quarantineRoot),
    quarantinedAt: new Date().toISOString(),
  });
  if (result.status === 'quarantined') {
    console.error(`baseline quarantined ${result.quarantinePath}: ${result.reason}`);
    process.exit(2);
  }
  await writeTextAtomic(outputPath, exportBaselineHistory(result.history));
  console.log(`baseline imported ${resolve(outputPath)} entries=${result.history.entries.length}`);
  process.exit(0);
}

if (args[0] === 'trend') {
  const historyPath = args[1];
  const candidatePath = args[2];
  if (historyPath === undefined || candidatePath === undefined)
    throw new Error('Usage: bun perf trend <history.json> <candidate.json>');
  const candidate = await readReceipt(candidatePath);
  console.log(
    JSON.stringify(
      comparePerformanceTrend(
        await readHistory(historyPath),
        candidate,
        getPerformanceScenario(candidate.scenario.id).budgets,
      ),
    ),
  );
  process.exit(0);
}

if (args[0] === 'bisect-plan') {
  const scenarioId = value('--scenario');
  const good = value('--good');
  const bad = value('--bad');
  const baselinePath = value('--baseline');
  const historyPath = value('--history');
  if (
    scenarioId === undefined ||
    good === undefined ||
    bad === undefined ||
    (baselinePath === undefined) === (historyPath === undefined)
  )
    throw new Error(
      'Usage: bun perf bisect-plan --scenario <id> --good <sha> --bad <sha> (--baseline <receipt> | --history <history>)',
    );
  getPerformanceScenario(scenarioId);
  const baselineSource =
    historyPath === undefined
      ? { flag: '--baseline' as const, path: resolve(baselinePath ?? '') }
      : { flag: '--history' as const, path: resolve(historyPath) };
  if (baselineSource.flag === '--baseline') {
    const receipt = await readReceipt(baselineSource.path);
    if (receipt.scenario.id !== scenarioId) throw new Error('Bisect baseline scenario does not match --scenario.');
  } else {
    const history = await readHistory(baselineSource.path);
    if (!history.entries.some(({ receipt }) => receipt.scenario.id === scenarioId))
      throw new Error('Bisect history has no baseline for --scenario.');
  }
  const plan = createPerformanceBisectPlan({ scenarioId, good, bad, baselineSource });
  console.log(JSON.stringify({ ...plan, shell: renderBisectPlan(plan) }));
  process.exit(0);
}

if (args[0] === 'compare' || args[0] === 'bisect-evaluate') {
  const baselinePath = args[1];
  const candidatePath = args[2];
  if (baselinePath === undefined || candidatePath === undefined)
    throw new Error(`Usage: bun perf ${args[0]} <baseline.json> <candidate.json>`);
  const [baseline, candidate] = await Promise.all([readReceipt(baselinePath), readReceipt(candidatePath)]);
  const scenario = getPerformanceScenario(candidate.scenario.id);
  const comparison = comparePerformanceReceipts(baseline, candidate, scenario.budgets);
  const status = comparison.some(({ regressed }) => regressed) ? 'regression' : 'pass';
  const comparedCandidate = performanceRunReceiptSchema.parse({ ...candidate, comparison, status });
  const artifactPath = value('--artifact');
  if (status === 'regression' && artifactPath !== undefined)
    await writeJsonAtomic(
      artifactPath,
      createRegressionArtifact(baseline, comparedCandidate, { flag: '--baseline', path: resolve(baselinePath) }),
    );
  console.log(
    JSON.stringify({ artifactPath: artifactPath === undefined ? null : resolve(artifactPath), comparison, status }),
  );
  if (args[0] === 'bisect-evaluate') process.exit(bisectExitCode(status));
  process.exit(status === 'regression' ? 1 : 0);
}

if (args[0] !== 'run' || args[1] === undefined)
  throw new Error('Usage: bun perf run <scenario> [--baseline receipt.json] [--output receipt.json]');
const scenario = getPerformanceScenario(args[1]);
const baselinePath = value('--baseline');
const historyPath = value('--history');
if (baselinePath !== undefined && historyPath !== undefined)
  throw new Error('Choose --baseline or --history, not both.');
const identity = capturePerformanceIdentity(value('--profile') ?? 'development');
let baseline = baselinePath === undefined ? undefined : await readReceipt(baselinePath);
if (historyPath !== undefined) {
  const history = await readHistory(historyPath);
  const selectionProbe = {
    schemaVersion: 1,
    runId: 'selection-probe',
    scenario: {
      id: scenario.id,
      version: scenario.version,
      fixtureDigest: scenario.fixtureDigest,
      cacheMode: scenario.cacheMode,
    },
    identity,
    protocol: { warmupRuns: scenario.warmupRuns, measuredRuns: scenario.measuredRuns },
    samples: [],
    correctness: { assertions: 0, passed: false },
    comparison: [],
    status: 'invalid',
    invalidReason: 'baseline selection probe',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    rerunCommand: 'selection-probe',
  } as const;
  baseline = selectApprovedBaseline(history, performanceRunReceiptSchema.parse(selectionProbe)).receipt;
}
const receipt = await runPerformanceScenario({
  scenario,
  identity,
  baseline,
});
const outputPath = resolve(value('--output') ?? `private-artifacts/perf/${receipt.runId}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
if (receipt.status === 'regression' && baseline !== undefined) {
  const regressionPath = outputPath.replace(/\.json$/u, '.regression.json');
  const source =
    historyPath === undefined
      ? { flag: '--baseline' as const, path: resolve(baselinePath ?? '') }
      : { flag: '--history' as const, path: resolve(historyPath) };
  await writeJsonAtomic(regressionPath, createRegressionArtifact(baseline, receipt, source));
}
const latency = receipt.samples.filter(({ unit }) => unit === 'ms').map(({ value }) => value);
console.log(
  `${receipt.status.toUpperCase()} ${scenario.id} samples=${scenario.measuredRuns} range=${latency.length === 0 ? 'n/a' : `${Math.min(...latency).toFixed(3)}-${Math.max(...latency).toFixed(3)}ms`} receipt=${outputPath}`,
);
process.exit(bisectExitCode(receipt.status));
