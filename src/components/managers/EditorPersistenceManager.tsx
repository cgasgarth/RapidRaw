import type { RefObject } from 'react';

import { type PreviousAdjustments, useEditorPersistence } from '../../hooks/editor/useEditorPersistence';

interface Props {
  prevAdjustmentsRef: RefObject<PreviousAdjustments | null>;
}

export default function EditorPersistenceManager({ prevAdjustmentsRef }: Props) {
  useEditorPersistence(prevAdjustmentsRef);
  return null;
}
