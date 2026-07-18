// biome-ignore-all lint/complexity/useLiteralKeys: mask provider keys intentionally mirror runtime payload names.
import type { MaskContainer } from '../adjustments';
import { toMaskParameterRecord } from './maskParameterAccess';

/** The small, typed identity carried by mask-list and overlay work. */
export interface MaskShellAuthority {
  readonly componentId: string | null;
  readonly imageSessionId: string;
  readonly maskId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export type MaskShellStatus = 'current' | 'pending' | 'error' | 'unavailable';

export const MASK_COMPOSITION_MODES = ['add', 'subtract', 'intersect'] as const;
export type MaskCompositionMode = (typeof MASK_COMPOSITION_MODES)[number];

export const createMaskShellAuthority = (
  input: Omit<MaskShellAuthority, 'componentId'> & { componentId?: string | null },
): MaskShellAuthority => ({
  componentId: input.componentId ?? null,
  imageSessionId: input.imageSessionId,
  maskId: input.maskId,
  sourceIdentity: input.sourceIdentity,
  sourceRevision: input.sourceRevision,
});

export const isMaskShellAuthorityCurrent = (
  authority: MaskShellAuthority | null,
  current: MaskShellAuthority | null,
): boolean => {
  if (authority === null || current === null) return false;
  return (
    authority.componentId === current.componentId &&
    authority.imageSessionId === current.imageSessionId &&
    authority.maskId === current.maskId &&
    authority.sourceIdentity === current.sourceIdentity &&
    authority.sourceRevision === current.sourceRevision
  );
};

const STATUS_VALUES = new Set<MaskShellStatus>(['current', 'pending', 'error', 'unavailable']);

/**
 * Reads optional runtime status metadata without allowing an untyped provider
 * payload to become part of the render authority.
 */
export const readMaskShellStatus = (parameters: unknown, fallback: MaskShellStatus = 'current'): MaskShellStatus => {
  const record = toMaskParameterRecord(parameters);
  const status = record['maskShellStatus'] ?? record['status'];
  if (typeof status === 'string' && STATUS_VALUES.has(status as MaskShellStatus)) {
    return status as MaskShellStatus;
  }
  if (typeof record['errorMessage'] === 'string' && record['errorMessage'].trim().length > 0) return 'error';
  if (typeof record['unavailableReason'] === 'string' && record['unavailableReason'].trim().length > 0)
    return 'unavailable';
  return fallback;
};

export const getMaskCompositionMode = (value: string): MaskCompositionMode => {
  if (value === 'subtract') return 'subtract';
  if (value === 'intersect') return 'intersect';
  return 'add';
};

export const nextMaskCompositionMode = (value: string): MaskCompositionMode => {
  const mode = getMaskCompositionMode(value);
  const index = MASK_COMPOSITION_MODES.indexOf(mode);
  return MASK_COMPOSITION_MODES[(index + 1) % MASK_COMPOSITION_MODES.length] ?? 'add';
};

export interface MaskShellListItem {
  readonly componentCount: number;
  readonly id: string;
  readonly mask: MaskContainer;
  readonly status: MaskShellStatus;
}

export const buildMaskShellListItems = (
  masks: readonly MaskContainer[],
  pendingComponentId: string | null = null,
): MaskShellListItem[] =>
  masks.map((mask) => {
    const pending =
      pendingComponentId !== null && mask.subMasks.some((component) => component.id === pendingComponentId);
    const status = pending
      ? 'pending'
      : mask.subMasks.some((component) => readMaskShellStatus(component.parameters) === 'error')
        ? 'error'
        : mask.subMasks.some((component) => readMaskShellStatus(component.parameters) === 'unavailable')
          ? 'unavailable'
          : 'current';
    return { componentCount: mask.subMasks.length, id: mask.id, mask, status };
  });
