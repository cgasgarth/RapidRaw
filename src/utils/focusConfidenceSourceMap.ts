import {
  type FocusConfidenceSourceMapReport,
  focusConfidenceSourceMapReportSchema,
} from '../schemas/focusConfidenceSourceMapSchemas';

import type { FocusSharpnessMapReport } from '../schemas/focusSharpnessMapSchemas';

export const buildFocusConfidenceSourceMapReport = (
  sharpnessReport: FocusSharpnessMapReport,
): FocusConfidenceSourceMapReport =>
  focusConfidenceSourceMapReportSchema.parse({
    doesNotProve: sharpnessReport.doesNotProve,
    fixtures: sharpnessReport.fixtures.map((fixture) => {
      const cellCount = fixture.map.cells.length;
      const winnerCounts = new Map<number, number>();
      for (const cell of fixture.map.cells) {
        winnerCounts.set(cell.winnerSourceIndex, (winnerCounts.get(cell.winnerSourceIndex) ?? 0) + 1);
      }

      return {
        fixtureId: fixture.fixtureId,
        grid: {
          cellCount,
          cellSize: fixture.map.cellSize,
          lowConfidenceCellRatio: roundRatio(
            fixture.map.cells.filter((cell) => cell.lowConfidence).length / Math.max(1, cellCount),
          ),
        },
        referenceSourceIndex: fixture.referenceSourceIndex,
        sourceSummaries: fixture.appliedTransforms.map((transform) => ({
          sourceIndex: transform.sourceIndex,
          winnerCellRatio: roundRatio((winnerCounts.get(transform.sourceIndex) ?? 0) / Math.max(1, cellCount)),
        })),
        warningCodes: fixture.expectedWarningCodes,
      };
    }),
    generatedFrom: 'tests/integration/checks/check-focus-confidence-source-map.ts',
    issue: 2354,
    schemaVersion: 1,
    sourceSharpnessArtifact: 'artifacts/focus-sharpness-map/focus-sharpness-map-report.json',
    status: 'synthetic_source_confidence_artifact_generated',
  });

const roundRatio = (value: number): number => Number(value.toFixed(6));
