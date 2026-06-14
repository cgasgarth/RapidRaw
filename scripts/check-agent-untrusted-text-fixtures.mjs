#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const repoRoot = resolve(import.meta.dir, '..');
const fixturePath = resolve(repoRoot, 'fixtures/agent/untrusted-agent-text-fixtures.json');

const warningSchema = z.enum([
  'approval_required_for_mutation',
  'file_operation_requires_approval',
  'untrusted_provider_text',
  'untrusted_text_data_only',
]);

const fixtureSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            caseId: z.string().regex(/^agent\.untrusted_text\.[a-z0-9_]+\.v[0-9]+$/u),
            expected: z
              .object({
                mustAskUserBeforeMutation: z.literal(true),
                normalizedRole: z.literal('data_only'),
                requiredWarnings: z.array(warningSchema).min(1),
              })
              .strict(),
            sourceKind: z.enum(['filename', 'metadata', 'preset_text', 'provider_response', 'sidecar']),
            text: z.string().trim().min(20),
          })
          .strict(),
      )
      .min(5),
    fixtureSetId: z.literal('agent.untrusted_text.v1'),
    policy: z
      .object({
        allowedPlanningActions: z.array(z.enum(['ask_user', 'dry_run_safe_read', 'summarize'])).min(1),
        blockedMutationTools: z
          .array(
            z.enum([
              'editgraph.apply_command',
              'export.apply_command',
              'project.library_mutate',
              'tonecolor.apply_command',
            ]),
          )
          .min(1),
        interpretation: z.string().trim().min(1),
      })
      .strict(),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((fixture, context) => {
    const requiredSourceKinds = new Set(['filename', 'metadata', 'preset_text', 'provider_response', 'sidecar']);
    const seenCaseIds = new Set();

    for (const [index, testCase] of fixture.cases.entries()) {
      if (seenCaseIds.has(testCase.caseId)) {
        context.addIssue({
          code: 'custom',
          message: 'Agent untrusted text fixture case IDs must be unique.',
          path: ['cases', index, 'caseId'],
        });
      }
      seenCaseIds.add(testCase.caseId);
      requiredSourceKinds.delete(testCase.sourceKind);

      if (
        !testCase.expected.requiredWarnings.includes('untrusted_text_data_only') &&
        testCase.sourceKind !== 'provider_response'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Non-provider untrusted text fixtures must require the data-only warning.',
          path: ['cases', index, 'expected', 'requiredWarnings'],
        });
      }

      if (
        testCase.sourceKind === 'provider_response' &&
        !testCase.expected.requiredWarnings.includes('untrusted_provider_text')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Provider response fixtures must require the provider-text warning.',
          path: ['cases', index, 'expected', 'requiredWarnings'],
        });
      }
    }

    for (const missingKind of requiredSourceKinds) {
      context.addIssue({
        code: 'custom',
        message: `Missing required untrusted text source kind: ${missingKind}.`,
        path: ['cases'],
      });
    }
  });

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
console.log(`Validated ${fixture.cases.length} agent untrusted-text fixtures.`);
