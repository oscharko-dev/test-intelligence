/**
 * Branded-ID factory types and runtime helpers for the public contract
 * surface of `@oscharko-dev/test-intelligence`.
 *
 * This module is a leaf node: it imports nothing. Branded IDs use the
 * `ti-` prefix to assert standalone Test Intelligence product identity.
 */

/** Opaque identifier for a generation job. */
export type JobId = string & { readonly __brand: "JobId" };
/** Opaque identifier for a single agent role step within a job. */
export type RoleStepId = string & { readonly __brand: "RoleStepId" };
/** Opaque identifier for an agent role profile. */
export type AgentRoleProfileId = string & {
  readonly __brand: "AgentRoleProfileId";
};
/** Opaque identifier for a sealed evidence artifact. */
export type EvidenceArtifactId = string & {
  readonly __brand: "EvidenceArtifactId";
};
/** Opaque identifier for a recorded agent lesson. */
export type LessonId = string & { readonly __brand: "LessonId" };

/** Maximum permitted depth of a role-lineage chain. */
export const MAX_ROLE_LINEAGE_DEPTH = 10 as const;

const ID_BODY_RE = "[0-9a-f]{16}";
const LABEL_RE = "[a-z0-9]+(?:-[a-z0-9]+)*";
const BRANDED_ID_RE = new RegExp(`^ti-(?:${LABEL_RE}-)?${ID_BODY_RE}$`, "u");
const LABEL_ONLY_RE = new RegExp(`^${LABEL_RE}$`, "u");

const asBrand = <T extends string>(value: string): T => value as T;

const normalizeLabel = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return LABEL_ONLY_RE.test(trimmed) ? trimmed : null;
};

const toBrandedId = <T extends string>(value: string): T | null =>
  BRANDED_ID_RE.test(value) ? asBrand<T>(value) : null;

/** Returns `true` when `value` matches the `ti-` branded-ID shape. */
export const isBrandedId = (value: string): boolean =>
  BRANDED_ID_RE.test(value);

/** Parses `value` as a {@link JobId}, returning `null` on a shape mismatch. */
export const toJobId = (value: string): JobId | null =>
  toBrandedId<JobId>(value);
/** Parses `value` as a {@link RoleStepId}, returning `null` on a shape mismatch. */
export const toRoleStepId = (value: string): RoleStepId | null =>
  toBrandedId<RoleStepId>(value);
/** Parses `value` as an {@link AgentRoleProfileId}, returning `null` on a shape mismatch. */
export const toAgentRoleProfileId = (
  value: string,
): AgentRoleProfileId | null => toBrandedId<AgentRoleProfileId>(value);
/** Parses `value` as an {@link EvidenceArtifactId}, returning `null` on a shape mismatch. */
export const toEvidenceArtifactId = (
  value: string,
): EvidenceArtifactId | null => toBrandedId<EvidenceArtifactId>(value);
/** Parses `value` as a {@link LessonId}, returning `null` on a shape mismatch. */
export const toLessonId = (value: string): LessonId | null =>
  toBrandedId<LessonId>(value);

/**
 * Normalizes an optional branded-ID label to lowercase kebab-case, or
 * returns `null` when the label is absent, empty, or malformed.
 */
export const validateBrandedIdLabel = (
  value: string | undefined,
): string | null => normalizeLabel(value);

/** Type guard: `value` is an integer role-lineage depth in `[0, MAX]`. */
export const isRoleLineageDepth = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_ROLE_LINEAGE_DEPTH;

/**
 * Asserts that an optional role-lineage depth is within bounds.
 *
 * @throws RangeError when `value` is defined but not an integer in `[0, MAX]`.
 */
export const assertRoleLineageDepth = (
  value: number | undefined,
  context: string,
): void => {
  if (value === undefined) {
    return;
  }
  if (!isRoleLineageDepth(value)) {
    throw new RangeError(
      `${context}: roleLineageDepth must be an integer in [0, ${MAX_ROLE_LINEAGE_DEPTH}]`,
    );
  }
};
