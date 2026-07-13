import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Step = {
  env?: Record<string, string>;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string | number>;
};
type Job = { if?: string; needs?: string[]; 'runs-on'?: string; steps?: Step[] };
type Workflow = { jobs?: Record<string, Job>; on?: Record<string, unknown> };
const ALWAYS = '$' + '{{ always() }}';

function workflow(name: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(process.cwd(), '.github/workflows', name), 'utf8')) as Workflow;
}

function job(document: Workflow, id: string): Job {
  const value = document.jobs?.[id];
  if (!value) throw new Error(`missing workflow job: ${id}`);
  return value;
}

function step(value: Job, name: string): Step {
  const found = value.steps?.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing workflow step: ${name}`);
  return found;
}

function includesAll(value: string | undefined, expected: string[], context: string): void {
  for (const token of expected) {
    if (!value?.includes(token)) throw new Error(`${context} missing ${token}`);
  }
}

function validateUpload(value: Step, retention: number): void {
  if (!value.uses?.startsWith('actions/upload-artifact@')) {
    throw new Error('color lab reports must use pinned upload-artifact');
  }
  if (value.if !== ALWAYS) throw new Error('color lab reports must upload on failure');
  if (value.with?.['retention-days'] !== retention || value.with?.['if-no-files-found'] !== 'error') {
    throw new Error(`color lab artifacts must retain ${retention} days and fail when absent`);
  }
}

const baseline = workflow('lint.yml');
const fast = job(baseline, 'color-lab-fast');
if (!job(baseline, 'pr-ci-required').needs?.includes('color-lab-fast')) {
  throw new Error('PR CI / required must depend on color-lab-fast');
}
const graphInputs = [
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/src/color',
  'src-tauri/src/raw',
  'src-tauri/src/render',
  'src-tauri/src/export',
  'src-tauri/crates/rapidraw-color-reference',
];
includesAll(step(fast, 'Compute affected color graph identity').run, graphInputs, 'fast graph identity');
includesAll(
  step(fast, 'Restore content-addressed color lab cache').with?.key?.toString(),
  ['color-lab-v1-', 'graph_fingerprint'],
  'fast cache key',
);
includesAll(
  step(fast, 'Execute affected color lab').run,
  [
    'run --affected',
    '--cache "$RUNNER_TEMP/color-lab-cache"',
    '.tier == "fast"',
    '.cache == "miss" or .cache == "hit"',
    '.cache_identity.graph_fingerprint == $graph',
  ],
  'fast color lab',
);
validateUpload(step(fast, 'Upload affected color lab reports'), 14);

const full = job(workflow('main-long-validation.yml'), 'color-lab-full');
includesAll(full.if, ["github.event_name == 'schedule'", "github.event_name == 'workflow_dispatch'"], 'full trigger');
includesAll(
  step(full, 'Execute full color lab without cache').run,
  ['run --full --no-cache', '.tier == "full"', '.cache == "bypassed"'],
  'full color lab',
);
includesAll(step(full, 'Execute full color lab without cache').run, graphInputs, 'full graph identity');
validateUpload(step(full, 'Upload full color lab reports'), 30);

const hardwareWorkflow = workflow('color-lab-hardware.yml');
if (
  !hardwareWorkflow.on ||
  !Object.hasOwn(hardwareWorkflow.on, 'workflow_dispatch') ||
  Object.keys(hardwareWorkflow.on).length !== 1
) {
  throw new Error('hardware color lab must be workflow_dispatch only');
}
const hardware = job(hardwareWorkflow, 'color-lab-hardware');
if (hardware['runs-on'] !== 'macos-14') throw new Error('hardware color lab must use macOS');
const differential = step(hardware, 'Measure native backend identity and differential tolerances');
includesAll(
  differential.run,
  [
    'backend_differential_tests::native_cpu_wgpu_backend_differential_matches_independent_f64_oracle',
    '--features validation-harness',
  ],
  'hardware differential',
);
if (!differential.env?.RAWENGINE_COLOR_BACKEND_PROOF_PATH) {
  throw new Error('hardware differential must emit an identity-bearing proof');
}
includesAll(
  step(hardware, 'Execute color lab with measured hardware identity').run,
  graphInputs,
  'hardware graph identity',
);
includesAll(
  step(hardware, 'Execute color lab with measured hardware identity').run,
  [
    'run --hardware --no-cache',
    "backend=\"$(jq -r '.backend'",
    "device=\"$(jq -r '.adapter_name'",
    '.cache_identity.hardware == {backend: $backend, vendor: $vendor, device: $device, driver: $driver}',
  ],
  'hardware color lab',
);
validateUpload(step(hardware, 'Upload hardware-bound color lab reports'), 30);

console.log('Validated color-lab tier, cache, identity, required-gate, and artifact policies.');
