import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../editDocumentSelectors';

export const buildAgentDetailEffectsRecipeHashInput = (document: EditDocumentV2) => ({
  ...selectEditDocumentNode(document, 'detail_denoise_dehaze').params,
  ...selectEditDocumentNode(document, 'display_creative').params,
  ...selectEditDocumentNode(document, 'lens_correction').params,
});
