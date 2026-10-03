import assert from "node:assert/strict";
import test from "node:test";

type SessionSummary = {
  sessionId: string;
  entryCount?: number;
  run?: { status?: string };
};

type FilterModule = {
  filterSessionSummaries: (
    summaries: readonly SessionSummary[],
    options?: { query?: string; status?: string }
  ) => SessionSummary[];
};

async function loadFilterModule(): Promise<FilterModule> {
  return (await import(new URL("../public/session-filter.js", import.meta.url).href)) as FilterModule;
}

const summaries: readonly SessionSummary[] = [
  { sessionId: "Desktop-Alpha", entryCount: 4, run: { status: "done" } },
  { sessionId: "beta-build", entryCount: 0, run: { status: "running" } },
  { sessionId: "gamma-review", entryCount: 2, run: { status: "waiting" } },
  { sessionId: "idle-notes", entryCount: 1 },
];

test("session filters match ids case-insensitively and preserve source order", async () => {
  const { filterSessionSummaries } = await loadFilterModule();

  assert.deepEqual(
    filterSessionSummaries(summaries, { query: "ALPHA" }).map((summary) => summary.sessionId),
    ["Desktop-Alpha"]
  );
  assert.deepEqual(
    filterSessionSummaries(summaries, { query: "build" }).map((summary) => summary.sessionId),
    ["beta-build"]
  );
  assert.deepEqual(
    filterSessionSummaries(summaries, { query: "e" }).map((summary) => summary.sessionId),
    ["Desktop-Alpha", "beta-build", "gamma-review", "idle-notes"]
  );
});

test("session filters match normalized run states and treat missing state as idle", async () => {
  const { filterSessionSummaries } = await loadFilterModule();

  assert.deepEqual(
    filterSessionSummaries(summaries, { status: "running" }).map((summary) => summary.sessionId),
    ["beta-build"]
  );
  assert.deepEqual(
    filterSessionSummaries(summaries, { status: "idle" }).map((summary) => summary.sessionId),
    ["idle-notes"]
  );
  assert.deepEqual(
    filterSessionSummaries(summaries, { status: "all" }).map((summary) => summary.sessionId),
    summaries.map((summary) => summary.sessionId)
  );
});

test("session filters ignore blank selectors without mutating summaries", async () => {
  const { filterSessionSummaries } = await loadFilterModule();

  const result = filterSessionSummaries(summaries, { query: "  ", status: "" });
  assert.deepEqual(result, summaries);
  assert.deepEqual(summaries, [
    { sessionId: "Desktop-Alpha", entryCount: 4, run: { status: "done" } },
    { sessionId: "beta-build", entryCount: 0, run: { status: "running" } },
    { sessionId: "gamma-review", entryCount: 2, run: { status: "waiting" } },
    { sessionId: "idle-notes", entryCount: 1 },
  ]);
});
