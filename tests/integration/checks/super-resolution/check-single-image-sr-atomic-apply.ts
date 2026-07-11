import {
  singleImageX2ApplyReceiptSchema,
  singleImageX2BatchReceiptSchema,
} from '../../../../src/schemas/computational-merge/singleImageX2Schemas';

const output = singleImageX2ApplyReceiptSchema.parse({
  schemaVersion: 1,
  jobId: 'b9da18fd-6460-4ae6-a3d7-f650e4a72371',
  sourcePath: '/private/source.nef',
  graphRevision: 'history_3',
  reviewHash: `sha256:${'1'.repeat(64)}`,
  modelId: 'swinir-classical-df2k-x2-medium-opset17-v1',
  modelSha256: 'verified-model-hash',
  width: 12002,
  height: 8002,
  payloadPath: '/private/source-Enhanced-x2.rrsr/payload.tiff',
  package: {
    schemaVersion: 1,
    stagingIdentity: '.source-Enhanced-x2.rrsr.staging-id',
    finalPackagePath: '/private/source-Enhanced-x2.rrsr',
    manifestHash: `blake3:${'2'.repeat(64)}`,
    inventoryHash: `blake3:${'3'.repeat(64)}`,
    payloadHash: `blake3:${'4'.repeat(64)}`,
    mapHashes: [`blake3:${'5'.repeat(64)}`],
    commitStatus: 'committed',
    recoveryAction: null,
  },
});

const batch = singleImageX2BatchReceiptSchema.parse({
  schemaVersion: 1,
  executionPolicy: 'sequential_one_active_item',
  items: [
    { sourcePath: output.sourcePath, status: 'complete', output, error: null },
    {
      sourcePath: '/private/stale.nef',
      status: 'failed',
      output: null,
      error: 'single_image_x2_stale_graph_revision',
    },
  ],
});

if (batch.items[0]?.output?.package.commitStatus !== 'committed') {
  throw new Error('Atomic apply receipt did not preserve committed package state.');
}
if (batch.items[1]?.error !== 'single_image_x2_stale_graph_revision') {
  throw new Error('Batch receipt did not preserve the stable source-staleness reason.');
}

console.log('single-image SR atomic apply contracts ok');
