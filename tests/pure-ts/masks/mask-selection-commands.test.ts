import { describe, expect, test } from 'bun:test';
import { Mask, type SubMask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import {
  createDefaultMaskEditNodes,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments';
import {
  resolveMaskSelection,
  selectionAfterContainerDeletion,
  selectionAfterSubMaskDeletion,
  validateMaskGraphCommand,
} from '../../../src/utils/mask/maskSelectionCommands';

const subMask = (id: string): SubMask => ({
  id,
  invert: false,
  mode: SubMaskMode.Additive,
  name: id,
  opacity: 100,
  parameters: {},
  type: Mask.Brush,
  visible: true,
});
const container = (id: string, subMaskIds: string[] = []): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id,
  invert: false,
  name: id,
  opacity: 100,
  subMasks: subMaskIds.map(subMask),
  visible: true,
});

describe('mask selection commands', () => {
  test('validates container and sub-mask ids against one snapshot', () => {
    const masks = [container('a', ['a1'])];
    expect(resolveMaskSelection(masks, { containerId: 'a', subMaskId: 'a1' })).toEqual({
      containerId: 'a',
      subMaskId: 'a1',
    });
    expect(resolveMaskSelection(masks, { containerId: 'a', subMaskId: 'missing' })).toEqual({
      containerId: 'a',
      subMaskId: null,
    });
    expect(resolveMaskSelection(masks, { containerId: 'missing', subMaskId: 'a1' })).toEqual({
      containerId: null,
      subMaskId: null,
    });
  });

  test('chooses the adjacent container after deleting selected first, middle, or last', () => {
    const masks = [container('a'), container('b'), container('c')];
    expect(selectionAfterContainerDeletion(masks, 'a', { containerId: 'a', subMaskId: null }).containerId).toBe('b');
    expect(selectionAfterContainerDeletion(masks, 'b', { containerId: 'b', subMaskId: null }).containerId).toBe('c');
    expect(selectionAfterContainerDeletion(masks, 'c', { containerId: 'c', subMaskId: null }).containerId).toBe('b');
    expect(selectionAfterContainerDeletion(masks, 'a', { containerId: 'c', subMaskId: null }).containerId).toBe('c');
  });

  test('chooses the adjacent sub-mask and preserves selection when another item is deleted', () => {
    const masks = [container('a', ['one', 'two', 'three'])];
    expect(selectionAfterSubMaskDeletion(masks, 'a', 'two', { containerId: 'a', subMaskId: 'two' })).toEqual({
      containerId: 'a',
      subMaskId: 'three',
    });
    expect(selectionAfterSubMaskDeletion(masks, 'a', 'three', { containerId: 'a', subMaskId: 'three' })).toEqual({
      containerId: 'a',
      subMaskId: 'two',
    });
    expect(selectionAfterSubMaskDeletion(masks, 'a', 'one', { containerId: 'a', subMaskId: 'two' })).toEqual({
      containerId: 'a',
      subMaskId: 'two',
    });
  });

  test('drops stale pending selection and expansion ids before commit', () => {
    expect(
      validateMaskGraphCommand({
        masks: [container('a')],
        openContainerId: 'stale',
        selection: { containerId: 'stale', subMaskId: null },
      }),
    ).toEqual({
      masks: [container('a')],
      selection: { containerId: null, subMaskId: null },
    });
  });
});
