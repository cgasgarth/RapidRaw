import { beginStaticStartup } from './staticStartup';

export { completeStaticStartup, startupBootstrapCommands } from './staticStartup';

const showRecovery = (error: unknown): void => {
  const content = document.getElementById('startup-shell-content');
  if (!content) return;
  content.replaceChildren();
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'RapidRAW could not finish loading. Restart the application to try again.';
  content.append(message);
  console.error('Failed to load full application:', error);
};

export const startApplication = async (
  loadApplication: () => Promise<{ mountApplication: () => void }> = () => import('../mainApp.js'),
  establishStartup: () => Promise<string> = beginStaticStartup,
): Promise<void> => {
  try {
    await establishStartup();
    const application = await loadApplication();
    application.mountApplication();
  } catch (error) {
    showRecovery(error);
  }
};
