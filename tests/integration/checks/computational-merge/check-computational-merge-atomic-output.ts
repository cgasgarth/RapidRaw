import { readFileSync } from 'node:fs';
import { computationalMergeRuntimeReceiptV1Schema } from '../../../../packages/rawengine-schema/src/computational-merge/computationalMergeFoundationSchemas';

const hash = `blake3:${'b'.repeat(64)}`;
const receipt = {
  cancellationStage: null,
  commit: {
    commitStatus: 'committed',
    finalPackagePath: '/tmp/result.rrmerge',
    inventoryHash: hash,
    manifestHash: hash,
    mapHashes: [hash],
    payloadHash: hash,
    recoveryAction: null,
    stagingIdentity: '.result.staging-id',
  },
  family: 'focus_stack',
  observedPeakMemoryBytes: 1024,
  observedTileCount: 2,
  planHash: hash,
  receiptVersion: 1,
  sourceImmutabilityHashes: [hash],
  stageTimings: [{ elapsedMs: 1, stage: 'tiles' }],
  status: 'succeeded',
};
computationalMergeRuntimeReceiptV1Schema.parse(receipt);
if (computationalMergeRuntimeReceiptV1Schema.safeParse({ ...receipt, jobId: 'volatile' }).success)
  throw new Error('receipt accepted a volatile unknown field');
const transaction = readFileSync('src-tauri/src/merge/atomic_derived_output.rs', 'utf8');
for (const requirement of [
  'create_new(true)',
  'COMMIT_READY',
  'sync_all',
  'unregistered',
  'recover_atomic_derived_outputs',
  'AtomicOutputFault::Registration',
])
  if (!transaction.includes(requirement)) throw new Error(`atomic output transaction is missing ${requirement}`);
console.log('computational merge atomic output contract: ok');
