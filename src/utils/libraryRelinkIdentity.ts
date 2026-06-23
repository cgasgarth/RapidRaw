import {
  libraryRelinkIdentitySchema,
  libraryRelinkPlanSchema,
  type LibraryRelinkCandidateDecision,
  type LibraryRelinkCandidateResult,
  type LibraryRelinkEvidence,
  type LibraryRelinkEvidenceKind,
  type LibraryRelinkIdentity,
  type LibraryRelinkPlan,
} from '../schemas/libraryRelinkSchemas';

interface ScoreRule {
  kind: LibraryRelinkEvidenceKind;
  matchWeight: number;
  mismatchWeight: number;
  read: (identity: LibraryRelinkIdentity) => string | number | null | undefined;
}

interface PlanLibraryRelinkInput {
  candidateIdentities: LibraryRelinkIdentity[];
  missingIdentity: LibraryRelinkIdentity;
}

const verifiedThreshold = 80;
const possibleThreshold = 35;
const ambiguousScoreGap = 5;

const scoreRules: ScoreRule[] = [
  { kind: 'content_hash', matchWeight: 70, mismatchWeight: -100, read: (identity) => identity.contentHash },
  { kind: 'byte_length', matchWeight: 15, mismatchWeight: -35, read: (identity) => identity.byteLength },
  { kind: 'capture_timestamp', matchWeight: 8, mismatchWeight: -8, read: (identity) => identity.captureTimestamp },
  { kind: 'camera_make', matchWeight: 2, mismatchWeight: -2, read: (identity) => identity.cameraMake },
  { kind: 'camera_model', matchWeight: 4, mismatchWeight: -4, read: (identity) => identity.cameraModel },
  { kind: 'lens_model', matchWeight: 2, mismatchWeight: -2, read: (identity) => identity.lensModel },
  { kind: 'filename', matchWeight: 6, mismatchWeight: -3, read: (identity) => fileNameFromPath(identity.path) },
];

export const planLibraryRelink = (input: PlanLibraryRelinkInput): LibraryRelinkPlan => {
  const missingIdentity = libraryRelinkIdentitySchema.parse(input.missingIdentity);
  const candidateIdentities = input.candidateIdentities.map((candidate) =>
    libraryRelinkIdentitySchema.parse(candidate),
  );

  const candidates = candidateIdentities
    .map((candidate) => scoreRelinkCandidate(missingIdentity, candidate))
    .sort((left, right) => right.score - left.score || left.candidatePath.localeCompare(right.candidatePath));
  const viableCandidates = candidates.filter((candidate) => candidate.decision !== 'rejected');
  const bestCandidate = viableCandidates[0];

  if (!bestCandidate) {
    return libraryRelinkPlanSchema.parse({ candidates, selectedCandidatePath: null, status: 'rejected' });
  }

  const runnerUp = viableCandidates[1];
  const isAmbiguous =
    runnerUp !== undefined &&
    (bestCandidate.decision !== 'verified' ||
      runnerUp.decision === 'verified' ||
      bestCandidate.score - runnerUp.score <= ambiguousScoreGap);

  return libraryRelinkPlanSchema.parse({
    candidates,
    selectedCandidatePath: isAmbiguous ? null : bestCandidate.candidatePath,
    status: isAmbiguous ? 'ambiguous' : 'matched',
  });
};

export const scoreRelinkCandidate = (
  missingIdentity: LibraryRelinkIdentity,
  candidateIdentity: LibraryRelinkIdentity,
): LibraryRelinkCandidateResult => {
  const evidence = scoreRules.map((rule) => compareEvidence(rule, missingIdentity, candidateIdentity));
  const score = evidence.reduce((sum, item) => sum + item.weight, 0);
  const hardReject = evidence.some((item) => item.kind === 'content_hash' && item.status === 'mismatch');
  const decision: LibraryRelinkCandidateDecision = hardReject
    ? 'rejected'
    : score >= verifiedThreshold
      ? 'verified'
      : score >= possibleThreshold
        ? 'possible'
        : 'rejected';

  return {
    candidatePath: candidateIdentity.path,
    decision,
    evidence,
    score,
  };
};

const compareEvidence = (
  rule: ScoreRule,
  missingIdentity: LibraryRelinkIdentity,
  candidateIdentity: LibraryRelinkIdentity,
): LibraryRelinkEvidence => {
  const missingValue = normalizeIdentityValue(rule.read(missingIdentity));
  const candidateValue = normalizeIdentityValue(rule.read(candidateIdentity));

  if (missingValue === null || candidateValue === null) {
    return { kind: rule.kind, status: 'missing', weight: 0 };
  }

  const isMatch = missingValue === candidateValue;
  return {
    kind: rule.kind,
    status: isMatch ? 'match' : 'mismatch',
    weight: isMatch ? rule.matchWeight : rule.mismatchWeight,
  };
};

const normalizeIdentityValue = (value: string | number | null | undefined): string | number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const fileNameFromPath = (path: string): string => path.split(/[\\/]/u).pop() ?? path;
