import { z } from 'zod';

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
