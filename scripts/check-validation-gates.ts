#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, 'docs/ci/validation-gates.json');
const PACKAGE_PATH = join(ROOT, 'package.json');
const WORKFLOW_PATH = join(ROOT, '.github/workflows/lint.yml');
const DEFAULT_AGGREGATE_JOB_ID = 'pr-ci-required';

const gateSchema = z.object({
  id: z.string().min(1),
  packageScript: z.string().min(1),
  ciJobId: z.string().min(1),
  ciJobName: z.string().min(1),
  cadence: z.enum(['local', 'pr-main-manual', 'main-manual', 'manual']),
  proofType: z.enum([
    'build',
    'compile',
    'dependency',
    'docs',
    'drift',
    'format',
    'i18n',
    'license',
    'lint',
    'path-routing',
    'policy',
    'schema',
    'security',
    'supply-chain',
    'typecheck',
    'workflow',
  ]),
  prRequired: z.boolean(),
});

const manifestSchema = z.object({
  version: z.literal(1),
  aggregateJobId: z.string().min(1).default(DEFAULT_AGGREGATE_JOB_ID),
  gates: z.array(gateSchema).min(1),
});

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
});

const workflowSchema = z.object({
  jobs: z.record(z.string(), z.unknown()),
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(violations) {
  if (violations.length === 0) return;

  console.error('validation gates failed');
  console.error(violations.slice(0, 40).join('\n'));
  if (violations.length > 40) {
    console.error(`... ${violations.length - 40} more`);
  }
  process.exit(1);
}

function getObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function getJobName(job) {
  const object = getObject(job);
  const name = object?.name;
  return typeof name === 'string' ? name : '';
}

function getNeeds(job) {
  const object = getObject(job);
  const needs = object?.needs;

  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs) && needs.every((value) => typeof value === 'string')) return needs;

  return [];
}

function checkValidationGates({ manifest, packageJson, workflow }) {
  const violations = [];
  const ids = new Set();
  const scripts = packageJson.scripts;
  const jobs = workflow.jobs;
  const aggregateJob = jobs[manifest.aggregateJobId];
  const aggregateNeeds = new Set(getNeeds(aggregateJob));

  for (const gate of manifest.gates) {
    if (ids.has(gate.id)) {
      violations.push(`${gate.id}: duplicate gate id`);
    }
    ids.add(gate.id);

    if (!scripts[gate.packageScript]) {
      violations.push(`${gate.id}: missing package script "${gate.packageScript}"`);
    }

    const job = jobs[gate.ciJobId];
    if (!job) {
      violations.push(`${gate.id}: missing CI job "${gate.ciJobId}"`);
      continue;
    }

    const jobName = getJobName(job);
    if (jobName !== gate.ciJobName) {
      violations.push(`${gate.id}: CI job "${gate.ciJobId}" name is "${jobName}", expected "${gate.ciJobName}"`);
    }

    if (gate.prRequired && !aggregateNeeds.has(gate.ciJobId)) {
      violations.push(`${gate.id}: PR-required job "${gate.ciJobId}" is missing from ${manifest.aggregateJobId}.needs`);
    }
  }

  return violations;
}

function readRepositoryInputs() {
  const manifest = manifestSchema.parse(readJson(MANIFEST_PATH));
  const packageJson = packageSchema.parse(readJson(PACKAGE_PATH));
  const workflow = workflowSchema.parse(yaml.load(readFileSync(WORKFLOW_PATH, 'utf8')));

  return { manifest, packageJson, workflow };
}

function runSelfTest() {
  const manifest = manifestSchema.parse({
    version: 1,
    aggregateJobId: 'required',
    gates: [
      {
        id: 'gate',
        packageScript: 'check:gate',
        ciJobId: 'gate-job',
        ciJobName: 'gate job',
        cadence: 'pr-main-manual',
        proofType: 'lint',
        prRequired: true,
      },
    ],
  });
  const packageJson = packageSchema.parse({ scripts: { 'check:gate': 'bun test' } });
  const workflow = workflowSchema.parse({
    jobs: {
      'gate-job': { name: 'gate job' },
      required: { needs: ['gate-job'] },
    },
  });

  const cases = [
    {
      name: 'valid manifest passes',
      input: { manifest, packageJson, workflow },
      expected: 0,
    },
    {
      name: 'missing script fails',
      input: { manifest, packageJson: { scripts: {} }, workflow },
      expected: 1,
    },
    {
      name: 'missing job fails',
      input: { manifest, packageJson, workflow: { jobs: { required: { needs: ['gate-job'] } } } },
      expected: 1,
    },
    {
      name: 'missing aggregate need fails',
      input: {
        manifest,
        packageJson,
        workflow: { jobs: { 'gate-job': { name: 'gate job' }, required: { needs: [] } } },
      },
      expected: 1,
    },
    {
      name: 'wrong job name fails',
      input: {
        manifest,
        packageJson,
        workflow: { jobs: { 'gate-job': { name: 'wrong' }, required: { needs: ['gate-job'] } } },
      },
      expected: 1,
    },
  ];

  for (const testCase of cases) {
    const violations = checkValidationGates(testCase.input);
    if (violations.length !== testCase.expected) {
      console.error(`${testCase.name}: expected ${testCase.expected}, got ${violations.length}`);
      if (violations.length) console.error(violations.join('\n'));
      process.exit(1);
    }
  }

  console.log(`validation gates self-test ok (${cases.length})`);
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const inputs = readRepositoryInputs();
  const violations = checkValidationGates(inputs);
  fail(violations);
  console.log(`validation gates ok (${inputs.manifest.gates.length})`);
}
