import type { NegativeLabRuntimeProfileBrowserRow } from '../../schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import {
  buildNegativeLabRuntimeProfileBrowserRows,
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
  type NegativeLabRuntimeProfileCatalog,
} from './negativeLabMeasuredProfileRuntime';

export const buildNegativeLabProfileBrowserRows = (
  catalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabRuntimeProfileBrowserRow[] => buildNegativeLabRuntimeProfileBrowserRows(catalog);
