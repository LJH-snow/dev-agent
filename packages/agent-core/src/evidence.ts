import type {
  AppliedChangeSetRecord,
  ChangeSetEvidenceFile,
  EvidenceSummary,
} from "./memory.js";
import type { ValidationRecord, ValidationStatus } from "./validation.js";

/** Version of the intentionally narrow evidence projection exposed to operators. */
export const EVIDENCE_AUDIT_SCHEMA_VERSION = 1 as const;

/** Version of the metadata-only audit preflight response. */
export const EVIDENCE_AUDIT_PREVIEW_SCHEMA_VERSION = 1 as const;

/** Fixed upper bounds for caller-supplied audit export limits. */
export const EVIDENCE_AUDIT_LIMIT_CAPS = {
  maxValidations: 10_000,
  maxChangeSets: 10_000,
  maxFiles: 100_000,
  maxBytes: 10 * 1024 * 1024,
} as const;

export const EVIDENCE_AUDIT_LIMIT_ERROR_CODE =
  "EVIDENCE_AUDIT_LIMIT_EXCEEDED" as const;

export type EvidenceAuditLimitKind =
  | "validations"
  | "changeSets"
  | "files"
  | "bytes";

export interface EvidenceAuditLimits {
  readonly maxValidations?: number;
  readonly maxChangeSets?: number;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
}

/**
 * Structured, metadata-only failure returned when a complete v1 snapshot is
 * larger than an explicitly requested limit. Only the four enumerable fields
 * below are part of the public error shape.
 */
export class EvidenceAuditLimitError extends Error {
  readonly code = EVIDENCE_AUDIT_LIMIT_ERROR_CODE;
  readonly kind: EvidenceAuditLimitKind;
  readonly limit: number;
  readonly actual: number;

  constructor(kind: EvidenceAuditLimitKind, limit: number, actual: number) {
    super(`evidence audit ${kind} limit exceeded`);
    this.kind = kind;
    this.limit = limit;
    this.actual = actual;
  }
}

export interface EvidenceAuditOptions {
  readonly generatedAt?: string;
  readonly limits?: EvidenceAuditLimits;
}

export interface EvidenceAuditFilters {
  readonly changeSetId?: string;
  readonly validationId?: string;
  readonly status?: ValidationStatus;
}

export interface EvidenceAuditCheck {
  readonly id: string;
  readonly status: ValidationStatus;
  readonly durationMs: number;
  readonly exitCode?: number;
}

export interface EvidenceAuditValidation {
  readonly validationId: string;
  readonly changeSetId: string;
  readonly status: ValidationStatus;
  readonly durationMs: number;
  readonly recordedAt: string;
  readonly checks: readonly EvidenceAuditCheck[];
}

export interface EvidenceAuditFile {
  readonly path: string;
  readonly kind: ChangeSetEvidenceFile["kind"];
  readonly beforeHash?: string;
  readonly afterHash: string;
  readonly additions: number;
  readonly deletions: number;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
}

export interface EvidenceAuditChangeSet {
  readonly changeSetId: string;
  readonly state: AppliedChangeSetRecord["state"];
  readonly files: readonly EvidenceAuditFile[];
  readonly additions: number;
  readonly deletions: number;
  readonly createdAt: string;
  readonly recordedAt: string;
}

/**
 * A stable, metadata-only projection of session evidence.
 *
 * This type deliberately has no command, cwd, output, error, diff, patch,
 * working-directory, or file-content fields. Keep it separate from the
 * persisted DTOs so new internal fields never become export fields by default.
 */
export interface EvidenceAuditExport {
  readonly schemaVersion: typeof EVIDENCE_AUDIT_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly generatedAt: string;
  readonly summary: EvidenceSummary;
  readonly validations: readonly EvidenceAuditValidation[];
  readonly changeSets: readonly EvidenceAuditChangeSet[];
}

/**
 * Metadata-only sizing information for a complete v1 audit projection.
 *
 * This schema is deliberately separate from `EvidenceAuditExport`: it is a
 * preflight response and never carries the evidence projection itself.
 */
export interface EvidenceAuditPreview {
  readonly schemaVersion: typeof EVIDENCE_AUDIT_PREVIEW_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly generatedAt: string;
  readonly validationCount: number;
  readonly changeSetCount: number;
  readonly fileCount: number;
  readonly serializedBytes: number;
}

export interface EvidenceAuditPreviewOptions {
  readonly generatedAt?: string;
}

