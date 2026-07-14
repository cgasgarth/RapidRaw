import { z } from 'zod';
import { isolatedGitEnvironment } from '../lib/ci/git-environment';

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/u);

export const performanceBisectPlanSchema = z.object({
  schemaVersion: z.literal(1),
  dryRun: z.literal(true),
  good: shaSchema,
  bad: shaSchema,
  scenarioId: z.string().min(1),
  baselineSource: z.object({ flag: z.enum(['--baseline', '--history']), path: z.string().startsWith('/') }),
  commands: z.array(z.object({ command: z.string().min(1), args: z.array(z.string()) })).length(2),
});

export type PerformanceBisectPlan = z.infer<typeof performanceBisectPlanSchema>;

export const performanceBisectReportSchema = z.object({
  schemaVersion: z.literal(1),
  good: shaSchema,
  bad: shaSchema,
  firstBadCommit: shaSchema.optional(),
  candidateCommits: z.array(shaSchema).min(1),
  evaluator: z.object({ command: z.string().min(1), args: z.array(z.string()) }),
  outputTail: z.string(),
});

export type PerformanceBisectReport = z.infer<typeof performanceBisectReportSchema>;

const signalProcessGroup = (pid: number, signal: 'SIGTERM' | 'SIGKILL'): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process group already exited.
    }
  }
};

const run = async (cwd: string, command: string, args: readonly string[], signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('performance_bisect_cancelled');
  const child = Bun.spawn([command, ...args], {
    cwd,
    detached: true,
    env: isolatedGitEnvironment(),
    stderr: 'pipe',
    stdout: 'pipe',
  });
  let cancelled = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    cancelled = true;
    signalProcessGroup(child.pid, 'SIGTERM');
    escalation = setTimeout(() => {
      if (child.exitCode === null) signalProcessGroup(child.pid, 'SIGKILL');
    }, 1_000);
    escalation.unref();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (cancelled) throw new Error('performance_bisect_cancelled');
    return { exitCode, output: stdout.trim(), stderr: stderr.trim() };
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (escalation !== undefined) clearTimeout(escalation);
    if (child.exitCode === null) {
      signalProcessGroup(child.pid, 'SIGTERM');
      const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(1_000).then(() => false)]);
      if (!exited) signalProcessGroup(child.pid, 'SIGKILL');
      await child.exited;
    }
  }
};

const diagnosticOutput = (result: Awaited<ReturnType<typeof run>>): string =>
  [result.output, result.stderr].filter((value) => value.length > 0).join('\n');

export async function executePerformanceBisect(options: {
  cwd: string;
  good: string;
  bad: string;
  evaluator: { command: string; args: string[] };
  signal?: AbortSignal;
}): Promise<PerformanceBisectReport> {
  const parsed = z
    .object({ cwd: z.string().startsWith('/'), good: shaSchema, bad: shaSchema })
    .parse({ cwd: options.cwd, good: options.good, bad: options.bad });
  const status = await run(parsed.cwd, 'git', ['status', '--porcelain=v1'], options.signal);
  if (status.exitCode !== 0 || status.output !== '') throw new Error('Performance bisect requires a clean worktree.');
  const started = await run(parsed.cwd, 'git', ['bisect', 'start', parsed.bad, parsed.good], options.signal);
  if (started.exitCode !== 0) throw new Error(`git bisect start failed:\n${diagnosticOutput(started).slice(-8_000)}`);
  let evaluated: Awaited<ReturnType<typeof run>> | undefined;
  try {
    evaluated = await run(
      parsed.cwd,
      'git',
      ['bisect', 'run', options.evaluator.command, ...options.evaluator.args],
      options.signal,
    );
  } finally {
    await run(parsed.cwd, 'git', ['bisect', 'reset']);
  }
  if (evaluated === undefined) throw new Error('git bisect run did not produce an evaluator result.');
  const firstBadCommit = evaluated.output.match(/([0-9a-f]{40}) is the first '?bad'? commit/u)?.[1];
  const ambiguousBlock = evaluated.output.match(
    /The first '?bad'? commit could be any of:\s*\n((?:[0-9a-f]{40}\s*\n?)+)/u,
  )?.[1];
  const candidateCommits =
    firstBadCommit === undefined ? (ambiguousBlock?.match(/[0-9a-f]{40}/gu) ?? []) : [firstBadCommit];
  if (candidateCommits.length === 0)
    throw new Error(`git bisect run failed:\n${diagnosticOutput(evaluated).slice(-8_000)}`);
  return performanceBisectReportSchema.parse({
    schemaVersion: 1,
    good: parsed.good,
    bad: parsed.bad,
    firstBadCommit,
    candidateCommits,
    evaluator: options.evaluator,
    outputTail: diagnosticOutput(evaluated).slice(-8_000),
  });
}

export function createPerformanceBisectPlan(options: {
  good: string;
  bad: string;
  scenarioId: string;
  baselineSource: { flag: '--baseline' | '--history'; path: string };
}): PerformanceBisectPlan {
  return performanceBisectPlanSchema.parse({
    schemaVersion: 1,
    dryRun: true,
    ...options,
    commands: [
      { command: 'git', args: ['bisect', 'start', options.bad, options.good] },
      {
        command: 'git',
        args: [
          'bisect',
          'run',
          'bun',
          'perf',
          'run',
          options.scenarioId,
          options.baselineSource.flag,
          options.baselineSource.path,
          '--profile',
          'development',
        ],
      },
    ],
  });
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function renderBisectPlan(plan: PerformanceBisectPlan): string[] {
  return plan.commands.map(({ command, args }) => [command, ...args].map(quote).join(' '));
}
