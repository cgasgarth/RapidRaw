import { createRawEngineLocalAppServerBridge } from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  agentCurrentImagePreviewLoopApplyReviewRequestSchema,
  applyAgentCurrentImagePreviewLoopReviewedEdit,
  runAgentCurrentImagePreviewLoop,
} from '../context/agentCurrentImagePreviewLoop';
import { agentSelectedImageProposalRuntime } from '../context/agentSelectedImageProposalRuntime';
import { buildLiveEditorProjectLibrarySnapshot } from './agentLiveEditorCoreState';

export { buildLiveEditorProjectLibrarySnapshot } from './agentLiveEditorCoreState';

export const createLiveEditorAppServerBridge = () =>
  createRawEngineLocalAppServerBridge({
    getProjectLibrarySnapshot: buildLiveEditorProjectLibrarySnapshot,
    runSelectedImageProposalRender: (command) => agentSelectedImageProposalRuntime.render(command),
    runSelectedImagePreviewLoop: (command) => {
      const { commandType: _commandType, ...request } = command;
      return runAgentCurrentImagePreviewLoop(request);
    },
    runSelectedImagePreviewLoopApplyReview: (command) => {
      const { commandType: _commandType, request, ...reviewRequest } = command;
      return applyAgentCurrentImagePreviewLoopReviewedEdit(
        agentCurrentImagePreviewLoopApplyReviewRequestSchema.parse({
          ...reviewRequest,
          request,
        }),
      );
    },
  });
