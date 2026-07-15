import { z } from 'zod';
import {
  type FilmThumbnailRequestV1,
  type FilmThumbnailResultV1,
  filmThumbnailRequestV1Schema,
  filmThumbnailResultV1Schema,
} from '../../packages/rawengine-schema/src/index.js';
import { invokeWithSchema } from '../utils/tauriSchemaInvoke';
import { Invokes } from './commands';

export const renderFilmProfileThumbnail = async (
  rawRequest: FilmThumbnailRequestV1,
): Promise<FilmThumbnailResultV1> => {
  const request = filmThumbnailRequestV1Schema.parse(rawRequest);
  return invokeWithSchema(
    Invokes.RenderFilmProfileThumbnail,
    { request },
    filmThumbnailResultV1Schema,
    'renderer-backed Film thumbnail',
  );
};

export const cancelFilmProfileThumbnail = async (requestId: string): Promise<boolean> =>
  invokeWithSchema(Invokes.CancelFilmProfileThumbnail, { requestId }, z.boolean(), 'Film thumbnail cancellation');

export const releaseFilmProfileThumbnail = async (key: string): Promise<boolean> =>
  invokeWithSchema(Invokes.ReleaseFilmProfileThumbnail, { key }, z.boolean(), 'Film thumbnail pin release');

export const handleFilmThumbnailMemoryPressure = async (): Promise<void> => {
  await invokeWithSchema(Invokes.HandleFilmThumbnailMemoryPressure, {}, z.null(), 'Film thumbnail memory pressure');
};