/**
 * Selects the evidence associated with an optional audit filter. Change sets
 * follow validation filters so a filtered audit cannot accidentally include an
 * unrelated change-set record.
 */
export function selectEvidenceForAudit(
  validations: readonly ValidationRecord[],
  changeSets: readonly AppliedChangeSetRecord[],
  filters: EvidenceAuditFilters = {}
): {
  readonly validations: ValidationRecord[];
  readonly changeSets: AppliedChangeSetRecord[];
} {
  const matchingValidations = validations.filter((validation) => {
    if (
      filters.changeSetId !== undefined &&
      validation.changeSetId !== filters.changeSetId
    ) {
      return false;
    }
    if (
      filters.validationId !== undefined &&
      validation.validationId !== filters.validationId
    ) {
      return false;
    }
    return filters.status === undefined || validation.status === filters.status;
  });
  const hasValidationFilter =
    filters.validationId !== undefined || filters.status !== undefined;
  const matchingChangeSetIds = new Set(
    matchingValidations.map((validation) => validation.changeSetId)
  );
  const matchingChangeSets = changeSets.filter((changeSet) => {
    if (
      filters.changeSetId !== undefined &&
      changeSet.changeSetId !== filters.changeSetId
    ) {
      return false;
    }
    return !hasValidationFilter || matchingChangeSetIds.has(changeSet.changeSetId);
  });
  return {
    validations: matchingValidations,
    changeSets: matchingChangeSets,
  };
}

/**
 * Projects persisted evidence into a fixed, read-only audit schema.
 *
 * The function only allocates new objects and arrays. It never reads the
 * working directory and never mutates the supplied records.
 */
export function createEvidenceAuditExport(
  sessionId: string,
  validations: readonly ValidationRecord[],
  changeSets: readonly AppliedChangeSetRecord[],
  summary: EvidenceSummary,
  options: EvidenceAuditOptions = {}
): EvidenceAuditExport {
  assertNonEmptyString(sessionId, "sessionId");
  validateEvidenceAuditLimits(options.limits);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  assertNonEmptyString(generatedAt, "generatedAt");

  const projectedValidations = [...validations]
    .sort(compareValidations)
    .map(projectValidation);
  const projectedChangeSets = [...changeSets]
    .sort(compareChangeSets)
    .map(projectChangeSet);

  const audit: EvidenceAuditExport = {
    schemaVersion: EVIDENCE_AUDIT_SCHEMA_VERSION,
    sessionId,
    generatedAt,
    summary: projectSummary(summary),
    validations: projectedValidations,
    changeSets: projectedChangeSets,
  };
  assertEvidenceAuditWithinLimits(audit, options.limits);
  return audit;
}

/**
 * Serializes a v1 audit projection using its canonical object and array order.
 * The same representation is used for byte limits and preview sizing.
 */
export function serializeEvidenceAuditExport(audit: EvidenceAuditExport): string {
  return JSON.stringify(audit);
}

/**
 * Builds a metadata-only preflight for the complete v1 audit projection.
 * Preview creation is read-only and intentionally does not accept export
 * limits: callers need the full size before choosing a rejection-only limit.
 */
export function createEvidenceAuditPreview(
  sessionId: string,
  validations: readonly ValidationRecord[],
  changeSets: readonly AppliedChangeSetRecord[],
  summary: EvidenceSummary,
  options: EvidenceAuditPreviewOptions = {}
): EvidenceAuditPreview {
  const audit = createEvidenceAuditExport(
    sessionId,
    validations,
    changeSets,
    summary,
    { generatedAt: options.generatedAt }
  );
  const serialized = serializeEvidenceAuditExport(audit);
  return {
    schemaVersion: EVIDENCE_AUDIT_PREVIEW_SCHEMA_VERSION,
    sessionId: audit.sessionId,
    generatedAt: audit.generatedAt,
    validationCount: audit.validations.length,
    changeSetCount: audit.changeSets.length,
    fileCount: audit.changeSets.reduce(
      (count, changeSet) => count + changeSet.files.length,
      0
    ),
    serializedBytes: Buffer.byteLength(serialized, "utf8"),
  };
}

