import { thumbnailResourceCache } from '../utils/thumbnailResources';
import { ThumbnailCache } from './ThumbnailCache';

export const thumbnailCache = new ThumbnailCache((path) => thumbnailResourceCache.delete(path));
