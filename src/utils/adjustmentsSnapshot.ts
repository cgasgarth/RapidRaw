import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';

export const areEditDocumentsEqual = (left: EditDocumentV2, right: EditDocumentV2): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right);
