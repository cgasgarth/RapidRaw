export type GitEnvironmentSource = Readonly<Record<string, string | undefined>>;

const NULL_GIT_CONFIG = process.platform === 'win32' ? 'NUL' : '/dev/null';

/**
 * Synthetic repositories must never inherit hook-scoped repository routing or
 * user/system configuration that can start long-lived helpers such as fsmonitor.
 * Return a fresh object so every child receives an immutable snapshot.
 */
export const isolatedGitEnvironment = (environment: GitEnvironmentSource = process.env): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined,
    ),
  ),
  GIT_CONFIG_GLOBAL: NULL_GIT_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
});
