import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../editDocumentSelectors';
import { stableAgentPreviewHash } from '../context/agentPreviewEnvelope';

export const buildAgentCurveLevelsRecipeHashInput = (document: EditDocumentV2) => ({
  ...selectEditDocumentNode(document, 'luma_levels').params,
  ...selectEditDocumentNode(document, 'scene_curve').params,
});

const hashAgentCurveLevelsRecipeInput = (document: EditDocumentV2): string =>
  stableAgentPreviewHash(JSON.stringify(buildAgentCurveLevelsRecipeHashInput(document)));
