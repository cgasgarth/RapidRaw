import { z } from 'zod';

export const thumbnailOperationAuthoritySchema = z
  .object({
    generation: z.number().int().nonnegative(),
    operationId: z.number().int().positive(),
  })
  .strict();

export type ThumbnailOperationAuthority = z.infer<typeof thumbnailOperationAuthoritySchema>;

export const thumbnailProgressPayloadSchema = thumbnailOperationAuthoritySchema
  .extend({
    current: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .loose();

export const thumbnailErrorPayloadSchema = thumbnailOperationAuthoritySchema
  .extend({
    message: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

export const isCurrentThumbnailAuthority = (
  incoming: ThumbnailOperationAuthority,
  current: ThumbnailOperationAuthority | null,
): boolean =>
  current !== null && incoming.generation === current.generation && incoming.operationId === current.operationId;

export const shouldAcceptThumbnailAuthority = (
  incoming: ThumbnailOperationAuthority,
  current: ThumbnailOperationAuthority | null,
): boolean =>
  current === null ||
  incoming.generation > current.generation ||
  (incoming.generation === current.generation && incoming.operationId >= current.operationId);
