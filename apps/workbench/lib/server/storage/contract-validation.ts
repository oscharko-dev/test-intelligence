import { artifactStorageRef } from "./db-path";
import { WorkbenchStorageError } from "./storage-adapter";
import type { ContentRef, RunMetadataRecord } from "./types";

export const assertCanonicalContentRef = (
  ref: ContentRef,
  fieldName: string,
): void => {
  let expectedStorageRef: string;
  try {
    expectedStorageRef = artifactStorageRef(ref.sha256);
  } catch (cause) {
    throw new WorkbenchStorageError(
      "CONTENT_REF_INVALID",
      `${fieldName} must use a canonical lowercase SHA-256 content hash.`,
      { cause },
    );
  }
  if (!Number.isSafeInteger(ref.byteSize) || ref.byteSize < 0) {
    throw new WorkbenchStorageError(
      "CONTENT_REF_INVALID",
      `${fieldName} byteSize must be a non-negative safe integer.`,
    );
  }
  if (ref.storageRef !== expectedStorageRef) {
    throw new WorkbenchStorageError(
      "CONTENT_REF_INVALID",
      `${fieldName} storageRef must match the canonical content-addressed path for sha256.`,
    );
  }
};

export const assertSameTenantRun = (
  run: RunMetadataRecord | undefined,
  tenantScope: string,
  relationName: string,
): RunMetadataRecord => {
  if (run === undefined || run.tenantScope !== tenantScope) {
    throw new WorkbenchStorageError(
      "REFERENTIAL_INTEGRITY",
      `${relationName} must reference an existing run in the same tenant scope.`,
    );
  }
  return run;
};
