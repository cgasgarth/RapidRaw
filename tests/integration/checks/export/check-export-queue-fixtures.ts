#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  buildExportQueueExecutionPlan,
  exportQueueSchema,
  parseExportQueue,
} from '../../../../src/schemas/export/exportQueueSchemas.ts';

const validQueuePath = 'fixtures/export/export-queue.json';
const invalidCasesPath = 'fixtures/export/invalid-export-queue-cases.json';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const queue = parseExportQueue(await readJson(validQueuePath));
const invalidCases = await readJson(invalidCasesPath);
const failures = [];

const runningJobs = queue.jobs.filter((job) => job.status === 'running');
if (runningJobs.length > queue.maxConcurrentJobs) {
  failures.push(`Running job count ${runningJobs.length} exceeds maxConcurrentJobs ${queue.maxConcurrentJobs}.`);
}

const plan = buildExportQueueExecutionPlan(queue);
if (
  plan.availableSlots !== 0 ||
  plan.activeJobIds.join(',') !== 'export-job-running' ||
  plan.queuedJobIds.join(',') !== 'export-job-queued' ||
  plan.nextJobIds.length !== 0
) {
  failures.push('Concurrency-limited export queue plan did not match fixture expectations.');
}

const drainedQueue = structuredClone(queue);
const runningJob = drainedQueue.jobs.find((job) => job.id === 'export-job-running');
if (runningJob === undefined) {
  failures.push('Running export job fixture is missing.');
} else {
  drainedQueue.activeJobId = null;
  runningJob.completedAt = '2026-06-14T08:06:00.000Z';
  runningJob.progress.current = runningJob.progress.total;
  runningJob.status = 'succeeded';
  const drainedPlan = buildExportQueueExecutionPlan(drainedQueue);
  if (drainedPlan.availableSlots !== 1 || drainedPlan.nextJobIds.join(',') !== 'export-job-queued') {
    failures.push('Drained export queue plan did not select the queued job.');
  }
}

const priorityQueue = structuredClone(queue);
priorityQueue.activeJobId = null;
priorityQueue.maxConcurrentJobs = 2;
for (const job of priorityQueue.jobs) {
  job.completedAt = null;
  job.priority = 'normal';
  job.progress.current = 0;
  job.startedAt = null;
  job.status = 'queued';
}
priorityQueue.jobs.push({
  ...structuredClone(priorityQueue.jobs[1]),
  createdAt: '2026-06-14T08:03:00.000Z',
  id: 'export-job-high-priority',
  priority: 'high',
});
const priorityPlan = buildExportQueueExecutionPlan(priorityQueue);
if (priorityPlan.nextJobIds.join(',') !== 'export-job-high-priority,export-job-running') {
  failures.push('Export queue plan must prefer high priority before normal createdAt order.');
}

for (const invalidCase of invalidCases) {
  const result = exportQueueSchema.safeParse(invalidCase.queue);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed`);
  }
}

if (failures.length > 0) {
  console.error('Export queue fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated export queue with ${queue.jobs.length} jobs and ${invalidCases.length} invalid cases.`);
