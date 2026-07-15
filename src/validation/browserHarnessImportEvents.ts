import {
  type ImportJobAuthority,
  importJobAuthoritySchema,
  importJobReceiptSchema,
} from '../schemas/fileOperationSchemas';
import {
  importProgressPayloadSchema,
  importStartPayloadSchema,
  importTerminalPayloadSchema,
} from '../schemas/tauriEventSchemas';

const BYTES_PER_SOURCE = 24_000_000;

export function createBrowserHarnessImportLifecycle(options: {
  destinationFolder: string;
  generation: number;
  jobId: string;
  sourcePaths: readonly string[];
}) {
  const authority: ImportJobAuthority = importJobAuthoritySchema.parse({
    generation: options.generation,
    jobId: options.jobId,
  });
  const destinations = options.sourcePaths.map(
    (sourcePath, index) =>
      `${options.destinationFolder}/${sourcePath.split('/').at(-1) ?? `import-${String(index + 1)}.ARW`}`,
  );
  const totalBytes = options.sourcePaths.length * BYTES_PER_SOURCE;
  const start = importStartPayloadSchema.parse({ ...authority, total: options.sourcePaths.length });
  const progress = options.sourcePaths.map((sourcePath, index) => {
    const current = index + 1;
    return importProgressPayloadSchema.parse({
      ...authority,
      bytesCopied: current * BYTES_PER_SOURCE,
      cancelled: 0,
      committed: current,
      committedPath: destinations[index],
      copying: 0,
      current,
      failed: 0,
      inspected: current,
      path: sourcePath,
      stage: 'cataloging',
      total: options.sourcePaths.length,
      totalBytes,
    });
  });
  const receipt = importJobReceiptSchema.parse({
    cancelled: [],
    completed: options.sourcePaths.map((sourcePath, index) => ({
      artifacts: [
        {
          blake3: `blake3:${String(index + 1).padStart(64, '0')}`,
          byteSize: BYTES_PER_SOURCE,
          destination: destinations[index],
        },
      ],
      committedAtMillis: index + 1,
      destination: destinations[index],
      itemId: index,
      source: sourcePath,
      sourceDeleteError: null,
      sourceDeleted: false,
    })),
    diagnostics: {
      cancellationLatencyMillis: null,
      copyConcurrency: 1,
      fullRefreshes: 0,
      maxBufferedBytes: BYTES_PER_SOURCE,
      maxCopyInFlight: 1,
      metadataConcurrency: 1,
      preflightMillis: 0,
      progressEvents: progress.length + 1,
      timeToFirstCommitMillis: progress.length === 0 ? null : 20,
    },
    failed: [],
    jobId: authority.jobId,
    schemaVersion: 1,
    terminalStage: 'completed',
    totalBytes,
  });
  const terminal = importTerminalPayloadSchema.parse({ ...authority, receipt });
  return { authority, destinations, progress, receipt, start, terminal };
}
