import {
  NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
  buildNegativeLabRuntimeProfileBrowserRows,
  type NegativeLabRuntimeProfileCatalog,
} from './negativeLabMeasuredProfileRuntime';

import type { NegativeLabRuntimeProfileBrowserRow } from '../schemas/negativeLabMeasuredProfileSchemas';

export const buildNegativeLabProfileBrowserRows = (
  catalog: NegativeLabRuntimeProfileCatalog = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG,
): NegativeLabRuntimeProfileBrowserRow[] => buildNegativeLabRuntimeProfileBrowserRows(catalog);
