export const buildNegativeLabPlanHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export const buildNegativeLabAcceptedPlanIdentity = (planJson: string) => {
  const planHash = buildNegativeLabPlanHash(planJson);

  return {
    acceptedDryRunPlanHash: `fnv1a32:${planHash}`,
    acceptedDryRunPlanId: `negative_lab_batch_plan_${planHash}`,
  };
};
