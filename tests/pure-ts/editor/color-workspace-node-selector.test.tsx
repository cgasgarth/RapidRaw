import { expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { create } from 'zustand';
import type { ColorPanelAdjustmentView } from '../../../src/components/adjustments/color/types';
import { createColorPanelAdjustmentViewSelector } from '../../../src/components/panel/right/color/ColorWorkspacePanel';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

test('color workspace snapshot stays cached across unrelated node edits', () => {
  const initial = createDefaultEditDocumentV2();
  const useDocumentStore = create(() => ({ editDocumentV2: initial }));
  const selector = createColorPanelAdjustmentViewSelector();
  let renderCount = 0;

  const Probe = () => {
    renderCount += 1;
    const adjustments: ColorPanelAdjustmentView = useDocumentStore(selector);
    return <output data-testid="saturation">{adjustments.saturation}</output>;
  };

  const view = render(<Probe />);
  expect(renderCount).toBe(1);

  act(() => {
    useDocumentStore.setState({
      editDocumentV2: patchEditDocumentV2Node(initial, 'geometry', { rotation: 1 }),
    });
  });
  expect(renderCount).toBe(1);

  act(() => {
    useDocumentStore.setState({
      editDocumentV2: patchEditDocumentV2Node(useDocumentStore.getState().editDocumentV2, 'color_presence', {
        saturation: 12,
      }),
    });
  });
  expect(renderCount).toBe(2);
  expect(view.getByTestId('saturation').textContent).toBe('12');
});
