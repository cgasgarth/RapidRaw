import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Concurrency = { group?: string; 'cancel-in-progress'?: boolean | string };
type Workflow = { concurrency?: Concurrency };

function readWorkflow(name: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(process.cwd(), '.github/workflows', name), 'utf8')) as Workflow;
}

const main = readWorkflow('main-long-validation.yml').concurrency;
if (main !== undefined) {
  throw new Error('main-long validation must not use workflow concurrency because GitHub replaces older pending runs');
}

const pr = readWorkflow('lint.yml').concurrency;
if (!pr) throw new Error('PR Fast workflow is missing concurrency policy');
if (
  pr.group !==
  'pr-fast-${{ github.event.pull_request.number || inputs.pull_request_number || github.ref }}-${{ github.event.pull_request.head.sha || inputs.expected_head_sha || github.sha }}'
) {
  throw new Error('PR Fast concurrency must remain isolated per pull request/ref and immutable head');
}
if (pr['cancel-in-progress'] !== false) {
  throw new Error('PR Fast must retain every immutable-head run without cancellation');
}
console.log('workflow concurrency contract ok (independent main runs and immutable PR heads)');
