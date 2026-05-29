import {
  DEFAULT_TENANT_SCOPE,
  type TenantScope,
} from "@oscharko-dev/ti-contracts";
import { resolveTenantScopeSegments } from "@oscharko-dev/ti-tenant";

const readScopeSegment = (
  env: NodeJS.ProcessEnv,
  names: readonly string[],
  fallback: string,
): string => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return fallback;
};

export const resolveWorkbenchTenantScope = (
  env: NodeJS.ProcessEnv = process.env,
): TenantScope => {
  const scope: TenantScope = {
    tenantId: readScopeSegment(
      env,
      ["TEST_INTELLIGENCE_TENANT_ID", "WORKBENCH_TENANT_ID"],
      DEFAULT_TENANT_SCOPE.tenantId,
    ),
    environmentId: readScopeSegment(
      env,
      ["TEST_INTELLIGENCE_ENVIRONMENT_ID", "WORKBENCH_ENVIRONMENT_ID"],
      DEFAULT_TENANT_SCOPE.environmentId,
    ),
    projectId: readScopeSegment(
      env,
      ["TEST_INTELLIGENCE_PROJECT_ID", "WORKBENCH_PROJECT_ID"],
      DEFAULT_TENANT_SCOPE.projectId ?? "default",
    ),
  };
  resolveTenantScopeSegments(scope);
  return scope;
};

export const formatWorkbenchTenantScope = (scope: TenantScope): string =>
  resolveTenantScopeSegments(scope).join("/");
