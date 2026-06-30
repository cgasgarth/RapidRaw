import { buildHdrMergeApiCommandV1 } from '../src/hdr/hdrMergeApiTools.js';
import { ApprovalClass } from '../src/rawEngineSchemas.js';

const baseRequest = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  commandId: 'command_hdr_api_tool_preview',
  correlationId: 'corr_hdr_api_tool_preview',
  expectedGraphRevision: 'graph_rev_hdr_001',
  outputName: 'Window Light HDR',
  sources: [
    {
      declaredExposureEv: -2,
      height: 4000,
      imageId: 'hdr_001',
      imagePath: '/photos/session/HDR_001.CR3',
      rawBlackLevelKnown: true,
      rawWhiteLevelKnown: true,
      sourceIndex: 0,
      whiteBalanceComparable: true,
      width: 6000,
    },
    {
      declaredExposureEv: 0,
      height: 4000,
      imageId: 'hdr_002',
      imagePath: '/photos/session/HDR_002.CR3',
      rawBlackLevelKnown: true,
      rawWhiteLevelKnown: true,
      sourceIndex: 1,
      whiteBalanceComparable: true,
      width: 6000,
    },
    {
      declaredExposureEv: 2,
      height: 4000,
      imageId: 'hdr_003',
      imagePath: '/photos/session/HDR_003.CR3',
      rawBlackLevelKnown: true,
      rawWhiteLevelKnown: true,
      sourceIndex: 2,
      whiteBalanceComparable: true,
      width: 6000,
    },
  ],
  target: { id: 'project_hdr_001', kind: 'project' },
};

const result = buildHdrMergeApiCommandV1(baseRequest);

if (result.command.commandType !== 'computationalMerge.createHdr') {
  throw new Error('HDR API tool did not build a createHdr command.');
}
if (result.command.approval.approvalClass !== ApprovalClass.PreviewOnly || !result.command.dryRun) {
  throw new Error('HDR API tool must produce preview-only dry-run commands.');
}
if (!result.bracketDetection.accepted || result.bracketDetection.bracketSpanEv !== 4) {
  throw new Error('HDR API tool did not preserve accepted bracket detection.');
}
if (result.command.parameters.sources.some((source) => source.role !== 'hdr_bracket')) {
  throw new Error('HDR API tool sources must be hdr_bracket roles.');
}

let blockedDuplicateExposure = false;
try {
  buildHdrMergeApiCommandV1({
    ...baseRequest,
    commandId: 'command_hdr_duplicate_exposure',
    correlationId: 'corr_hdr_duplicate_exposure',
    sources: baseRequest.sources.map((source) => ({ ...source, declaredExposureEv: 0 })),
  });
} catch (error) {
  blockedDuplicateExposure = error instanceof Error && error.message.includes('duplicate_exposure_values');
}
if (!blockedDuplicateExposure) {
  throw new Error('HDR API tool must block duplicate exposure brackets when validation is required.');
}

console.log('HDR API tools ok');
