import type { BrowserContext, Page } from '@playwright/test';

export type QaIsolation = 'fresh-page' | 'fresh-context' | 'fresh-app-session' | 'exclusive-native';

export interface QaFixtureSpec {
  id: 'empty' | 'library' | 'editor';
}

export interface QaScenarioContext {
  baseUrl: string;
  context: BrowserContext;
  page: Page;
}

export interface QaScenario {
  id: string;
  tags: readonly string[];
  dependencies: readonly string[];
  fixture: QaFixtureSpec;
  isolation: QaIsolation;
  timeoutMs: number;
  run(context: QaScenarioContext): Promise<void>;
}

export interface QaScenarioResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
  screenshot?: string;
}

export interface QaRunReceipt {
  schemaVersion: 1;
  runId: string;
  gitSha: string;
  worktree: string;
  dirtyDigest: string;
  buildIdentity: string;
  browserVersion: string;
  platform: string;
  shard: { index: number; total: number };
  startedAt: string;
  endedAt: string;
  scenarios: QaScenarioResult[];
  rerunCommand: string;
}
