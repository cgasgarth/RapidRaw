export type GitEnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Synthetic repositories must never inherit hook-scoped repository routing.
 * Return a fresh object so every child receives an immutable snapshot.
 */
export const isolatedGitEnvironment = (environment: GitEnvironmentSource = process.env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => !entry[0].startsWith('GIT_') && entry[1] !== undefined,
    ),
  );