/** Validates caller-supplied limits without reading or changing any evidence. */
export function validateEvidenceAuditLimits(limits?: EvidenceAuditLimits): void {
  if (limits === undefined) {
    return;
  }
  if (limits === null || typeof limits !== "object" || Array.isArray(limits)) {
    throw new TypeError("evidence audit limits must be an object");
  }

  for (const key of Object.keys(limits)) {
    if (!isEvidenceAuditLimitKey(key)) {
      throw new TypeError(`unsupported evidence audit limit: ${key}`);
    }
    const value = limits[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${key} must be a positive integer`);
    }
    if (value > EVIDENCE_AUDIT_LIMIT_CAPS[key]) {
      throw new RangeError(
        `${key} must not exceed the maximum ${EVIDENCE_AUDIT_LIMIT_CAPS[key]}`
      );
    }
  }
}


function assertEvidenceAuditWithinLimits(
  audit: EvidenceAuditExport,
  limits?: EvidenceAuditLimits
): void {
  if (limits === undefined) {
    return;
  }
  if (
    limits.maxValidations !== undefined &&
    audit.validations.length > limits.maxValidations
  ) {
    throw new EvidenceAuditLimitError(
      "validations",
      limits.maxValidations,
      audit.validations.length
    );
  }
  if (
    limits.maxChangeSets !== undefined &&
    audit.changeSets.length > limits.maxChangeSets
  ) {
    throw new EvidenceAuditLimitError(
      "changeSets",
      limits.maxChangeSets,
      audit.changeSets.length
    );
  }

  const fileCount = audit.changeSets.reduce(
    (count, changeSet) => count + changeSet.files.length,
    0
  );
  if (limits.maxFiles !== undefined && fileCount > limits.maxFiles) {
    throw new EvidenceAuditLimitError("files", limits.maxFiles, fileCount);
  }

  if (limits.maxBytes !== undefined) {
    const byteCount = Buffer.byteLength(serializeEvidenceAuditExport(audit), "utf8");
    if (byteCount > limits.maxBytes) {
      throw new EvidenceAuditLimitError("bytes", limits.maxBytes, byteCount);
    }
  }
}

function isEvidenceAuditLimitKey(
  value: string
): value is keyof EvidenceAuditLimits {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_AUDIT_LIMIT_CAPS, value);
}

function projectValidation(record: ValidationRecord): EvidenceAuditValidation {
  return {
    validationId: record.validationId,
    changeSetId: record.changeSetId,
    status: record.status,
    durationMs: record.durationMs,
    recordedAt: record.recordedAt,
    checks: [...record.checks]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((check) => ({
        id: check.id,
        status: check.status,
        durationMs: check.durationMs,
        ...(check.exitCode === undefined ? {} : { exitCode: check.exitCode }),
      })),
  };
}

function projectChangeSet(record: AppliedChangeSetRecord): EvidenceAuditChangeSet {
  return {
    changeSetId: record.changeSetId,
    state: record.state,
    files: [...record.files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(projectFile),
    additions: record.additions,
    deletions: record.deletions,
    createdAt: record.createdAt,
    recordedAt: record.recordedAt,
  };
}

function projectFile(file: ChangeSetEvidenceFile): EvidenceAuditFile {
  const path = normalizeRelativePath(file.path);
  return {
    path,
    kind: file.kind,
    ...(file.beforeHash === undefined ? {} : { beforeHash: file.beforeHash }),
    afterHash: file.afterHash,
    additions: file.additions,
    deletions: file.deletions,
    beforeExists: file.beforeExists,
    afterExists: file.afterExists,
  };
}

function projectSummary(summary: EvidenceSummary): EvidenceSummary {
  return {
    validations: summary.validations,
    changeSets: summary.changeSets,
    protectedChangeSets: summary.protectedChangeSets,
    rolledBackChangeSets: summary.rolledBackChangeSets,
    retention: {
      maxValidations: summary.retention.maxValidations,
      maxChangeSets: summary.retention.maxChangeSets,
    },
    protectedChangeSetsReason: "applied change-set guards are retained for validation",
  };
}

function compareValidations(left: ValidationRecord, right: ValidationRecord): number {
  return left.recordedAt.localeCompare(right.recordedAt) ||
    left.validationId.localeCompare(right.validationId);
}

function compareChangeSets(
  left: AppliedChangeSetRecord,
  right: AppliedChangeSetRecord
): number {
  return left.recordedAt.localeCompare(right.recordedAt) ||
    left.changeSetId.localeCompare(right.changeSetId);
}

function normalizeRelativePath(value: string): string {
  assertNonEmptyString(value, "evidence path");
  if (value.includes("\u0000")) {
    throw new Error("evidence path must be a relative path without NUL bytes");
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("evidence path must be a relative path without parent traversal");
  }
  return normalized;
}

function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}
