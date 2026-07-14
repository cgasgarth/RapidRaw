import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type PerformanceJob = { if?: string; strategy?: { 'max-parallel'?: number } };
type PerformanceWorkflow = {
  on?: { push?: unknown; pull_request?: unknown; schedule?: unknown; workflow_dispatch?: unknown };
  jobs?: Record<string, PerformanceJob>;
};

const workflow = Bun.YAML.parse(
  readFileSync(join(process.cwd(), '.github/workflows/performance.yml'), 'utf8'),
) as PerformanceWorkflow;
const jobs = workflow.jobs ?? {};
const exhaustive = jobs['performance-lab'];
const smoke = jobs['performance-smoke'];

if (!workflow.on?.push || !workflow.on.pull_request || !workflow.on.schedule || !workflow.on.workflow_dispatch) {
  throw new Error('performance workflow must retain main, PR smoke, scheduled, and manual entry points');
}
if (exhaustive?.if !== "${{ github.event_name != 'pull_request' }}") {
  throw new Error('exhaustive performance matrix must be excluded from pull_request runs');
}
if (exhaustive.strategy?.['max-parallel'] !== 2) {
  throw new Error('exhaustive performance matrix must reserve runner capacity with max-parallel: 2');
}
if (smoke?.if !== undefined) {
  throw new Error('performance smoke must remain available on pull_request runs');
}

console.log('performance workflow routing contract ok (PR smoke, non-PR exhaustive matrix)');
