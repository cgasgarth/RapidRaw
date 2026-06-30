import type {
  ComputationalMergeAppServerRoute,
  ComputationalMergeAppServerRouteFamily,
} from '../../schemas/computational-merge/computationalMergeAppServerSchemas';
import { computationalMergeAppServerRouteManifestSchema } from '../../schemas/computational-merge/computationalMergeAppServerSchemas';
import {
  COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA,
  getComputationalMergeAppServerRoutePairData,
} from './computationalMergeAppServerRouteManifestData';

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
