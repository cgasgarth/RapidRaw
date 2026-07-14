import { create } from 'zustand';

import type { OperationLaunch } from '../workflows/operationLifecycle';

export const OPERATION_KINDS = [
  'hdr',
  'panorama',
  'focusStack',
  'superResolution',
  'denoise',
  'negativeLab',
  'culling',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

interface OperationLaunchState {
  launches: Partial<Record<OperationKind, OperationLaunch>>;
  close: (kind: OperationKind, launchId: string) => void;
  launch: (kind: OperationKind, sourcePaths: readonly string[], openedAtRevision: number) => OperationLaunch;
}

const createLaunchId = (kind: OperationKind, revision: number): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `operation:${kind}:${String(revision)}:${randomId ?? String(Date.now())}`;
};

export const useOperationLaunchStore = create<OperationLaunchState>((set) => ({
  launches: {},
  close: (kind, launchId) => {
    set((state) =>
      state.launches[kind]?.launchId === launchId ? { launches: { ...state.launches, [kind]: undefined } } : state,
    );
  },
  launch: (kind, sourcePaths, openedAtRevision) => {
    const launch: OperationLaunch = {
      kind,
      launchId: createLaunchId(kind, openedAtRevision),
      openedAtRevision,
      sourcePaths: [...new Set(sourcePaths)],
    };
    set((state) => ({ launches: { ...state.launches, [kind]: launch } }));
    return launch;
  },
}));

export const isCurrentOperationLaunch = (kind: OperationKind, launchId: string): boolean =>
  useOperationLaunchStore.getState().launches[kind]?.launchId === launchId;
