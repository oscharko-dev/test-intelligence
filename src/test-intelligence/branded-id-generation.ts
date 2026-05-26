/**
 * Typed branded-ID generators for `@oscharko-dev/test-intelligence`.
 *
 * Generated identifiers use the `ti-` prefix to assert standalone product
 * identity. This module depends one-directionally on `src/contracts/`.
 */

import { randomBytes } from "node:crypto";

import { validateBrandedIdLabel } from "@oscharko-dev/ti-contracts";
import type {
  AgentRoleProfileId,
  EvidenceArtifactId,
  JobId,
  LessonId,
  RoleStepId,
} from "@oscharko-dev/ti-contracts";

const generateBrandedId = <T extends string>(label?: string): T => {
  const normalizedLabel = validateBrandedIdLabel(label);
  const suffix = randomBytes(8).toString("hex");
  return (
    normalizedLabel === null
      ? `ti-${suffix}`
      : `ti-${normalizedLabel}-${suffix}`
  ) as T;
};

/** Generates a fresh {@link JobId} with an optional normalized label. */
export const generateJobId = (label?: string): JobId =>
  generateBrandedId<JobId>(label);

/** Generates a fresh {@link RoleStepId} with an optional normalized label. */
export const generateRoleStepId = (label?: string): RoleStepId =>
  generateBrandedId<RoleStepId>(label);

/** Generates a fresh {@link AgentRoleProfileId} with an optional label. */
export const generateAgentRoleProfileId = (
  label?: string,
): AgentRoleProfileId => generateBrandedId<AgentRoleProfileId>(label);

/** Generates a fresh {@link EvidenceArtifactId} with an optional label. */
export const generateEvidenceArtifactId = (
  label?: string,
): EvidenceArtifactId => generateBrandedId<EvidenceArtifactId>(label);

/** Generates a fresh {@link LessonId} with an optional normalized label. */
export const generateLessonId = (label?: string): LessonId =>
  generateBrandedId<LessonId>(label);
