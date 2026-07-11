import { readFileSync } from 'node:fs';
import { computationalMergeProgressV1Schema } from '../../../../packages/rawengine-schema/src/computational-merge/computationalMergeFoundationSchemas';

const hash = `blake3:${'a'.repeat(64)}`;
const progress = {
  completedUnits: 1,
  completedWeight: 90,
  family: 'super_resolution',
  fraction: 0.9,
  jobId: crypto.randomUUID(),
  schemaVersion: 1,
  stage: 'tiles',
  status: 'active',
  totalUnits: 2,
  totalWeight: 100,
};
computationalMergeProgressV1Schema.parse(progress);
if (computationalMergeProgressV1Schema.safeParse({ ...progress, sourcePath: '/guessable' }).success)
  throw new Error('progress accepted an unknown field');
const runtime = readFileSync('src-tauri/src/merge/super_resolution/runtime.rs', 'utf8');
if (runtime.includes('super_resolution_registration_job') || !runtime.includes('computational_merge_jobs'))
  throw new Error('SR registration did not migrate to the neutral registry');
const registry = readFileSync('src-tauri/src/merge/computational_job.rs', 'utf8');
for (const requirement of ['CancelRequested', 'terminal_capacity', 'completed_weight', 'Uuid::new_v4'])
  if (!registry.includes(requirement)) throw new Error(`native registry is missing ${requirement}`);
void hash;
console.log('computational merge native job runtime contract: ok');
