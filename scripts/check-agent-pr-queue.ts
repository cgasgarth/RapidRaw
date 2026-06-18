#!/usr/bin/env bun

import { z } from 'zod';

const MAX_ACTIVE_PRS = 2;
const textDecoder = new TextDecoder();

const checkSchema = z
  .object({
    conclusion: z.string().nullable().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const prSchema = z
  .object({
    createdAt: z.string(),
    headRefName: z.string(),
    mergeStateStatus: z.string(),
    number: z.number(),
    statusCheckRollup: z.array(checkSchema),
    title: z.string(),
    updatedAt: z.string(),
  })
  .strict();

function run(command: Array<string>): { code: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    code: result.exitCode,
    stderr: textDecoder.decode(result.stderr).trim(),
    stdout: textDecoder.decode(result.stdout).trim(),
  };
}

function ageHours(createdAt: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(createdAt)) / 36_000) / 100);
}

function checkSummary(checks: Array<z.infer<typeof checkSchema>>): string {
  const failures = checks.filter((check) => check.conclusion === 'FAILURE').length;
  const pending = checks.filter((check) => check.status !== 'COMPLETED').length;
  if (failures > 0) return `${failures} fail`;
  if (pending > 0) return `${pending} pending`;
  return 'checks ok';
}

function recommendedAction(pr: z.infer<typeof prSchema>): string {
  const failures = pr.statusCheckRollup.filter((check) => check.conclusion === 'FAILURE').length;
  const pending = pr.statusCheckRollup.filter((check) => check.status !== 'COMPLETED').length;
  if (pr.mergeStateStatus === 'DIRTY') return 'fix conflicts';
  if (pr.mergeStateStatus === 'BEHIND') return 'update branch if required';
  if (failures > 0) return 'fix failing checks';
  if (pending > 0) return 'wait; do not force-push';
  if (pr.mergeStateStatus === 'CLEAN' || pr.mergeStateStatus === 'HAS_HOOKS') return 'merge/auto-merge';
  return 'inspect disposition';
}

const result = run([
  'gh',
  'pr',
  'list',
  '--state',
  'open',
  '--json',
  'number,title,headRefName,createdAt,updatedAt,mergeStateStatus,statusCheckRollup',
  '--limit',
  '100',
]);

if (result.code !== 0) {
  console.error('agent pr queue failed');
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

const parsed = z.array(prSchema).safeParse(JSON.parse(result.stdout || '[]'));
if (!parsed.success) {
  console.error('agent pr queue failed');
  console.error('gh pr list returned an unexpected shape.');
  process.exit(1);
}

if (parsed.data.length === 0) {
  console.log('agent pr queue ok (0 open)');
  process.exit(0);
}

for (const pr of parsed.data) {
  console.log(
    `#${pr.number} ${pr.headRefName} age=${ageHours(pr.createdAt)}h merge=${pr.mergeStateStatus} checks=${checkSummary(
      pr.statusCheckRollup,
    )} next=${recommendedAction(pr)}`,
  );
}

if (parsed.data.length > MAX_ACTIVE_PRS) {
  console.error(`agent pr queue failed: ${parsed.data.length} open PRs > max ${MAX_ACTIVE_PRS}`);
  process.exit(1);
}

console.log(`agent pr queue ok (${parsed.data.length} open)`);
