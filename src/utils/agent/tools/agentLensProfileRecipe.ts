import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../editDocumentSelectors';

export const buildAgentLensProfileRecipeHashInput = (document: EditDocumentV2) =>
  selectEditDocumentNode(document, 'lens_correction').params;
