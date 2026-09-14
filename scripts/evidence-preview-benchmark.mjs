import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createEvidenceAuditPreview } from "../packages/agent-core/dist/index.js";

export const BENCHMARK_SCHEMA_VERSION = 1;
export const BENCHMARK_SESSION_PREFIX = "benchmark:";
export const BENCHMARK_GENERATED_AT = "2026-09-14T00:45:00.000Z";

export const BENCHMARK_FIXTURE_IDS = Object.freeze([
  "empty",
  "small",
  "retention-sized",
  "record-cap-sized",
  "files-heavy",
  "utf8-heavy",
]);

const FIXTURE_CONFIGS = Object.freeze({
  empty: Object.freeze({ validationCount: 0, changeSetCount: 0, filesPerChangeSet: 0 }),
  small: Object.freeze({ validationCount: 2, changeSetCount: 2, filesPerChangeSet: 1 }),
  "retention-sized": Object.freeze({
    validationCount: 100,
    changeSetCount: 100,
    filesPerChangeSet: 1,
  }),
  "record-cap-sized": Object.freeze({
    validationCount: 10_000,
    changeSetCount: 10_000,
    filesPerChangeSet: 1,
  }),
  "files-heavy": Object.freeze({
    validationCount: 0,
    changeSetCount: 1,
    filesPerChangeSet: 100_000,
  }),
  "utf8-heavy": Object.freeze({
    validationCount: 16,
    changeSetCount: 8,
    filesPerChangeSet: 4,
    utf8: true,
  }),
});

const FIXED_RECORDED_AT = "2026-09-14T00:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SYNTHETIC_WORKING_DIRECTORY = "/synthetic/benchmark-workspace";
const SYNTHETIC_CHECK_COMMAND = {
  executable: "node",
  args: ["--synthetic-benchmark-check"],
  cwd: SYNTHETIC_WORKING_DIRECTORY,
  timeoutMs: 1_000,
};

/**
 * Builds one in-memory fixture. The input intentionally contains executable and
 * workspace-like fields so tests can prove the preview projection does not leak
 * them into the metadata-only result.
 */
export function createEvidencePreviewBenchmarkFixture(fixtureId) {
  const config = FIXTURE_CONFIGS[fixtureId];
  if (config === undefined) {
    throw new RangeError(`unknown evidence preview benchmark fixture: ${fixtureId}`);
  }

  const validations = [];
  for (let index = 0; index < config.validationCount; index += 1) {
    const changeSetIndex = index % Math.max(config.changeSetCount, 1);
    const changeSetId = makeChangeSetId(changeSetIndex, config.utf8 === true);
    const validationId = config.utf8 === true
      ? `验证-${index.toString().padStart(3, "0")}-🚀`
      : `validation:${index.toString().padStart(5, "0")}`;
    const checkId = config.utf8 === true
      ? `检查-${index.toString().padStart(3, "0")}`
      : `check:${index.toString().padStart(5, "0")}`;

    validations.push({
      validationId,
      changeSetId,
      status: "passed",
      checks: [
        {
          id: checkId,
          label: "synthetic benchmark check",
          command: SYNTHETIC_CHECK_COMMAND,
          status: "passed",
          durationMs: index % 17,
          exitCode: 0,
          output: "sensitive synthetic output must not be exported",
          error: "sensitive synthetic error must not be exported",
        },
      ],
      durationMs: index % 31,
      summary: "synthetic validation summary must not be exported",
      reason: "synthetic validation reason must not be exported",
      recordedAt: FIXED_RECORDED_AT,
    });
  }

  const changeSets = [];
  for (let index = 0; index < config.changeSetCount; index += 1) {
    const changeSetId = makeChangeSetId(index, config.utf8 === true);
    const files = [];
    for (let fileIndex = 0; fileIndex < config.filesPerChangeSet; fileIndex += 1) {
      const path = config.utf8 === true
        ? `src/示例-${index.toString().padStart(2, "0")}-${fileIndex}-🚀.ts`
        : `src/file-${index.toString().padStart(5, "0")}-${fileIndex}.ts`;
      files.push({
        path,
        kind: "file",
        beforeHash: HASH_A,
        afterHash: HASH_B,
        additions: 1,
        deletions: 0,
        beforeExists: true,
        afterExists: true,
      });
    }

    changeSets.push({
      changeSetId,
      sessionId: `${BENCHMARK_SESSION_PREFIX}${fixtureId}`,
      workingDirectory: SYNTHETIC_WORKING_DIRECTORY,
      files,
      additions: files.length,
      deletions: 0,
      createdAt: FIXED_RECORDED_AT,
      recordedAt: FIXED_RECORDED_AT,
      state: "applied",
      command: "synthetic command must not be exported",
      diff: "synthetic diff must not be exported",
    });
  }

  return {
    validations,
    changeSets,
    summary: {
      validations: validations.length,
      changeSets: changeSets.length,
      protectedChangeSets: changeSets.length,
      rolledBackChangeSets: 0,
      retention: {
        maxValidations: 100,
        maxChangeSets: 100,
      },
      protectedChangeSetsReason: "applied change-set guards are retained for validation",
    },
  };
}

/**
 * Runs the metadata-only benchmark without touching a workspace or provider.
 * Results intentionally contain measurements only; fixture contents never leave
 * this process.
 */
export function runEvidencePreviewBenchmark({
  fixtureIds = BENCHMARK_FIXTURE_IDS,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(fixtureIds) || fixtureIds.length === 0) {
    throw new TypeError("fixtureIds must be a non-empty array");
  }
  if (typeof generatedAt !== "string" || generatedAt.length === 0) {
    throw new TypeError("generatedAt must be a non-empty string");
  }

  const results = fixtureIds.map((fixtureId) => measureFixture(fixtureId, generatedAt));
  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    generatedAt,
    results,
  };
}

function measureFixture(fixtureId, generatedAt) {
  const fixture = createEvidencePreviewBenchmarkFixture(fixtureId);
  collectGarbageIfAvailable();
  const heapUsedBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const preview = createEvidenceAuditPreview(
    `${BENCHMARK_SESSION_PREFIX}${fixtureId}`,
    fixture.validations,
    fixture.changeSets,
    fixture.summary,
    { generatedAt }
  );
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const heapUsedAfter = process.memoryUsage().heapUsed;

  return {
    fixtureId,
    validationCount: preview.validationCount,
    changeSetCount: preview.changeSetCount,
    fileCount: preview.fileCount,
    serializedBytes: preview.serializedBytes,
    durationMs,
    heapUsedBefore,
    heapUsedAfter,
    heapDelta: Math.max(0, heapUsedAfter - heapUsedBefore),
  };
}

function makeChangeSetId(index, utf8) {
  return utf8
    ? `变更集-${index.toString().padStart(2, "0")}-🚀`
    : `change-set:${index.toString().padStart(5, "0")}`;
}

function collectGarbageIfAvailable() {
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }
}

async function writeBenchmarkArtifact(artifact) {
  const outputDirectory = resolve(".dev-agent");
  const outputPath = resolve(outputDirectory, "evidence-preview-benchmark.json");
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  return outputPath;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath !== undefined && import.meta.url === invokedPath) {
  const artifact = runEvidencePreviewBenchmark();
  const outputPath = await writeBenchmarkArtifact(artifact);
  console.log(JSON.stringify(artifact, null, 2));
  console.error(`benchmark artifact written to ${outputPath}`);
}
