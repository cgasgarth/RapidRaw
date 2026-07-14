import { z } from 'zod';
import { type CatalogIndexingAuthority, catalogIndexingAuthoritySchema } from '../schemas/catalogIndexingSchemas';
import { Invokes } from '../tauri/commands';
import { invokeWithSchema } from './tauriSchemaInvoke';

export const startBackgroundIndexingWithSchema = (folderPath: string): Promise<CatalogIndexingAuthority> =>
  invokeWithSchema(
    Invokes.StartBackgroundIndexing,
    { folderPath },
    catalogIndexingAuthoritySchema,
    Invokes.StartBackgroundIndexing,
  );

export const cancelBackgroundIndexingWithSchema = (authority: CatalogIndexingAuthority): Promise<boolean> =>
  invokeWithSchema(
    Invokes.CancelBackgroundIndexing,
    { authority: catalogIndexingAuthoritySchema.parse(authority) },
    z.boolean(),
    Invokes.CancelBackgroundIndexing,
  );
