export const COLOR_OUTPUT_FOCUS_EVENT = 'rawengine:focus-color-output';
export const COLOR_WORKSPACE_TAB_SESSION_KEY = 'rawengine.colorWorkspace.activeTab';

export const requestColorOutputFocus = () => {
  try {
    window.sessionStorage.setItem(COLOR_WORKSPACE_TAB_SESSION_KEY, 'output');
  } catch {
    // The live event still updates an already-mounted Color workspace.
  }

  window.dispatchEvent(new CustomEvent(COLOR_OUTPUT_FOCUS_EVENT));
};
