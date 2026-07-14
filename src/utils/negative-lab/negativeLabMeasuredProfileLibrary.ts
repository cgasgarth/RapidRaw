import {
  type NegativeLabMeasuredProfileLibrary,
  type NegativeLabMeasuredProfileLibraryEntry,
  negativeLabMeasuredProfileLibrarySchema,
  parseNegativeLabMeasuredProfileLibrary,
} from '../../schemas/negative-lab/negativeLabMeasuredProfileLibrarySchemas';
import type {
  NegativeLabMeasuredProfile,
  NegativeLabMeasuredProfileCatalog,
  NegativeLabMeasurementReport,
} from '../../schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import { parseNegativeLabMeasuredProfileCatalog } from '../../schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const buildNegativeLabMeasuredProfileContentHash = (
  profile: NegativeLabMeasuredProfile,
  report: NegativeLabMeasurementReport,
): `fnv1a32:${string}` => `fnv1a32:${buildNegativeLabPlanHash(stableJson({ profile, report }))}`;

export const createNegativeLabMeasuredProfileLibraryEntry = ({
  profile,
  report,
  now = new Date().toISOString(),
}: {
  profile: NegativeLabMeasuredProfile;
  report: NegativeLabMeasurementReport;
  now?: string;
}): NegativeLabMeasuredProfileLibraryEntry => {
  const entry = {
    contentHash: buildNegativeLabMeasuredProfileContentHash(profile, report),
    createdAt: now,
    profile,
    report,
    source: 'imported_local' as const,
    updatedAt: now,
  };
  return negativeLabMeasuredProfileLibrarySchema.shape.entries.element.parse(entry);
};

export const createEmptyNegativeLabMeasuredProfileLibrary = (): NegativeLabMeasuredProfileLibrary => ({
  entries: [],
  libraryId: 'negative_lab_measured_profile_library',
  schemaVersion: 1,
});

export const mergeNegativeLabMeasuredProfileLibrary = ({
  builtIns,
  builtInContentHashes = [],
  local,
}: {
  builtIns: readonly NegativeLabMeasuredProfile[];
  builtInContentHashes?: readonly string[];
  local: NegativeLabMeasuredProfileLibrary;
}): NegativeLabMeasuredProfile[] => {
  const builtInIds = new Set(builtIns.map((profile) => profile.profileId));
  const builtInHashes = new Set(builtInContentHashes);
  const seen = new Set<string>();
  for (const profile of builtIns) {
    if (seen.has(profile.profileId)) throw new Error(`Duplicate built-in measured profile id: ${profile.profileId}`);
    seen.add(profile.profileId);
  }
  for (const entry of local.entries) {
    if (builtInIds.has(entry.profile.profileId))
      throw new Error(`Local profile shadows built-in id: ${entry.profile.profileId}`);
    if (builtInHashes.has(entry.contentHash)) {
      throw new Error(`Local measured profile content hash collides with a built-in: ${entry.contentHash}`);
    }
    if (seen.has(entry.profile.profileId)) throw new Error(`Duplicate measured profile id: ${entry.profile.profileId}`);
    seen.add(entry.profile.profileId);
  }
  return [...builtIns, ...local.entries.map((entry) => entry.profile)];
};

/** Preserve catalog identity/version while adding validated local snapshots. */
export const mergeNegativeLabMeasuredProfileCatalog = ({
  builtInCatalog,
  local,
}: {
  builtInCatalog: NegativeLabMeasuredProfileCatalog;
  local: NegativeLabMeasuredProfileLibrary;
}): NegativeLabMeasuredProfileCatalog =>
  parseNegativeLabMeasuredProfileCatalog({
    ...builtInCatalog,
    profiles: mergeNegativeLabMeasuredProfileLibrary({ builtIns: builtInCatalog.profiles, local }),
  });

export const importNegativeLabMeasuredProfileLibrary = (json: string): NegativeLabMeasuredProfileLibrary =>
  parseNegativeLabMeasuredProfileLibrary(JSON.parse(json));

export const exportNegativeLabMeasuredProfileLibrary = (library: NegativeLabMeasuredProfileLibrary): string =>
  `${JSON.stringify(parseNegativeLabMeasuredProfileLibrary(library), null, 2)}\n`;

export const removeNegativeLabMeasuredProfileLibraryEntry = (
  library: NegativeLabMeasuredProfileLibrary,
  profileId: string,
): NegativeLabMeasuredProfileLibrary => ({
  ...library,
  entries: library.entries.filter((entry) => entry.profile.profileId !== profileId),
});
