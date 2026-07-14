import type { ImportJobAuthority } from '../schemas/fileOperationSchemas';

export const isCurrentImportAuthority = (
  event: ImportJobAuthority,
  current: { generation?: number; jobId?: string },
): boolean => event.generation === current.generation && event.jobId === current.jobId;

export const shouldAcceptImportStart = (
  incoming: ImportJobAuthority,
  current: { generation?: number; jobId?: string },
): boolean => {
  if (current.generation === undefined || current.jobId === undefined) return true;
  if (isCurrentImportAuthority(incoming, current)) return true;
  return incoming.generation > current.generation;
};
