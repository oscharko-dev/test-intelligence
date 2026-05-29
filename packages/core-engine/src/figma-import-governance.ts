import type {
  FigmaSnapshotImportBudgetMetadata,
  FigmaSnapshotImportBudgetResourceType,
  FigmaSnapshotImportCredentialAuthMode,
  FigmaSnapshotImportCredentialMetadata,
  FigmaSnapshotImportFailureClass,
  FigmaSnapshotImportRateLimitRemediation,
  FigmaSnapshotSourceIdentifier,
} from "@oscharko-dev/ti-contracts";
import { redactHighRiskSecrets } from "@oscharko-dev/ti-security";

const SUPPORTED_AUTH_MODES = new Set<FigmaSnapshotImportCredentialAuthMode>([
  "personal_access_token",
  "enterprise_service_token",
]);
const DECLARED_AUTH_MODES = new Set<FigmaSnapshotImportCredentialAuthMode>([
  "personal_access_token",
  "oauth_access_token",
  "enterprise_service_token",
]);
const DEFAULT_POLICY_VERSION = "figma-import-budget/v1" as const;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 120;
const DEFAULT_RESOURCE_MAX_REQUESTS: Record<
  FigmaSnapshotImportBudgetResourceType,
  number
> = {
  file_bootstrap: 4,
  node_batch: 80,
  image_metadata: 80,
};
const AUTH_HEADER_LIKE_RE =
  /^(?:bearer\s+|authorization\s*:|x-figma-token\s*:)/iu;
const URI_LIKE_RE =
  /(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\b(?:mailto|tel|sms|urn|data|javascript):)\S+/iu;
const TOKEN_LIKE_RE = /\bfigd_[A-Za-z0-9_-]{8,}\b/iu;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

export interface FigmaImportCredentialInput {
  readonly authMode?: FigmaSnapshotImportCredentialAuthMode | string;
  readonly accessToken?: string;
}

export interface ResolvedFigmaImportCredential {
  readonly authMode: FigmaSnapshotImportCredentialAuthMode;
  readonly accessToken: string;
  readonly metadata: FigmaSnapshotImportCredentialMetadata;
}

export interface FigmaImportBudgetPolicyInput {
  readonly policyVersion?: string;
  readonly windowSeconds?: number;
  readonly maxRequestsPerWindow?: number;
  readonly resourceMaxRequestsPerWindow?: Partial<
    Record<FigmaSnapshotImportBudgetResourceType, number>
  >;
  readonly minimumDelayMs?: number;
}

export type FigmaImportGovernanceErrorCode = Extract<
  FigmaSnapshotImportFailureClass,
  | "missing_credential"
  | "invalid_credential"
  | "unsupported_auth_mode"
  | "budget_exhausted"
>;

export class FigmaImportGovernanceError extends Error {
  readonly errorCode: FigmaImportGovernanceErrorCode;
  readonly failureClass: FigmaImportGovernanceErrorCode;
  readonly budget?: FigmaSnapshotImportBudgetMetadata;

