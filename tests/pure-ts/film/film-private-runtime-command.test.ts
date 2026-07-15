import { describe, expect, test } from 'bun:test';

import { rawOpenEditExportProofRequestSchema } from '../../../src/schemas/rawOpenEditExportCommandSchemas';

const request = {
  artifactDirRelative: 'private-artifacts/film-runtime/test',
  editCommand: {
    actor: { id: 'film-runtime-test', kind: 'test' },
    approval: { approvalClass: 'edit_apply', reason: 'Test Film runtime command.', state: 'approved' },
    colorPipeline: {
      chromaticAdaptation: {
        method: 'bradford_v1',
        sourceWhitePoint: { x: 0.3457, y: 0.3585 },
        status: 'math_validated',
        targetWhitePoint: { x: 0.32168, y: 0.33767 },
        warnings: [],
      },
      inputDomain: 'camera_linear_rgb',
      operationDomain: 'acescg_linear_v1',
      renderTarget: {
        bitDepth: 16,
        embedIcc: true,
        intent: 'relative_colorimetric',
        outputProfile: 'display_p3',
        viewTransform: 'rawengine_agx_v1',
      },
      sceneToDisplayTransform: 'rawengine_agx_v1',
      workingSpace: 'acescg_linear_v1',
    },
    commandId: 'command.film-runtime-test.v1',
    commandType: 'edit.apply_film_emulation_operation',
    correlationId: 'corr.film-runtime-test.v1',
    dryRun: false,
    expectedGraphRevision: 'graph-rev.film-runtime-test.v1',
    parameters: {
      acceptedDryRunPlanHash: 'sha256:accepted-film-plan',
      acceptedDryRunPlanId: 'dryrun_film_test_v1',
      operation: { kind: 'set_mix', mix: 0.7 },
    },
    schemaVersion: 1,
    target: { kind: 'image', variantId: 'film-runtime-test' },
  },
  fixtureId: 'validation.raw-open-edit-export.film-runtime-test.v1',
  privateRootPath: '/tmp/rawengine-film-proof',
  sourceMetadata: {
    cameraMake: 'Sony',
    cameraModel: 'private fixture',
    privacySafeCameraId: 'camera.film-runtime-test.v1',
    rawFormat: 'arw',
  },
  sourceRelativePath: 'DSC_0001.ARW',
  sourceRootPath: '/private/raw/source',
};

describe('Film private RAW runtime command boundary', () => {
  test('accepts a canonical Film operation with separate source and artifact roots', () => {
    const parsed = rawOpenEditExportProofRequestSchema.parse(request);
    expect(parsed.editCommand.commandType).toBe('edit.apply_film_emulation_operation');
    expect(parsed.sourceRootPath).toBe('/private/raw/source');
  });

  test('rejects traversal and malformed Film operation payloads', () => {
    expect(
      rawOpenEditExportProofRequestSchema.safeParse({ ...request, sourceRelativePath: '../secret.ARW' }).success,
    ).toBe(false);
    expect(
      rawOpenEditExportProofRequestSchema.safeParse({
        ...request,
        editCommand: {
          ...request.editCommand,
          parameters: { ...request.editCommand.parameters, operation: { kind: 'set_mix', mix: 1.1 } },
        },
      }).success,
    ).toBe(false);
  });
});
