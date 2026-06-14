#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { exportQueueSchema, parseExportQueue } from '../src/schemas/exportQueueSchemas.ts';

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
