import { invoke } from '@tauri-apps/api/core';
import { Invokes, type AlbumItem } from '../components/ui/AppProperties';
import { parseAlbumItems } from '../schemas/albumSchemas';

export const loadAlbumTree = async (): Promise<AlbumItem[]> =>
  parseAlbumItems(await invoke<unknown>(Invokes.GetAlbums));
