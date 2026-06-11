import { z } from 'zod';
import type { Album, AlbumGroup, AlbumItem } from '../components/ui/AppProperties';

type AlbumPayload = Omit<Album, 'icon'> & { icon?: string | undefined };
type AlbumGroupPayload = Omit<AlbumGroup, 'children' | 'icon'> & {
  children: AlbumItemPayload[];
  icon?: string | undefined;
};
type AlbumItemPayload = AlbumPayload | AlbumGroupPayload;

const albumBaseSchema = z
  .object({
    icon: z.string().optional(),
    id: z.string(),
    name: z.string(),
  })
  .passthrough();

export const albumItemPayloadSchema: z.ZodType<AlbumItemPayload> = z.lazy(() =>
  z.union([
    albumBaseSchema
      .extend({
        images: z.array(z.string()),
        type: z.literal('album'),
      })
      .passthrough(),
    albumBaseSchema
      .extend({
        children: z.array(albumItemPayloadSchema),
        type: z.literal('group'),
      })
      .passthrough(),
  ]),
);

export const albumItemsSchema = z.array(albumItemPayloadSchema);

const normalizeAlbumItem = (item: AlbumItemPayload): AlbumItem => {
  if (item.type === 'album') {
    const album: Album = {
      id: item.id,
      images: item.images,
      name: item.name,
      type: 'album',
    };
    if (item.icon !== undefined) {
      album.icon = item.icon;
    }
    return album;
  }

  const group: AlbumGroup = {
    children: item.children.map(normalizeAlbumItem),
    id: item.id,
    name: item.name,
    type: 'group',
  };
  if (item.icon !== undefined) {
    group.icon = item.icon;
  }
  return group;
};

export const parseAlbumItems = (value: unknown): AlbumItem[] => albumItemsSchema.parse(value).map(normalizeAlbumItem);
