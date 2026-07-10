import { expect, test } from 'bun:test';

import {
  getMaskLikeContainerDropClass,
  getMaskLikeSubMaskDropClass,
  getRuntimeMaskContainerBlendMode,
  isMaskContainerRuntimeBlendMode,
  isMaskLikeContainerDrag,
  MASK_CONTAINER_RUNTIME_BLEND_MODES,
} from '../../../src/components/panel/right/layers/maskPanelRowHelpers.ts';
import { reorderMaskListContainers } from '../../../src/utils/mask/maskClipboard.ts';

test('container drop class distinguishes container reorder from cross-container drops', () => {
  expect(
    getMaskLikeContainerDropClass({
      activeDragItem: { type: 'Container' },
      containerId: 'mask-a',
      isOver: true,
    }),
  ).toBe('border-t-2 border-editor-primary-active');

  expect(
    getMaskLikeContainerDropClass({
      activeDragItem: { parentId: 'mask-b', type: 'SubMask' },
      containerId: 'mask-a',
      isOver: true,
    }),
  ).toBe('border border-editor-primary-active/50 bg-editor-selected-quiet');

  expect(
    getMaskLikeContainerDropClass({
      activeDragItem: { parentId: 'mask-a', type: 'SubMask' },
      containerId: 'mask-a',
      isOver: true,
    }),
  ).toBe('');
});

test('submask drop class disables insert target while dragging containers', () => {
  expect(isMaskLikeContainerDrag({ type: 'Container' })).toBe(true);
  expect(getMaskLikeSubMaskDropClass({ type: 'Container' }, true)).toBe('');
  expect(getMaskLikeSubMaskDropClass({ type: 'SubMask' }, true)).toBe('border-t-2 border-editor-primary-active');
  expect(getMaskLikeSubMaskDropClass({ type: 'Creation' }, false)).toBe('');
});

test('container reorder keeps the production drag target order without mutating the source stack', () => {
  const containers = [
    { id: 'mask-a', subMasks: [] },
    { id: 'mask-b', subMasks: [] },
    { id: 'mask-c', subMasks: [] },
  ];

  const reordered = reorderMaskListContainers(containers, 'mask-a', 'mask-c');

  expect(reordered?.map((container) => container.id)).toEqual(['mask-b', 'mask-c', 'mask-a']);
  expect(containers.map((container) => container.id)).toEqual(['mask-a', 'mask-b', 'mask-c']);
  expect(reorderMaskListContainers(containers, 'mask-a', 'mask-a')).toBeNull();
});

test('runtime blend helper gates unsupported mask container blend modes', () => {
  expect(MASK_CONTAINER_RUNTIME_BLEND_MODES).toEqual(['normal', 'multiply', 'screen']);
  expect(isMaskContainerRuntimeBlendMode('multiply')).toBe(true);
  expect(isMaskContainerRuntimeBlendMode('overlay')).toBe(false);
  expect(getRuntimeMaskContainerBlendMode('screen')).toBe('screen');
  expect(getRuntimeMaskContainerBlendMode('overlay')).toBe('normal');
});
