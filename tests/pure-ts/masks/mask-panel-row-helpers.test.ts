import { expect, test } from 'bun:test';

import {
  getMaskLikeContainerDropClass,
  getMaskLikeSubMaskDropClass,
  isMaskLikeContainerDrag,
} from '../../../src/components/panel/right/layers/maskPanelRowHelpers.ts';

test('container drop class distinguishes container reorder from cross-container drops', () => {
  expect(
    getMaskLikeContainerDropClass({
      activeDragItem: { type: 'Container' },
      containerId: 'mask-a',
      isOver: true,
    }),
  ).toBe('border-t-2 border-accent');

  expect(
    getMaskLikeContainerDropClass({
      activeDragItem: { parentId: 'mask-b', type: 'SubMask' },
      containerId: 'mask-a',
      isOver: true,
    }),
  ).toBe('bg-card-active border border-accent/50');

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
  expect(getMaskLikeSubMaskDropClass({ type: 'SubMask' }, true)).toBe('border-t-2 border-accent');
  expect(getMaskLikeSubMaskDropClass({ type: 'Creation' }, false)).toBe('');
});
