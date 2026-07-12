import type { ImageOpenUpdate } from '../schemas/imageLoaderSchemas';

export function isImageOpenUpdateCurrent(
  update: ImageOpenUpdate,
  expected: { generation: number; path: string },
): boolean {
  return update.path === expected.path && update.sessionId.selectionGeneration === expected.generation;
}
