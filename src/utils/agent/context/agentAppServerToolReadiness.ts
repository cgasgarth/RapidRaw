import { z } from 'zod';
import {
  type RawEngineAppServerRouteCatalogEntry,
  type RawEngineAppServerRouteFamily,
  RawEngineAppServerRouteMode,
  type RawEngineAppServerRouteMode as RawEngineAppServerRouteModeValue,
  rawEngineAppServerRouteFamilySchema,
} from '../../../schemas/agent/agentRuntimeSchemas';
import { buildRawEngineAppServerRouteCatalog } from '../../rawEngineAppServerHost';

export const agentAppServerToolReadinessFamilySchema = z
  .object({
    applyRouteCount: z.number().int().nonnegative(),
    dryRunRouteCount: z.number().int().nonnegative(),
    family: rawEngineAppServerRouteFamilySchema,
    hostCommandRouteCount: z.number().int().nonnegative(),
    routeCount: z.number().int().positive(),
    runtimeCheckCount: z.number().int().nonnegative(),
    toolCount: z.number().int().positive(),
  })
  .strict();

export const agentAppServerToolReadinessSummarySchema = z
  .object({
    applyRouteCount: z.number().int().nonnegative(),
    dryRunRouteCount: z.number().int().nonnegative(),
    families: z.array(agentAppServerToolReadinessFamilySchema).min(1),
    familyCount: z.number().int().positive(),
    hostCommandRouteCount: z.number().int().nonnegative(),
    routeCount: z.number().int().positive(),
    runtimeCheckCount: z.number().int().nonnegative(),
    toolCount: z.number().int().positive(),
  })
  .strict();

export type AgentAppServerToolReadinessFamily = z.infer<typeof agentAppServerToolReadinessFamilySchema>;
export type AgentAppServerToolReadinessSummary = z.infer<typeof agentAppServerToolReadinessSummarySchema>;

const routeHasMode = (route: RawEngineAppServerRouteCatalogEntry, mode: RawEngineAppServerRouteModeValue): boolean =>
  route.modes.includes(mode);

const summarizeFamily = (
  family: RawEngineAppServerRouteFamily,
  routes: ReadonlyArray<RawEngineAppServerRouteCatalogEntry>,
): AgentAppServerToolReadinessFamily => {
  const toolNames = new Set(routes.flatMap((route) => route.toolNames));
  const runtimeChecks = new Set(routes.flatMap((route) => route.runtimeCheckScripts));

  return agentAppServerToolReadinessFamilySchema.parse({
    applyRouteCount: routes.filter((route) => routeHasMode(route, RawEngineAppServerRouteMode.ApplyDryRunPlan)).length,
    dryRunRouteCount: routes.filter((route) => routeHasMode(route, RawEngineAppServerRouteMode.DryRunCommand)).length,
    family,
    hostCommandRouteCount: routes.filter((route) => routeHasMode(route, RawEngineAppServerRouteMode.HostCommand))
      .length,
    routeCount: routes.length,
    runtimeCheckCount: runtimeChecks.size,
    toolCount: toolNames.size,
  });
};

export const buildAgentAppServerToolReadinessSummary = (
  routes = buildRawEngineAppServerRouteCatalog(),
): AgentAppServerToolReadinessSummary => {
  const families = [...new Set(routes.map((route) => route.family))]
    .sort((left, right) => left.localeCompare(right))
    .map((family) =>
      summarizeFamily(
        family,
        routes.filter((route) => route.family === family),
      ),
    );
  const toolNames = new Set(routes.flatMap((route) => route.toolNames));
  const runtimeChecks = new Set(routes.flatMap((route) => route.runtimeCheckScripts));

  return agentAppServerToolReadinessSummarySchema.parse({
    applyRouteCount: routes.filter((route) => routeHasMode(route, RawEngineAppServerRouteMode.ApplyDryRunPlan)).length,
    dryRunRouteCount: routes.filter((route) => routeHasMode(route, RawEngineAppServerRouteMode.DryRunCommand)).length,
    families,
    familyCount: families.length,
    hostCommandRouteCount: routes.filter((route) => routeHasMode(route, RawEngineAppServerRouteMode.HostCommand))
      .length,
    routeCount: routes.length,
    runtimeCheckCount: runtimeChecks.size,
    toolCount: toolNames.size,
  });
};
