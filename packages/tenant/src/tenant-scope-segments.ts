import type { TenantScope } from "@oscharko-dev/ti-contracts";

/**
 * Validate a {@link TenantScope} and return its on-disk path segments
 * `[tenantId, environmentId, projectId]` (Issue #1944).
 *
 * Each segment is constrained to a single path component: empty strings,
 * separators (`/`, `\`), and the traversal token `..` are rejected so a
 * caller cannot escape the tenant directory by injecting a crafted scope.
 * Missing `projectId` is normalised to `"default"` so the layout is always
 * three segments deep.
 *
 * Extracted from `src/test-intelligence/replay-cache.ts` into the tenant
 * package (Issue #78) so the tenant package depends only on Contracts per
 * module-map.md. The implementation in replay-cache.ts re-exports from here
 * during the bootstrap period.
 */
export const resolveTenantScopeSegments = (
  scope: TenantScope,
): readonly [string, string, string] => {
  assertSegment("tenantId", scope.tenantId);
  assertSegment("environmentId", scope.environmentId);
  const projectId = scope.projectId ?? "default";
  assertSegment("projectId", projectId);
  return [scope.tenantId, scope.environmentId, projectId];
};

const assertSegment = (field: string, value: string): void => {
  if (value.length === 0) {
    throw new RangeError(`TenantScope.${field} must not be empty`);
  }
  if (value === "." || value === "..") {
    throw new RangeError(
      `TenantScope.${field} must not be a path traversal token`,
    );
  }
  if (/[\\/]/u.test(value)) {
    throw new RangeError(
      `TenantScope.${field} must not contain a path separator`,
    );
  }
  if (value.includes("\0")) {
    throw new RangeError(`TenantScope.${field} must not contain a NUL byte`);
  }
};
