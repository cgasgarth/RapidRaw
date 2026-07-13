import type { BrowserContext, Page } from '@playwright/test';
import type { QaDaemonMetrics } from './daemon-model';

export type QaIsolation = 'fresh-page' | 'fresh-context' | 'fresh-app-session' | 'exclusive-native';

export interface QaFixtureSpec {
  id: 'empty' | 'library' | 'editor';
}

export interface QaScenarioContext {
  baseUrl: string;
  context: BrowserContext;
  page: Page;
  recordArtifact(artifact: QaArtifactRecord): void;
}

export type QaArtifactKind = 'download' | 'json-report' | 'screenshot' | 'terminal-assertion';

export interface QaArtifactContract {
  id: string;
  kind: QaArtifactKind;
  required: boolean;
}

export interface QaArtifactRecord {
  id: string;
  kind: QaArtifactKind;
  path?: string | undefined;
}

export interface QaScenario {
  id: string;
  tags: readonly string[];
  dependencies: readonly string[];
  artifactContracts: readonly QaArtifactContract[];
  fixture: QaFixtureSpec;
  isolation: QaIsolation;
  requiredCapabilities: readonly string[];
  timeoutMs: number;
  run(context: QaScenarioContext): Promise<void>;
}

export interface QaScenarioResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string | undefined;
  screenshot?: string | undefined;
  artifacts?: QaArtifactRecord[] | undefined;
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
  seed: number;
  persistent: boolean;
  startedAt: string;
  endedAt: string;
  scenarios: QaScenarioResult[];
  metrics: QaDaemonMetrics;
  rerunCommand: string;
}
