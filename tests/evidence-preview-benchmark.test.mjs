import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceAuditExport,
  createEvidenceAuditPreview,
  serializeEvidenceAuditExport,
} from "../packages/agent-core/dist/index.js";

import {
  BENCHMARK_FIXTURE_IDS,
  BENCHMARK_SCHEMA_VERSION,
  BENCHMARK_SESSION_PREFIX,
  createEvidencePreviewBenchmarkFixture,
  runEvidencePreviewBenchmark,
} from "../scripts/evidence-preview-benchmark.mjs";

test("evidence preview benchmark exposes a fixed metadata-only artifact", () => {
  const artifact = runEvidencePreviewBenchmark({
    fixtureIds: ["empty", "utf8-heavy"],
    generatedAt: "2026-09-14T00:45:00.000Z",
  });

  assert.deepEqual(Object.keys(artifact), ["schemaVersion", "generatedAt", "results"]);
  assert.equal(artifact.schemaVersion, BENCHMARK_SCHEMA_VERSION);
  assert.equal(artifact.generatedAt, "2026-09-14T00:45:00.000Z");
  assert.deepEqual(
    artifact.results.map((result) => result.fixtureId),
    ["empty", "utf8-heavy"]
  );
  for (const result of artifact.results) {
    assert.deepEqual(Object.keys(result), [
      "fixtureId",
      "validationCount",
      "changeSetCount",
      "fileCount",
      "serializedBytes",
      "durationMs",
      "heapUsedBefore",
      "heapUsedAfter",
      "heapDelta",
    ]);
    for (const key of [
      "validationCount",
      "changeSetCount",
      "fileCount",
      "serializedBytes",
      "durationMs",
      "heapUsedBefore",
      "heapUsedAfter",
      "heapDelta",
    ]) {
      assert.equal(Number.isSafeInteger(result[key]), true, `${result.fixtureId}.${key}`);
      assert.ok(result[key] >= 0, `${result.fixtureId}.${key}`);
    }
  }
  assert.deepEqual(artifact.results[0], {
    fixtureId: "empty",
    validationCount: 0,
    changeSetCount: 0,
    fileCount: 0,
    serializedBytes: 354,
    durationMs: artifact.results[0].durationMs,
    heapUsedBefore: artifact.results[0].heapUsedBefore,
    heapUsedAfter: artifact.results[0].heapUsedAfter,
    heapDelta: artifact.results[0].heapDelta,
  });
  assert.ok(artifact.results[1].serializedBytes > 0);
});

test("evidence preview benchmark keeps the planned fixture matrix", () => {
  assert.deepEqual(BENCHMARK_FIXTURE_IDS, [
    "empty",
    "small",
    "retention-sized",
    "record-cap-sized",
    "files-heavy",
    "utf8-heavy",
  ]);
});

test("evidence preview benchmark preserves canonical bytes and input order semantics", () => {
  const fixture = createEvidencePreviewBenchmarkFixture("utf8-heavy");
  const before = structuredClone(fixture);
  const sessionId = `${BENCHMARK_SESSION_PREFIX}utf8-heavy`;
  const options = { generatedAt: "2026-09-14T00:45:00.000Z" };

  const preview = createEvidenceAuditPreview(
    sessionId,
    fixture.validations,
    fixture.changeSets,
    fixture.summary,
    options
  );
  const fullExport = createEvidenceAuditExport(
    sessionId,
    fixture.validations,
    fixture.changeSets,
    fixture.summary,
    options
  );
  const reversedPreview = createEvidenceAuditPreview(
    sessionId,
    [...fixture.validations].reverse(),
    [...fixture.changeSets].reverse(),
    fixture.summary,
    options
  );

  assert.equal(
    preview.serializedBytes,
    Buffer.byteLength(serializeEvidenceAuditExport(fullExport), "utf8")
  );
  assert.deepEqual(reversedPreview, preview);
  assert.deepEqual(fixture, before);
});

test("evidence preview benchmark artifact contains no sensitive fixture fields", () => {
  const artifact = runEvidencePreviewBenchmark({
    fixtureIds: ["small", "utf8-heavy"],
    generatedAt: "2026-09-14T00:45:00.000Z",
  });
  const serialized = JSON.stringify(artifact);

  assert.doesNotMatch(serialized, /synthetic|workingDirectory|cwd|command|diff|output|error/);
  assert.deepEqual(Object.keys(artifact.results[0]), [
    "fixtureId",
    "validationCount",
    "changeSetCount",
    "fileCount",
    "serializedBytes",
    "durationMs",
    "heapUsedBefore",
    "heapUsedAfter",
    "heapDelta",
  ]);
});

test("evidence preview benchmark rejects malformed fixture selections", () => {
  assert.throws(
    () => runEvidencePreviewBenchmark({ fixtureIds: [] }),
    /fixtureIds must be a non-empty array/
  );
  assert.throws(
    () => runEvidencePreviewBenchmark({ fixtureIds: ["unknown"] }),
    /unknown evidence preview benchmark fixture: unknown/
  );
  assert.throws(
    () => runEvidencePreviewBenchmark({ fixtureIds: ["empty"], generatedAt: "" }),
    /generatedAt must be a non-empty string/
  );
});
