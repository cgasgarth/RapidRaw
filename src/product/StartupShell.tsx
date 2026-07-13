import { queueStartupShellIntent } from './startupShellHandoff';

// This shell must render before the full application and its locale catalogs
// are downloaded. The localized App replaces it as soon as that chunk loads.
const BOOTSTRAP_COPY = {
  addFolder: 'Add Folder',
  albums: 'Albums',
  brand: 'RapidRAW',
  failed: 'RapidRAW could not finish loading. Restart the application to try again.',
  folders: 'Folders',
  library: 'Library',
  loading: 'Loading your workspace…',
  settings: 'Settings',
  startingLabel: 'RapidRAW library is starting',
  workspaceLabel: 'Workspace',
} as const;

export const StartupShell = ({ failed = false }: { failed?: boolean }) => (
  <div id="startup-shell" role="status" aria-label={BOOTSTRAP_COPY.startingLabel}>
    <aside>
      <strong>{BOOTSTRAP_COPY.brand}</strong>
      <nav aria-label={BOOTSTRAP_COPY.workspaceLabel}>
        <span>{BOOTSTRAP_COPY.library}</span>
        <span>{BOOTSTRAP_COPY.albums}</span>
        <span>{BOOTSTRAP_COPY.folders}</span>
      </nav>
    </aside>
    <main>
      <header>{BOOTSTRAP_COPY.library}</header>
      <section>
        {failed ? (
          <p role="alert">{BOOTSTRAP_COPY.failed}</p>
        ) : (
          <div>
            <p>{BOOTSTRAP_COPY.loading}</p>
            <button type="button" onClick={() => queueStartupShellIntent('add-folder')}>
              {BOOTSTRAP_COPY.addFolder}
            </button>
            <button type="button" onClick={() => queueStartupShellIntent('settings')}>
              {BOOTSTRAP_COPY.settings}
            </button>
          </div>
        )}
      </section>
    </main>
  </div>
);
