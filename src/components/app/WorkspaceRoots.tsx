import { type ComponentProps, memo } from 'react';
import EditorView from '../views/EditorView';
import LibraryView from '../views/LibraryView';
import { RenderIsland } from './RenderIsland';

export const EditorWorkspaceRoot = memo(function EditorWorkspaceRoot(props: ComponentProps<typeof EditorView>) {
  return (
    <RenderIsland name="editor-workspace">
      <EditorView {...props} />
    </RenderIsland>
  );
});

export const LibraryWorkspaceRoot = memo(function LibraryWorkspaceRoot(props: ComponentProps<typeof LibraryView>) {
  return (
    <RenderIsland name="library-workspace">
      <LibraryView {...props} />
    </RenderIsland>
  );
});
