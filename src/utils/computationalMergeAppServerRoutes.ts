import {
  COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA,
  getComputationalMergeAppServerRoutePairData,
} from './computationalMergeAppServerRouteManifestData';
import { computationalMergeAppServerRouteManifestSchema } from '../schemas/computationalMergeAppServerSchemas';

import type {
  ComputationalMergeAppServerRoute,
  ComputationalMergeAppServerRouteFamily,
} from '../schemas/computationalMergeAppServerSchemas';

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST = computationalMergeAppServerRouteManifestSchema.parse(
  COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA,
);

export const COMPUTATIONAL_MERGE_APP_SERVER_ROUTES = COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST.routes;

export interface ComputationalMergeAppServerRoutePair {
  apply: ComputationalMergeAppServerRoute;
  dryRun: ComputationalMergeAppServerRoute;
}

export function getComputationalMergeAppServerRoutePair(
  family: ComputationalMergeAppServerRouteFamily,
): ComputationalMergeAppServerRoutePair {
  return getComputationalMergeAppServerRoutePairData(family);
}
