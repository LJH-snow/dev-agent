import type {
  AppliedChangeSetRecord,
  ChangeSetEvidenceFile,
  EvidenceSummary,
} from "./memory.js";
import type { ValidationRecord, ValidationStatus } from "./validation.js";

/** Version of the intentionally narrow evidence projection exposed to operators. */
export const EVIDENCE_AUDIT_SCHEMA_VERSION = 1 as const;

export interface EvidenceAuditOptions {
  readonly generatedAt?: string;
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
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  assertNonEmptyString(generatedAt, "generatedAt");

  const projectedValidations = [...validations]
    .sort(compareValidations)
    .map(projectValidation);
  const projectedChangeSets = [...changeSets]
    .sort(compareChangeSets)
    .map(projectChangeSet);

  return {
    schemaVersion: EVIDENCE_AUDIT_SCHEMA_VERSION,
    sessionId,
    generatedAt,
    summary: projectSummary(summary),
    validations: projectedValidations,
    changeSets: projectedChangeSets,
  };
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
