import { z } from 'zod';

export const catalogIndexingAuthoritySchema = z
  .object({
    generation: z.number().int().nonnegative(),
    operationId: z.number().int().positive(),
  })
  .strict();

export type CatalogIndexingAuthority = z.infer<typeof catalogIndexingAuthoritySchema>;

export const catalogIndexingSnapshotSchema = z
  .object({
    authority: catalogIndexingAuthoritySchema,
    current: z.number().int().nonnegative(),
    folderPath: z.string().min(1),
    terminalStatus: z.enum(['cancelled', 'completed', 'failed']).nullable(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export type CatalogIndexingSnapshot = z.infer<typeof catalogIndexingSnapshotSchema>;

export const catalogIndexingErrorSchema = z
  .object({
    authority: catalogIndexingAuthoritySchema,
    error: z.string().min(1),
  })
  .strict();

export interface CatalogIndexingViewState {
  authority: CatalogIndexingAuthority | null;
  isIndexing: boolean;
  progress: { current: number; total: number };
}

export const isCurrentCatalogIndexingAuthority = (
  incoming: CatalogIndexingAuthority,
  current: CatalogIndexingAuthority | null,
): boolean =>
  current !== null && incoming.generation === current.generation && incoming.operationId === current.operationId;

export const shouldAcceptCatalogIndexingAuthority = (
  incoming: CatalogIndexingAuthority,
  current: CatalogIndexingAuthority | null,
): boolean =>
  current === null ||
  incoming.generation > current.generation ||
  (incoming.generation === current.generation && incoming.operationId >= current.operationId);

export const reduceCatalogIndexingSnapshot = (
  state: CatalogIndexingViewState,
  snapshot: CatalogIndexingSnapshot,
): CatalogIndexingViewState => {
  if (snapshot.terminalStatus !== null) {
    return isCurrentCatalogIndexingAuthority(snapshot.authority, state.authority)
      ? { authority: null, isIndexing: false, progress: { current: 0, total: 0 } }
      : state;
  }
  if (!shouldAcceptCatalogIndexingAuthority(snapshot.authority, state.authority)) return state;
  return {
    authority: snapshot.authority,
    isIndexing: true,
    progress: { current: snapshot.current, total: snapshot.total },
  };
};
