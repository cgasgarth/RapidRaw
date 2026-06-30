import type { ImageFile } from '../components/ui/AppProperties';
import {
  type LibraryRelinkCandidateDecision,
  type LibraryRelinkCandidateResult,
  type LibraryRelinkEvidence,
  type LibraryRelinkEvidenceKind,
  type LibraryRelinkIdentity,
  type LibraryRelinkPlan,
  libraryRelinkIdentitySchema,
  libraryRelinkPlanSchema,
} from '../schemas/library/libraryRelinkSchemas';
import {
  type LibrarySession,
  type LibrarySessionSet,
  librarySessionSetSchema,
} from '../schemas/library/librarySessionSchemas';

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

interface PlanLibraryFolderRelinkInput {
  candidateIdentities: LibraryRelinkIdentity[];
  fromRootPath: string;
  missingIdentities: LibraryRelinkIdentity[];
  toRootPath: string;
}

interface ApplyLibraryRelinkInput {
  fromPath: string;
  plan: LibraryRelinkPlan;
  sessionSet: LibrarySessionSet;
}

export interface LibraryRelinkRuntimeState {
  currentFolderPath: string | null;
  imageList: ImageFile[];
  imageRatings: Record<string, number>;
  libraryActivePath: string | null;
  multiSelectedPaths: string[];
  rootPaths: string[];
  selectionAnchorPath: string | null;
}

