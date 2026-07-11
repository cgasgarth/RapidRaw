import { type ComponentProps, memo } from 'react';
import AppModals from '../modals/AppModals';
import { RenderIsland } from './RenderIsland';

export const AppModalHost = memo(function AppModalHost(props: ComponentProps<typeof AppModals>) {
  return (
    <RenderIsland name="modal-host">
      <AppModals {...props} />
    </RenderIsland>
  );
});
