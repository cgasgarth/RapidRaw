import { describe, expect, test } from 'bun:test';
import catalog from '../../../src/data/negativeLabMeasuredProfileCatalog.json';
import {
  negativeLabMeasuredProfileLibrarySchema,
  parseNegativeLabMeasuredProfileLibrary,
} from '../../../src/schemas/negative-lab/negativeLabMeasuredProfileLibrarySchemas';
import type { NegativeLabMeasurementReport } from '../../../src/schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import {
  buildNegativeLabMeasuredProfileContentHash,
  createEmptyNegativeLabMeasuredProfileLibrary,
  createNegativeLabMeasuredProfileLibraryEntry,
  exportNegativeLabMeasuredProfileLibrary,
  importNegativeLabMeasuredProfileLibrary,
  mergeNegativeLabMeasuredProfileLibrary,
  removeNegativeLabMeasuredProfileLibraryEntry,
} from '../../../src/utils/negative-lab/negativeLabMeasuredProfileLibrary';

const profile = catalog.profiles[0];
const report: NegativeLabMeasurementReport = {
  calibrationMethod: profile.calibrationMethod,
  doesNotProve: ['no_stock_emulation_claim', 'no_colorimetric_match_claim'],
  evidenceDigest: profile.evidenceDigest,
  fittedParams: profile.params,
  generatedAt: '2026-07-14',
  measurementSoftware: 'RapidRaw test fixture',
  operator: 'project-test',
  patchMetrics: { deltaE00Max: 2, deltaE00Mean: 0.5, deltaE00P95: 1.5, rejectedPatchCount: 0, usedPatchCount: 24 },
  profileId: profile.profileId,
  reportHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  reportId: 'negative_lab_measurement_report.process_family.v1',
  sourceFixtureIds: profile.evidenceFixtureIds,
  targetReference: {
    id: 'project-target',
    patchCount: 24,
    referenceHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    type: 'project_synthetic_target',
  },
};

describe('Negative Lab measured profile library', () => {
  test('round-trips a complete profile/report snapshot with a stable content hash', () => {
    const first = createNegativeLabMeasuredProfileLibraryEntry({ profile, report, now: '2026-07-14T00:00:00Z' });
    const second = createNegativeLabMeasuredProfileLibraryEntry({ profile, report, now: '2026-07-15T00:00:00Z' });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toBe(buildNegativeLabMeasuredProfileContentHash(profile, report));
    const library = parseNegativeLabMeasuredProfileLibrary({
      ...createEmptyNegativeLabMeasuredProfileLibrary(),
      entries: [first],
    });
    expect(importNegativeLabMeasuredProfileLibrary(exportNegativeLabMeasuredProfileLibrary(library))).toEqual(library);
  });

  test('rejects duplicate ids and content hashes before runtime merge', () => {
    const entry = createNegativeLabMeasuredProfileLibraryEntry({ profile, report, now: '2026-07-14T00:00:00Z' });
    expect(() =>
      negativeLabMeasuredProfileLibrarySchema.parse({
        ...createEmptyNegativeLabMeasuredProfileLibrary(),
        entries: [entry, entry],
      }),
    ).toThrow('Duplicate local measured profile id');
  });

  test('keeps built-ins immutable and removes only local entries', () => {
    const localProfile = {
      ...profile,
      profileId: 'negative_lab.measured.c41.local_snapshot.v1',
      measurementProfileId: 'negative_lab.measured.c41.local_snapshot.v1',
    };
    const localReport = { ...report, profileId: localProfile.profileId };
    const localEntry = createNegativeLabMeasuredProfileLibraryEntry({ profile: localProfile, report: localReport });
    const library = { ...createEmptyNegativeLabMeasuredProfileLibrary(), entries: [localEntry] };
    expect(mergeNegativeLabMeasuredProfileLibrary({ builtIns: [profile], local: library })).toHaveLength(2);
    expect(() =>
      mergeNegativeLabMeasuredProfileLibrary({
        builtIns: [profile],
        local: { ...library, entries: [createNegativeLabMeasuredProfileLibraryEntry({ profile, report })] },
      }),
    ).toThrow('shadows built-in');
    expect(removeNegativeLabMeasuredProfileLibraryEntry(library, localProfile.profileId).entries).toHaveLength(0);
  });
});
