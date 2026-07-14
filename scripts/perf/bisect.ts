import { spawn } from 'node:child_process';
import { z } from 'zod';
import { isolatedGitEnvironment } from '../lib/ci/git-environment';
import { acquireResourceLease } from '../lib/ci/resource-coordinator';

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
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: isolatedGitEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pid = child.pid;
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  let settled = false;
  const exited = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (exitCode) => {
      setImmediate(() => {
        settled = true;
        resolveExit(exitCode);
      });
    });
  });
  let cancelled = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    cancelled = true;
    if (pid !== undefined) signalProcessGroup(pid, 'SIGTERM');
    escalation = setTimeout(() => {
      if (pid !== undefined && !settled) signalProcessGroup(pid, 'SIGKILL');
    }, 1_000);
    escalation.unref();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const exitCode = await exited;
    if (cancelled) throw new Error('performance_bisect_cancelled');
    return { exitCode, output: stdout.trim(), stderr: stderr.trim() };
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (escalation !== undefined) clearTimeout(escalation);
    if (!settled && pid !== undefined) {
      signalProcessGroup(pid, 'SIGTERM');
      const stopped = await Promise.race([
        exited.then(
          () => true,
          () => true,
        ),
        Bun.sleep(1_000).then(() => false),
      ]);
      if (!stopped) signalProcessGroup(pid, 'SIGKILL');
      await exited.catch(() => undefined);
    }
    child.stdout.destroy();
    child.stderr.destroy();
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
  coordination?: { root?: string; onQueued?: () => void };
}): Promise<PerformanceBisectReport> {
  const parsed = z
    .object({ cwd: z.string().startsWith('/'), good: shaSchema, bad: shaSchema })
    .parse({ cwd: options.cwd, good: options.good, bad: options.bad });
  try {
    const lease = await acquireResourceLease({
      label: 'performance-bisect',
      onQueued: options.coordination?.onQueued,
      resource: 'native-heavy',
      root: options.coordination?.root,
      signal: options.signal,
    });
    try {
      const status = await run(parsed.cwd, 'git', ['status', '--porcelain=v1'], options.signal);
      if (status.exitCode !== 0 || status.output !== '')
        throw new Error('Performance bisect requires a clean worktree.');
      const started = await run(parsed.cwd, 'git', ['bisect', 'start', parsed.bad, parsed.good], options.signal);
      if (started.exitCode !== 0)
        throw new Error(`git bisect start failed:\n${diagnosticOutput(started).slice(-8_000)}`);
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
    } finally {
      await lease.release();
    }
  } catch (error) {
    if (options.signal?.aborted) throw new Error('performance_bisect_cancelled');
    throw error;
  }
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
