import { describe, expect, test } from 'bun:test';
import { negativeLabCompactPanelIds } from '../../../src/components/modals/negative-lab/NegativeLabCompactControlPanels';
import {
  DEFAULT_NEGATIVE_LAB_WORKSPACE_LAYOUT,
  negativeLabWorkspacePanelIdSchema,
  parseNegativeLabWorkspaceLayout,
} from '../../../src/schemas/negative-lab/negativeLabWorkspaceLayout';

describe('Negative Lab compact workspace panel layout', () => {
  test('keeps the photographic section order stable', () => {
    expect(negativeLabCompactPanelIds).toEqual([
      'process-profile',
      'base-bounds',
      'print-color',
      'auto-sampling',
      'roll-qc',
      'export-output',
    ]);
  });

  test('migrates malformed persisted layout to deterministic defaults and de-duplicates collapse state', () => {
    expect(parseNegativeLabWorkspaceLayout({ collapsedPanelIds: ['roll-qc', 'roll-qc'], pinnedPanelId: null })).toEqual(
      {
        collapsedPanelIds: ['roll-qc'],
        pinnedPanelId: null,
      },
    );
    expect(parseNegativeLabWorkspaceLayout({ collapsedPanelIds: ['unknown'], pinnedPanelId: null })).toEqual(
      DEFAULT_NEGATIVE_LAB_WORKSPACE_LAYOUT,
    );
  });

  test('layout ids cannot represent conversion recipe fields', () => {
    expect(negativeLabWorkspacePanelIdSchema.safeParse('contrast').success).toBe(false);
    expect(negativeLabWorkspacePanelIdSchema.safeParse('print-color').success).toBe(true);
  });
});
