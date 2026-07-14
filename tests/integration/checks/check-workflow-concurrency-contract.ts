import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Concurrency = { group?: string; 'cancel-in-progress'?: boolean | string };
type Workflow = { concurrency?: Concurrency };

function readWorkflow(name: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(process.cwd(), '.github/workflows', name), 'utf8')) as Workflow;
}

const main = readWorkflow('main-long-validation.yml').concurrency;
if (!main) throw new Error('main-long workflow is missing concurrency policy');
if (main.group !== 'main-long-validation') {
  throw new Error('main-long validation must use one stable serialization group');
}
if (main.group.includes('${{') || main.group.includes('github.run_id')) {
  throw new Error('main-long concurrency group must not vary per workflow run');
}
if (main['cancel-in-progress'] !== false) {
  throw new Error('main-long validation must retain every commit (no cancellation)');
}

const pr = readWorkflow('lint.yml').concurrency;
if (!pr) throw new Error('PR Fast workflow is missing concurrency policy');
if (pr.group !== 'pr-fast-${{ github.event.pull_request.number || github.ref }}') {
  throw new Error('PR Fast concurrency must remain isolated per pull request/ref');
}
if (pr['cancel-in-progress'] !== "${{ github.event_name == 'pull_request' }}") {
  throw new Error('PR Fast cancellation policy changed unexpectedly');
}
if (pr.group === main.group) throw new Error('PR Fast and main-long groups must remain distinct');

console.log('workflow concurrency contract ok (serialized main-long, isolated PR Fast)');
