import { readFile } from 'node:fs/promises';

import type { z } from 'zod';

type InvalidFixtureCase = {
  case: string;
};

type FixtureCheckFailures = {
  failures: string[];
};

export const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

export const addDuplicateFieldFailures = <TItem>({
  failures,
  getId,
  items,
  label,
}: FixtureCheckFailures & {
  getId: (item: TItem) => string;
  items: Iterable<TItem>;
  label: string;
}): void => {
  const seen = new Set<string>();
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) failures.push(`Duplicate ${label}: ${id}`);
    seen.add(id);
  }
};

export const expectInvalidCases = <TInvalidCase extends InvalidFixtureCase>({
  failures,
  getPayload,
  invalidCases,
  label,
  schema,
}: FixtureCheckFailures & {
  getPayload: (invalidCase: TInvalidCase) => unknown;
  invalidCases: Iterable<TInvalidCase>;
  label: string;
  schema: z.ZodType;
}): void => {
  for (const invalidCase of invalidCases) {
    const result = schema.safeParse(getPayload(invalidCase));
    if (result.success) failures.push(`${invalidCase.case}: expected ${label} rejection.`);
  }
};

export const finishFixtureCheck = ({
  failures,
  invalidCount,
  label,
  validCount,
}: FixtureCheckFailures & {
  invalidCount: number;
  label: string;
  validCount: number;
}): void => {
  if (failures.length > 0) {
    console.error(`${label} validation failed.`);
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`${label} ok (${validCount} fixtures, ${invalidCount} invalid cases)`);
};
