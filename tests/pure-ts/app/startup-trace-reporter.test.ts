import { describe, expect, test } from 'bun:test';
import { Invokes } from '../../../src/tauri/commands.ts';
import {
  createFrontendStartupReporter,
  type StartupTraceSnapshot,
} from '../../../src/utils/startup/startupTraceReporter.ts';

const snapshot = (traceId = 'startup:trace-42'): StartupTraceSnapshot => ({
  criticalPathOrderValid: true,
  firstPaintBudgetMet: true,
  firstPaintBudgetMs: 750,
  phases: [],
  processId: 12_345,
  traceId,
});

describe('frontend startup trace reporter', () => {
  test('correlates shell and hydration phases to one native trace in command order', async () => {
    const calls: Array<{ args?: Record<string, unknown>; command: string }> = [];
    const reporter = createFrontendStartupReporter(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ args, command });
      if (command === Invokes.GetStartupTrace) return snapshot() as T;
      if (command === Invokes.RecordFrontendStartupPhase) return snapshot() as T;
      return undefined as T;
    });

    await Promise.all([
      reporter.start(),
      reporter.start(),
      reporter.mark('settingsHydrated', 'ok', 'settings-and-workspace'),
      reporter.mark('libraryReady', 'degraded', 'pinned-trees-unavailable'),
    ]);

    expect(calls.filter(({ command }) => command === Invokes.FrontendReady)).toHaveLength(1);
    expect(calls.filter(({ command }) => command === Invokes.GetStartupTrace)).toHaveLength(1);
    const records = calls.filter(({ command }) => command === Invokes.RecordFrontendStartupPhase);
    expect(records.map(({ args }) => args?.['phase'])).toEqual(['shellVisible', 'settingsHydrated', 'libraryReady']);
    expect(records.every(({ args }) => args?.['traceId'] === 'startup:trace-42')).toBe(true);
    expect(records[2]?.args).toMatchObject({
      detail: 'pinned-trees-unavailable',
      status: 'degraded',
    });
  });

  test('rejects a native response that crosses startup trace identities', async () => {
    const reporter = createFrontendStartupReporter(async <T>(command: string) => {
      if (command === Invokes.GetStartupTrace) return snapshot('startup:expected') as T;
      if (command === Invokes.RecordFrontendStartupPhase) return snapshot('startup:stale') as T;
      return undefined as T;
    });

    await expect(reporter.start()).rejects.toThrow('startup_trace_correlation_mismatch');
  });
});
