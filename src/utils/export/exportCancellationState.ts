import { z } from 'zod';

export const exportCancellationAckSchema = z
  .object({
    activeJobId: z.string().startsWith('export-job:'),
    cancellationRequested: z.literal(true),
    taskAttached: z.boolean(),
    tokenObserved: z.literal(true),
  })
  .strict();

export type ExportCancellationAck = z.infer<typeof exportCancellationAckSchema>;

export const resolveExportCancellationPending = ({
  isExporting,
  requested,
}: {
  isExporting: boolean;
  requested: boolean;
}): boolean => isExporting && requested;
