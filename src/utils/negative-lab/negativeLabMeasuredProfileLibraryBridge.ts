import { z } from 'zod';
import type { NegativeLabMeasuredProfileLibrary } from '../../schemas/negative-lab/negativeLabMeasuredProfileLibrarySchemas';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { Invokes } from '../../tauri/commands';
import { invokeWithSchema } from '../tauriSchemaInvoke';
import {
  exportNegativeLabMeasuredProfileLibrary,
  importNegativeLabMeasuredProfileLibrary,
} from './negativeLabMeasuredProfileLibrary';

const nullableJsonDocumentSchema = z.string().nullable();

/** Read and validate the app-data library; a missing file is represented as null. */
export async function readNegativeLabMeasuredProfileLibraryWithSchema(): Promise<NegativeLabMeasuredProfileLibrary | null> {
  const json = await invokeWithSchema(
    Invokes.ReadNegativeLabMeasuredProfileLibrary,
    {},
    nullableJsonDocumentSchema,
    Invokes.ReadNegativeLabMeasuredProfileLibrary,
  );
  return json === null ? null : importNegativeLabMeasuredProfileLibrary(json);
}

/** Serialize and atomically persist a validated app-data library. */
export function writeNegativeLabMeasuredProfileLibraryWithSchema(
  library: NegativeLabMeasuredProfileLibrary,
): Promise<void> {
  return invokeWithSchema(
    Invokes.WriteNegativeLabMeasuredProfileLibrary,
    { json: exportNegativeLabMeasuredProfileLibrary(library) },
    emptyTauriResponseSchema,
    Invokes.WriteNegativeLabMeasuredProfileLibrary,
  ).then(() => undefined);
}
