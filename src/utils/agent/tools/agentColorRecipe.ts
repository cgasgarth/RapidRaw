import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../editDocumentSelectors';

export const buildAgentColorRecipeHashInput = (document: EditDocumentV2) => ({
  ...selectEditDocumentNode(document, 'black_white_mixer').params,
  ...selectEditDocumentNode(document, 'camera_input').params,
  ...selectEditDocumentNode(document, 'channel_mixer').params,
  ...selectEditDocumentNode(document, 'color_balance_rgb').params,
  ...selectEditDocumentNode(document, 'color_calibration').params,
  ...selectEditDocumentNode(document, 'color_presence').params,
  ...selectEditDocumentNode(document, 'perceptual_grading').params,
  ...selectEditDocumentNode(document, 'selective_color_mixer').params,
  ...selectEditDocumentNode(document, 'skin_tone_uniformity').params,
});