  constructor(input: {
    errorCode: FigmaImportGovernanceErrorCode;
    message: string;
    budget?: FigmaSnapshotImportBudgetMetadata;
    cause?: unknown;
  }) {
    super(
      sanitizeGovernanceText(input.message),
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FigmaImportGovernanceError";
    this.errorCode = input.errorCode;
    this.failureClass = input.errorCode;
    if (input.budget !== undefined) this.budget = input.budget;
  }
}

export interface FigmaImportGovernance {
  readonly credential: ResolvedFigmaImportCredential;
  beforeRequest(
    resourceType: FigmaSnapshotImportBudgetResourceType,
  ): Promise<FigmaSnapshotImportBudgetMetadata>;
  snapshotBudget(
    resourceType?: FigmaSnapshotImportBudgetResourceType,
  ): FigmaSnapshotImportBudgetMetadata;
}

interface ResolvedBudgetPolicy {
  readonly policyVersion: string;
  readonly windowSeconds: number;
  readonly maxRequestsPerWindow: number;
  readonly resourceMaxRequestsPerWindow: Readonly<
    Record<FigmaSnapshotImportBudgetResourceType, number>
  >;
  readonly minimumDelayMs: number;
}

export const resolveFigmaImportCredential = (
  input: FigmaImportCredentialInput,
): ResolvedFigmaImportCredential => {
  const authMode = resolveAuthMode(input.authMode);
  const accessToken = input.accessToken?.trim();
  if (accessToken === undefined || accessToken.length === 0) {
    throw new FigmaImportGovernanceError({
      errorCode: "missing_credential",
      message: `Figma import credential is missing for auth mode ${authMode}.`,
    });
  }
  if (
    accessToken.length < 8 ||
    CONTROL_RE.test(accessToken) ||
    /\s/u.test(accessToken) ||
    AUTH_HEADER_LIKE_RE.test(accessToken) ||
    URI_LIKE_RE.test(accessToken)
  ) {
    throw new FigmaImportGovernanceError({
      errorCode: "invalid_credential",
      message: `Figma import credential is invalid for auth mode ${authMode}.`,
    });
  }
  return {
    authMode,
    accessToken,
    metadata: {
      authMode,
    },
  };
};

export const createFigmaImportGovernance = (input: {
  credential: ResolvedFigmaImportCredential;
  source: FigmaSnapshotSourceIdentifier;
  policy?: FigmaImportBudgetPolicyInput;
  windowStartedAt?: Date;
  sleepMs?: (ms: number) => Promise<void>;
}): FigmaImportGovernance => {
  const policy = resolveBudgetPolicy(input.policy);
  const windowStartedAt = input.windowStartedAt ?? new Date();
  const resourceCounts = new Map<
    FigmaSnapshotImportBudgetResourceType,
    number
  >();
  let totalCount = 0;
  let lastRequestAtMs: number | undefined;

  const snapshotBudget = (
    resourceType?: FigmaSnapshotImportBudgetResourceType,
  ): FigmaSnapshotImportBudgetMetadata => {
    const usedRequests =
      resourceType === undefined
        ? totalCount
        : (resourceCounts.get(resourceType) ?? 0);
    const maxRequestsPerWindow =
      resourceType === undefined
        ? policy.maxRequestsPerWindow
        : policy.resourceMaxRequestsPerWindow[resourceType];
    return buildBudgetMetadata({
      policy,
      windowStartedAt,
      usedRequests,
      maxRequestsPerWindow,
      ...(resourceType !== undefined ? { resourceType } : {}),
    });
  };

  return {
    credential: input.credential,
    beforeRequest: async (
      resourceType: FigmaSnapshotImportBudgetResourceType,
    ): Promise<FigmaSnapshotImportBudgetMetadata> => {
      const totalBudget = snapshotBudget();
      if (totalBudget.remainingRequests <= 0) {
        throw new FigmaImportGovernanceError({
          errorCode: "budget_exhausted",
          message:
            "Figma import token budget is exhausted for the current import window.",
          budget: totalBudget,
        });
      }
      const resourceBudget = snapshotBudget(resourceType);
      if (resourceBudget.remainingRequests <= 0) {
        throw new FigmaImportGovernanceError({
          errorCode: "budget_exhausted",
          message: `Figma import ${resourceType} budget is exhausted for the current import window.`,
          budget: resourceBudget,
        });
      }
      if (
        input.sleepMs !== undefined &&
        policy.minimumDelayMs > 0 &&
        lastRequestAtMs !== undefined
      ) {
        const elapsedMs = Date.now() - lastRequestAtMs;
        const remainingDelayMs = policy.minimumDelayMs - elapsedMs;
        if (remainingDelayMs > 0) await input.sleepMs(remainingDelayMs);
      }
      totalCount += 1;
      resourceCounts.set(
        resourceType,
        (resourceCounts.get(resourceType) ?? 0) + 1,
      );
      lastRequestAtMs = Date.now();
      return snapshotBudget(resourceType);
    },
    snapshotBudget,
  };
};

export const classifyFigmaRateLimitRemediation = (
  metadata: Readonly<FigmaRestRateLimitLike>,
): FigmaSnapshotImportRateLimitRemediation => {
  const planTier = normalizeLabel(metadata.figmaPlanTier);
  const rateLimitType = normalizeLabel(metadata.figmaRateLimitType);
  const retryAfterSeconds = metadata.retryAfterSeconds;
  const evidence = `${planTier ?? ""} ${rateLimitType ?? ""}`.toLowerCase();
  const lowLimit =
    /(?:free|starter|basic|trial|low|limited|dev)/u.test(evidence) ||
    (retryAfterSeconds !== undefined && retryAfterSeconds >= 60);
  const highLimit =
    /(?:enterprise|organization|org|business|pro|professional)/u.test(
      evidence,
    ) && !lowLimit;
  if (lowLimit) {
    return {
      scenario: "low_limit",
      guidance:
        "Observed Figma throttling is consistent with a low-limit plan or narrow quota bucket. Wait for the retry window, reduce the selected node scope, or use an enterprise-governed credential for scheduled imports.",
    };
  }
  if (highLimit) {
    return {
      scenario: "high_limit",
      guidance:
        "Observed Figma throttling occurred under an enterprise-capable plan. Stagger imports, reuse the local Snapshot Vault, and ask the platform owner to review sustained tenant-level or file-level throttling.",
    };
  }
  return {
    scenario: "unknown",
    guidance:
      "Figma returned rate-limit metadata without enough plan context. Wait for the retry window and rerun after confirming the credential, selected scope, and tenant import queue are correct.",
  };
};

type FigmaRestRateLimitLike = Pick<
  {
    readonly retryAfterSeconds?: number;
    readonly figmaPlanTier?: string;
    readonly figmaRateLimitType?: string;
  },
  "retryAfterSeconds" | "figmaPlanTier" | "figmaRateLimitType"
>;

const resolveAuthMode = (
  value: FigmaImportCredentialInput["authMode"],
): FigmaSnapshotImportCredentialAuthMode => {
  const authMode = value ?? "personal_access_token";
  if (
    !DECLARED_AUTH_MODES.has(authMode as FigmaSnapshotImportCredentialAuthMode)
  ) {
    throw new FigmaImportGovernanceError({
      errorCode: "unsupported_auth_mode",
      message: `Figma credential auth mode is unsupported: ${String(authMode)}.`,
    });
  }
  if (
    !SUPPORTED_AUTH_MODES.has(authMode as FigmaSnapshotImportCredentialAuthMode)
  ) {
    throw new FigmaImportGovernanceError({
      errorCode: "unsupported_auth_mode",
      message: `Figma credential auth mode ${String(authMode)} is reserved for a future OAuth implementation.`,
    });
  }
  return authMode as FigmaSnapshotImportCredentialAuthMode;
};

const resolveBudgetPolicy = (
  input: FigmaImportBudgetPolicyInput | undefined,
): ResolvedBudgetPolicy => {
  const resourceMaxRequestsPerWindow = {
    file_bootstrap: resolvePositiveInteger(
      input?.resourceMaxRequestsPerWindow?.file_bootstrap,
      DEFAULT_RESOURCE_MAX_REQUESTS.file_bootstrap,
    ),
    node_batch: resolvePositiveInteger(
      input?.resourceMaxRequestsPerWindow?.node_batch,
      DEFAULT_RESOURCE_MAX_REQUESTS.node_batch,
    ),
    image_metadata: resolvePositiveInteger(
      input?.resourceMaxRequestsPerWindow?.image_metadata,
      DEFAULT_RESOURCE_MAX_REQUESTS.image_metadata,
    ),
  };
  return {
    policyVersion:
      sanitizeOptionalLabel(input?.policyVersion) ?? DEFAULT_POLICY_VERSION,
    windowSeconds: resolvePositiveInteger(
      input?.windowSeconds,
      DEFAULT_WINDOW_SECONDS,
    ),
    maxRequestsPerWindow: resolvePositiveInteger(
      input?.maxRequestsPerWindow,
      DEFAULT_MAX_REQUESTS_PER_WINDOW,
    ),
    resourceMaxRequestsPerWindow,
    minimumDelayMs: resolveNonNegativeInteger(input?.minimumDelayMs, 0),
  };
};

const buildBudgetMetadata = (input: {
  policy: ResolvedBudgetPolicy;
  windowStartedAt: Date;
  usedRequests: number;
  maxRequestsPerWindow: number;
  resourceType?: FigmaSnapshotImportBudgetResourceType;
}): FigmaSnapshotImportBudgetMetadata => ({
  policyVersion: input.policy.policyVersion,
  ...(input.resourceType !== undefined
    ? { resourceType: input.resourceType }
    : {}),
  windowSeconds: input.policy.windowSeconds,
  maxRequestsPerWindow: input.maxRequestsPerWindow,
  usedRequests: input.usedRequests,
  remainingRequests: Math.max(
    0,
    input.maxRequestsPerWindow - input.usedRequests,
  ),
  resetAt: new Date(
    input.windowStartedAt.getTime() + input.policy.windowSeconds * 1000,
  ).toISOString(),
});

const resolvePositiveInteger = (
  value: number | undefined,
  fallback: number,
): number =>
  Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;

const resolveNonNegativeInteger = (
  value: number | undefined,
  fallback: number,
): number =>
  Number.isInteger(value) && value !== undefined && value >= 0
    ? value
    : fallback;

const sanitizeOptionalLabel = (
  value: string | undefined,
): string | undefined => {
  const sanitized =
    value === undefined
      ? undefined
      : sanitizeGovernanceText(value)
          .replace(/[^\w./:-]+/gu, "_")
          .slice(0, 120);
  return sanitized === undefined || sanitized.length === 0
    ? undefined
    : sanitized;
};

const normalizeLabel = (value: string | undefined): string | undefined =>
  sanitizeOptionalLabel(value)?.toLowerCase();

const sanitizeGovernanceText = (value: string): string =>
  redactHighRiskSecrets(value, "[redacted]")
    .replace(TOKEN_LIKE_RE, "[redacted]")
    .replace(URI_LIKE_RE, "[redacted-url]")
    .replace(CONTROL_RE, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 700);
