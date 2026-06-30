import { z } from 'zod';

import type { AlbumItem } from '../../components/ui/AppProperties';

const albumSchema: z.ZodType<Extract<AlbumItem, { type: 'album' }>> = z
  .object({
    type: z.literal('album'),
    id: z.string(),
    name: z.string(),
    icon: z.string().optional(),
    images: z.array(z.string()),
  })
  .strict();

const albumGroupSchema: z.ZodType<Extract<AlbumItem, { type: 'group' }>> = z
  .object({
    type: z.literal('group'),
    id: z.string(),
    name: z.string(),
    icon: z.string().optional(),
    children: z.lazy(() => albumTreeSchema),
  })
  .strict();

export const albumItemSchema: z.ZodType<AlbumItem> = z.lazy(() => z.union([albumSchema, albumGroupSchema]));

export const albumTreeSchema = z.array(albumItemSchema);
