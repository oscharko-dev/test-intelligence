/**
 * Public import surface for the Workbench storage boundary.
 *
 * Server code depends on this barrel (`@/lib/server/storage`) rather than the
 * individual modules so the concrete implementation can be swapped without
 * touching call sites.
 */

export type {
  ArtifactKind,
  ArtifactMetadataRecord,
  ArtifactRepository,
  ContentRef,
  CreateArtifactInput,
  CreateExportInput,
  CreateGeneratedSeedInput,
  CreateRunInput,
  CreateScopeBasketInput,
  CreateSnapshotInput,
  ExportFormat,
  ExportMetadataRecord,
  ExportRepository,
  GeneratedSeedMetadataRecord,
  GeneratedSeedRepository,
  IsoTimestamp,
  RunIdFilter,
  RunMetadataRecord,
  RunRepository,
  ScopeBasketChanges,
  ScopeBasketFilter,
  ScopeBasketRecord,
  ScopeBasketRepository,
  ScopeSelection,
  Sha256Hex,
  SnapshotMetadataRecord,
  SnapshotRepository,
  TenantScopeFilter,
  WorkbenchRunStatus,
} from "./types";

export type {
  WorkbenchStorageAdapter,
  WorkbenchStorageErrorCode,
} from "./storage-adapter";
export { WorkbenchStorageError } from "./storage-adapter";

export type { WorkbenchMigration } from "./migrations";
export { WORKBENCH_MIGRATIONS, validateMigrationSequence } from "./migrations";

export type { WorkbenchStoragePaths } from "./db-path";
export {
  artifactAbsolutePath,
  artifactStorageRef,
  resolveWorkbenchStoragePaths,
  sha256Hex,
} from "./db-path";

export { createMemoryWorkbenchStorageAdapter } from "./memory-adapter";
