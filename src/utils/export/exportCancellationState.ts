export const resolveExportCancellationPending = ({
  isExporting,
  requested,
}: {
  isExporting: boolean;
  requested: boolean;
}): boolean => isExporting && requested;
