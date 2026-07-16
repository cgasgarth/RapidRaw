import type { EditDocumentV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentGeometry } from '../../editDocumentSelectors';
import { stableAgentPreviewHash } from '../context/agentPreviewEnvelope';

export const buildAgentGeometryRecipeHashInput = (document: EditDocumentV2) => selectEditDocumentGeometry(document);

const hashAgentGeometryRecipeInput = (document: EditDocumentV2): string =>
  stableAgentPreviewHash(JSON.stringify(buildAgentGeometryRecipeHashInput(document)));
