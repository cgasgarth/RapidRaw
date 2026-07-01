import type { SupportedTypes } from '../../components/ui/AppProperties';

export type NegativeLabSourceReadinessReason = 'loading' | 'empty' | 'unsupported';

export type NegativeLabSourceReadiness =
  | {
      isReady: true;
      reason: null;
      targetPaths: string[];
      unsupportedPaths: [];
    }
  | {
      isReady: false;
      reason: NegativeLabSourceReadinessReason;
      targetPaths: [];
      unsupportedPaths: string[];
    };

export const negativeLabSourceReasonKeys = {
  empty: 'negativeLabEntryPoints.disabled.noSelection',
  loading: 'negativeLabEntryPoints.disabled.loading',
  unsupported: 'negativeLabEntryPoints.disabled.unsupported',
} as const satisfies Record<NegativeLabSourceReadinessReason, string>;

export const negativeLabCommandPaletteReasonKeys = {
  empty: 'modals.commandPalette.unavailable.selectSource',
  loading: 'modals.commandPalette.unavailable.negativeLabLoading',
  unsupported: 'modals.commandPalette.unavailable.negativeLabUnsupported',
} as const satisfies Record<NegativeLabSourceReadinessReason, string>;

export type NegativeLabDisabledReasonKey =
  (typeof negativeLabSourceReasonKeys)[keyof typeof negativeLabSourceReasonKeys];

export type NegativeLabCommandPaletteDisabledReasonKey =
  (typeof negativeLabCommandPaletteReasonKeys)[keyof typeof negativeLabCommandPaletteReasonKeys];

export const getNegativeLabDisabledReasonKey = (
  readiness: NegativeLabSourceReadiness,
): NegativeLabDisabledReasonKey | null =>
  readiness.reason === null ? null : negativeLabSourceReasonKeys[readiness.reason];

export const getNegativeLabCommandPaletteDisabledReasonKey = (
  readiness: NegativeLabSourceReadiness,
): NegativeLabCommandPaletteDisabledReasonKey | null =>
  readiness.reason === null ? null : negativeLabCommandPaletteReasonKeys[readiness.reason];

export function getNegativeLabSourceReadiness(
  paths: string[],
  supportedTypes: SupportedTypes | null,
): NegativeLabSourceReadiness {
  const targetPaths = Array.from(new Set(paths.filter((path) => path.trim().length > 0)));

  if (targetPaths.length === 0) {
    return { isReady: false, reason: 'empty', targetPaths: [], unsupportedPaths: [] };
  }

  if (!supportedTypes) {
    return { isReady: false, reason: 'loading', targetPaths: [], unsupportedPaths: targetPaths };
  }

  const unsupportedPaths = targetPaths.filter((path) => !isNegativeLabSupportedSourcePath(path, supportedTypes));

  if (unsupportedPaths.length > 0) {
    return { isReady: false, reason: 'unsupported', targetPaths: [], unsupportedPaths };
  }

  return { isReady: true, reason: null, targetPaths, unsupportedPaths: [] };
}

export function isNegativeLabSupportedSourcePath(path: string, supportedTypes: SupportedTypes): boolean {
  const extension = getSourceExtension(path);
  if (!extension) return false;
  const supportedExtensions = new Set([...supportedTypes.raw, ...supportedTypes.nonRaw].map(normalizeExtension));
  return supportedExtensions.has(extension);
}

function getSourceExtension(path: string): string | null {
  const normalizedPath = path.split(/[?#]/u)[0] ?? path;
  const filename = normalizedPath.split(/[\\/]/u).pop() ?? normalizedPath;
  const extension = filename.includes('.') ? filename.split('.').pop() : null;
  return extension ? normalizeExtension(extension) : null;
}

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\./u, '').toLowerCase();
}