export interface LibraryFolderRelinkPlan {
  ambiguousCount: number;
  matchedCount: number;
  rejectedCount: number;
  relinkPlan: LibraryRelinkPlan | null;
  status: 'matched' | 'ambiguous' | 'rejected';
  totalCount: number;
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

export const planLibraryFolderRelink = (input: PlanLibraryFolderRelinkInput): LibraryFolderRelinkPlan => {
  const normalizedFromRoot = normalizePathForRewrite(input.fromRootPath);
  const normalizedToRoot = normalizePathForRewrite(input.toRootPath);
  const missingIdentities = input.missingIdentities.map((identity) => libraryRelinkIdentitySchema.parse(identity));
  const candidateByPath = new Map(
    input.candidateIdentities.map((identity) => {
      const parsed = libraryRelinkIdentitySchema.parse(identity);
      return [normalizePathForRewrite(parsed.path), parsed] as const;
    }),
  );

  const candidateResults: LibraryRelinkCandidateResult[] = [];
  let matchedCount = 0;
  let ambiguousCount = 0;
  let rejectedCount = 0;

  for (const missingIdentity of missingIdentities) {
    const candidatePath = rewritePath(missingIdentity.path, normalizedFromRoot, normalizedToRoot);
    const candidateIdentity = candidateByPath.get(normalizePathForRewrite(candidatePath));

    if (!candidateIdentity) {
      rejectedCount += 1;
      candidateResults.push(missingCandidateResult(candidatePath));
      continue;
    }

    const itemPlan = planLibraryRelink({ candidateIdentities: [candidateIdentity], missingIdentity });
    candidateResults.push(...itemPlan.candidates);

    if (itemPlan.status === 'matched') {
      matchedCount += 1;
    } else if (itemPlan.status === 'ambiguous') {
      ambiguousCount += 1;
    } else {
      rejectedCount += 1;
    }
  }

  const status =
    missingIdentities.length === 0 || rejectedCount > 0 ? 'rejected' : ambiguousCount > 0 ? 'ambiguous' : 'matched';

  const relinkPlan =
    status === 'matched'
      ? libraryRelinkPlanSchema.parse({
          candidates: candidateResults,
          selectedCandidatePath: normalizedToRoot,
          status: 'matched',
        })
      : null;

  return {
    ambiguousCount,
    matchedCount,
    rejectedCount,
    relinkPlan,
    status,
    totalCount: missingIdentities.length,
  };
};

export const applyLibraryRelinkToSessionSet = ({
  fromPath,
  plan,
  sessionSet,
}: ApplyLibraryRelinkInput): LibrarySessionSet => {
  const parsedSessionSet = librarySessionSetSchema.parse(sessionSet);
  const parsedPlan = libraryRelinkPlanSchema.parse(plan);

  if (parsedPlan.status !== 'matched' || parsedPlan.selectedCandidatePath === null) {
    throw new Error('Library relink requires one verified matched candidate.');
  }

  const normalizedFromPath = normalizePathForRewrite(fromPath);
  const normalizedToPath = normalizePathForRewrite(parsedPlan.selectedCandidatePath);

  return librarySessionSetSchema.parse({
    ...parsedSessionSet,
    sessions: parsedSessionSet.sessions.map((session) =>
      applyRelinkToSession(session, normalizedFromPath, normalizedToPath),
    ),
  });
};

export const applyLibraryRelinkToRuntimeState = (
  state: LibraryRelinkRuntimeState,
  fromPath: string,
  plan: LibraryRelinkPlan,
): LibraryRelinkRuntimeState => {
  const parsedPlan = libraryRelinkPlanSchema.parse(plan);

  if (parsedPlan.status !== 'matched' || parsedPlan.selectedCandidatePath === null) {
    throw new Error('Library relink requires one verified matched candidate.');
  }

  const normalizedFromPath = normalizePathForRewrite(fromPath);
  const normalizedToPath = normalizePathForRewrite(parsedPlan.selectedCandidatePath);

  return {
    ...state,
    currentFolderPath: rewriteNullablePath(state.currentFolderPath, normalizedFromPath, normalizedToPath),
    imageList: state.imageList.map((image) => ({
      ...image,
      path: rewritePath(image.path, normalizedFromPath, normalizedToPath),
    })),
    imageRatings: rewriteRecordKeys(state.imageRatings, normalizedFromPath, normalizedToPath),
    libraryActivePath: rewriteNullablePath(state.libraryActivePath, normalizedFromPath, normalizedToPath),
    multiSelectedPaths: rewritePathList(state.multiSelectedPaths, normalizedFromPath, normalizedToPath),
    rootPaths: rewritePathList(state.rootPaths, normalizedFromPath, normalizedToPath),
    selectionAnchorPath: rewriteNullablePath(state.selectionAnchorPath, normalizedFromPath, normalizedToPath),
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

const applyRelinkToSession = (session: LibrarySession, fromPath: string, toPath: string): LibrarySession => ({
  ...session,
  activeAssetPath: rewriteNullablePath(session.activeAssetPath, fromPath, toPath),
  activeFolderPath: rewriteNullablePath(session.activeFolderPath, fromPath, toPath),
  recentAssetPaths: rewritePathList(session.recentAssetPaths, fromPath, toPath),
  rootPaths: rewritePathList(session.rootPaths, fromPath, toPath),
  selectedAssetPaths: rewritePathList(session.selectedAssetPaths, fromPath, toPath),
});

const rewritePathList = (paths: readonly string[], fromPath: string, toPath: string): string[] =>
  paths.map((path) => rewritePath(path, fromPath, toPath));

const rewriteNullablePath = (path: string | null, fromPath: string, toPath: string): string | null =>
  path === null ? null : rewritePath(path, fromPath, toPath);

const rewritePath = (path: string, fromPath: string, toPath: string): string => {
  const normalizedPath = normalizePathForRewrite(path);
  if (normalizedPath === fromPath) return toPath;
  if (normalizedPath.startsWith(`${fromPath}?vc=`)) return `${toPath}${normalizedPath.slice(fromPath.length)}`;
  if (isPathInside(normalizedPath, fromPath)) return `${toPath}${normalizedPath.slice(fromPath.length)}`;
  return path;
};

export const rewriteLibraryRelinkPath = (path: string, fromPath: string, toPath: string): string =>
  rewritePath(path, normalizePathForRewrite(fromPath), normalizePathForRewrite(toPath));

const missingCandidateResult = (candidatePath: string): LibraryRelinkCandidateResult => ({
  candidatePath,
  decision: 'rejected',
  evidence: [{ kind: 'filename', status: 'missing', weight: 0 }],
  score: 0,
});

const rewriteRecordKeys = <TValue>(
  record: Record<string, TValue>,
  fromPath: string,
  toPath: string,
): Record<string, TValue> =>
  Object.fromEntries(Object.entries(record).map(([path, value]) => [rewritePath(path, fromPath, toPath), value]));

const isPathInside = (path: string, parentPath: string): boolean =>
  path.startsWith(`${parentPath}/`) || path.startsWith(`${parentPath}\\`);

const normalizePathForRewrite = (path: string): string => path.trim().replace(/[\\/]+$/u, '');
