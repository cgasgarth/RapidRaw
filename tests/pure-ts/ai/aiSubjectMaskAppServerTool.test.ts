import { beforeEach, describe, expect, test } from 'bun:test';
import type { SelectedImage } from '../../../src/components/ui/AppProperties';
import { AiProviderId } from '../../../src/schemas/ai/aiProviderSchemas';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { AI_APP_SERVER_TOOL_ROUTES } from '../../../src/utils/ai/aiAppServerToolRoutes';
import {
  type AiSubjectMaskToolAppliedResult,
  runAiSubjectMaskAppServerTool,
} from '../../../src/utils/ai/aiSubjectMaskAppServerTool';

const TEST_IMAGE: SelectedImage = {
  exif: null,
  height: 1600,
  isRaw: true,
  isReady: true,
  originalUrl: null,
  path: '/photos/session/test-subject-mask.cr3',
  thumbnailUrl: 'file:///tmp/test-subject-mask-thumb.jpg',
  width: 2400,
};

beforeEach(() => {
  useEditorStore.setState({
    selectedImage: TEST_IMAGE,
  });
});

describe('ai subject mask app-server tool routing', () => {
  test('routes subject-mask dry-run and apply through typed app-server tools', async () => {
    const result = await runAiSubjectMaskAppServerTool({
      maskName: 'Subject mask',
      operationId: 'subject-mask-test',
      providerClass: 'local_model',
      providerId: 'rawengine-local-ai',
      requestId: 'subject-mask-request',
      selectedImagePath: TEST_IMAGE.path,
    });

    expect(result.status).toBe('applied');

    const appliedResult: AiSubjectMaskToolAppliedResult = result;
    expect(appliedResult.dryRunResult.commandType).toBe('ai.mask.generateSubject');
    expect(appliedResult.applyResult.commandType).toBe('ai.mask.applySubject');
    expect(appliedResult.applyResult.dryRunPlanHash).toBe(appliedResult.dryRunResult.dryRunPlanHash);
    expect(appliedResult.applyResult.dryRunPlanId).toBe(appliedResult.dryRunResult.dryRunPlanId);
    expect(appliedResult.auditEvents.at(-1)).toMatchObject({
      commandType: 'ai.mask.applySubject',
      status: 'completed',
      toolName: 'ai.mask.apply_subject',
    });
  });

  test('records an audited fallback when the selected provider is unavailable', async () => {
    const result = await runAiSubjectMaskAppServerTool({
      maskName: 'Subject mask',
      operationId: 'subject-mask-blocked-test',
      providerClass: 'cloud_service',
      providerId: AiProviderId.Cloud,
      requestId: 'subject-mask-blocked-request',
      selectedImagePath: TEST_IMAGE.path,
    });

    expect(result.status).toBe('blocked');
    expect(result.userVisibleMessage).toContain('unavailable');
    expect(result.provider).toMatchObject({
      providerClass: 'cloud_service',
      providerId: AiProviderId.Cloud,
    });
    expect(result.auditEvents.at(-1)).toMatchObject({
      commandType: 'ai.mask.generateSubject',
      providerFallback: {
        fallbackReason: 'provider_unavailable',
        requestedProviderId: AiProviderId.Cloud,
      },
      status: 'blocked',
    });
  });

  test('advertises the typed app-server route for subject-mask dry-run and apply', () => {
    const dryRunRoute = AI_APP_SERVER_TOOL_ROUTES.find((route) => route.sourceOperation === 'ai.mask.dry_run_subject');
    const applyRoute = AI_APP_SERVER_TOOL_ROUTES.find((route) => route.sourceOperation === 'ai.mask.apply_subject');

    expect(dryRunRoute).toMatchObject({
      sourceKind: 'app_server_tool',
      status: 'mapped',
    });
    expect(applyRoute).toMatchObject({
      sourceKind: 'app_server_tool',
      status: 'mapped',
    });
  });
});
