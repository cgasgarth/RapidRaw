import type { AutoEditGroup, AutoEditProposalV1 } from '../schemas/autoEditSchemas';

export const recommendedAutoEditGroups = (proposal: AutoEditProposalV1): Set<AutoEditGroup> =>
  new Set(
    proposal.recommendations
      .filter((recommendation) => recommendation.state === 'recommended')
      .map((recommendation) => recommendation.group),
  );

export const highConfidenceAutoEditGroups = (proposal: AutoEditProposalV1): Set<AutoEditGroup> =>
  new Set(
    proposal.recommendations
      .filter(
        (recommendation) =>
          recommendation.state === 'recommended' && recommendation.confidence >= 0.82 && recommendation.safeToBatch,
      )
      .map((recommendation) => recommendation.group),
  );

export const toggleAutoEditGroup = (
  selectedGroups: ReadonlySet<AutoEditGroup>,
  group: AutoEditGroup,
): Set<AutoEditGroup> => {
  const next = new Set(selectedGroups);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
};

export const isCurrentAutoEditCompletion = (
  expectedImageSessionId: string,
  expectedGraphRevision: string,
  currentImageSessionId: string | null,
  currentGraphRevision: string,
): boolean => expectedImageSessionId === currentImageSessionId && expectedGraphRevision === currentGraphRevision;
