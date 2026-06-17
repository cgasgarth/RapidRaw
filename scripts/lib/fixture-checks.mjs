// @ts-check

import { readFile } from 'node:fs/promises';

export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

export const addDuplicateFieldFailures = ({ failures, getId, items, label }) => {
  const seen = new Set();
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) failures.push(`Duplicate ${label}: ${id}`);
    seen.add(id);
  }
};

export const expectInvalidCases = ({ failures, getPayload, invalidCases, label, schema }) => {
  for (const invalidCase of invalidCases) {
    const result = schema.safeParse(getPayload(invalidCase));
    if (result.success) failures.push(`${invalidCase.case}: expected ${label} rejection.`);
  }
};

export const finishFixtureCheck = ({ failures, invalidCount, label, validCount }) => {
  if (failures.length > 0) {
    console.error(`${label} validation failed.`);
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`${label} ok (${validCount} fixtures, ${invalidCount} invalid cases)`);
};
