import { z } from 'zod';
import {
  type ThumbnailOperationAuthority,
  thumbnailOperationAuthoritySchema,
} from '../schemas/thumbnailOperationSchemas';
import { Invokes } from '../tauri/commands';
import type { ThumbnailBackendRequest } from '../thumbnails/ThumbnailDemandScheduler';
import { invokeWithSchema } from './tauriSchemaInvoke';

export const updateThumbnailQueueWithSchema = (
  request: ThumbnailBackendRequest,
): Promise<ThumbnailOperationAuthority> =>
  invokeWithSchema(
    Invokes.UpdateThumbnailQueue,
    { request },
    thumbnailOperationAuthoritySchema,
    Invokes.UpdateThumbnailQueue,
  );

export const cancelThumbnailGenerationWithSchema = (authority: ThumbnailOperationAuthority): Promise<boolean> =>
  invokeWithSchema(
    Invokes.CancelThumbnailGeneration,
    thumbnailOperationAuthoritySchema.parse(authority),
    z.boolean(),
    Invokes.CancelThumbnailGeneration,
  );
