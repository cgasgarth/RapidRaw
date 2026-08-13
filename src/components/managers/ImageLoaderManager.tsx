import type { RefObject } from 'react';
import { useImageLoader } from '../../hooks/useImageLoader';
import type { ImageCacheEntry } from '../../utils/ImageLRUCache';

interface Props {
  cachedEditStateRef: RefObject<ImageCacheEntry | null>;
}

export default function ImageLoaderManager({ cachedEditStateRef }: Props) {
  useImageLoader(cachedEditStateRef);

  return null;
}
