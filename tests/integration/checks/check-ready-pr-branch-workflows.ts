import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Workflow = {
  concurrency?: { group?: string };
  jobs?: Record<
    string,
    {
      if?: string;
      steps?: Array<{ env?: Record<string, string>; run?: string }>;
    }
  >;
  on?: {
    push?: { branches?: string[] };
    workflow_dispatch?: { inputs?: Record<string, unknown> };
    workflow_run?: { types?: string[]; workflows?: string[] };
  };
  permissions?: Record<string, string>;
};

const readWorkflow = (name: string): Workflow =>
  Bun.YAML.parse(readFileSync(join(process.cwd(), '.github/workflows', name), 'utf8')) as Workflow;

const updater = readWorkflow('update-open-pr-branches.yml');
if (updater.permissions?.actions !== 'write' || updater.permissions?.contents !== 'write') {
  throw new Error('ready PR updater requires actions and contents write permissions');
}
if (updater.permissions['pull-requests'] !== 'read') {
  throw new Error('ready PR updater must retain read-only pull request access');
}
if (!updater.on?.push?.branches?.includes('main')) {
  throw new Error('ready PR updater must react to main freshness changes');
}
const retryWorkflows = updater.on?.workflow_run?.workflows;
const expectedRetryWorkflows = ['Agent source export', 'Performance Regression', 'PR Fast Validation'];
if (
  !retryWorkflows ||
  JSON.stringify([...retryWorkflows].sort()) !== JSON.stringify(expectedRetryWorkflows.sort()) ||
  !updater.on?.workflow_run?.types?.includes('completed')
) {
  throw new Error('active-check skips must retry after required workflow completion');
}
const updaterStep = updater.jobs?.update?.steps?.find((step) => step.run);
const updaterRun = updaterStep?.run;
if (updaterRun !== 'bun scripts/ci/update-ready-pr-branches.ts') {
  throw new Error('ready PR updater must execute the tested branch freshness implementation');
}
if (updaterStep?.env?.GITHUB_TOKEN !== '${{ github.token }}') {
  throw new Error('ready PR updater must use the repository workflow token');
}

const required = readWorkflow('lint.yml');
const inputs = required.on?.workflow_dispatch?.inputs;
for (const input of ['base_sha', 'expected_head_sha', 'pull_request_number']) {
  if (!(input in (inputs ?? {}))) throw new Error(`PR Fast dispatch is missing ${input}`);
}
if (!required.concurrency?.group?.includes('inputs.pull_request_number')) {
  throw new Error('dispatched required checks must retain per-PR concurrency isolation');
}
const planEnvironment = required.jobs?.plan?.steps?.find((step) => step.env?.HEAD_SHA)?.env;
if (
  planEnvironment?.BASE_SHA !== '${{ github.event.pull_request.base.sha || inputs.base_sha }}' ||
  planEnvironment.EXPECTED_HEAD_SHA !== '${{ inputs.expected_head_sha }}'
) {
  throw new Error('dispatched required checks must bind their immutable base and head identities');
}
if (!required.jobs?.['pr-ci-required']?.if?.includes("inputs.pull_request_number != ''")) {
  throw new Error('PR CI / required must run for updater-dispatched PR validation');
}

console.log('ready PR branch workflow contract ok');
