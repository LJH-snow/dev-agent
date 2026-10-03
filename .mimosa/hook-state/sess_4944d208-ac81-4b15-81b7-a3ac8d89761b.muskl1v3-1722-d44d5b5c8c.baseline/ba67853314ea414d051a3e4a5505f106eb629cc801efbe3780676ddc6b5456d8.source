import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as autofix from "../dist/autofix.js";
import { createDesktopServer } from "../dist/server.js";

const api = autofix;
const initialTarget = { changeSetId: "failed-original", validationId: "validation-original", status: "failed" as const, summary: "test failed" };

test("Autofix v2 accepts only integer attempt budgets from one through three", () => {
  for (const budget of [1, 2, 3]) assert.equal(api.parseDesktopAutoFixAttempts(budget), budget);
  assert.equal(api.parseDesktopAutoFixAttempts(undefined), 3);
  for (const budget of [0, 4, 1.5, "3", null, NaN, Infinity]) {
    assert.throws(() => api.parseDesktopAutoFixAttempts(budget), /attempt/u);
  }
});

test("Autofix v2 requires review, apply and matching failed revalidation before retry", () => {
  const loop = new api.DesktopAutoFixLoop(3);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const target = attempt === 1 ? initialTarget : { ...initialTarget, changeSetId: "repair-" + (attempt - 1), validationId: "validation-" + attempt };
    loop.start(target);
    assert.equal(loop.attempt, attempt);
    assert.throws(() => loop.start(target), /review|phase/u);
    loop.review("repair-" + attempt);
    loop.apply(target, "repair-" + attempt);
    loop.validated({ changeSetId: "repair-" + attempt, status: "failed" });
  }
  assert.throws(() => loop.start({ ...initialTarget, changeSetId: "repair-3" }), /exhausted/u);
});

test("Autofix v2 fails closed on stale validation, foreign plan and missing validation", () => {
  for (const scenario of ["stale", "foreign", "missing", "blocked", "passed", "wrong-validation"]) {
    const loop = new api.DesktopAutoFixLoop(3);
    loop.start(initialTarget);
    loop.review("repair-1");
    if (scenario === "stale" || scenario === "foreign") {
      assert.throws(() => loop.apply(
        scenario === "stale" ? { ...initialTarget, validationId: "newer" } : initialTarget,
        scenario === "foreign" ? "foreign-plan" : "repair-1",
      ), /stale|plan/u);
    } else {
      loop.apply(initialTarget, "repair-1");
      loop.validated(scenario === "missing" ? undefined : {
        changeSetId: scenario === "wrong-validation" ? "foreign" : "repair-1",
        status: scenario === "passed" ? "passed" : scenario === "blocked" ? "blocked" : "failed",
      });
    }
    assert.throws(() => loop.start(initialTarget), /stopped|passed|phase/u);
  }
});

test("Autofix v2 cancellation stops future retries", () => {
  const loop = new api.DesktopAutoFixLoop(3);
  loop.start(initialTarget);
  loop.stop();
  assert.throws(() => loop.review("late-plan"), /phase/u);
  assert.throws(() => loop.start(initialTarget), /stopped|phase/u);
});

test("Autofix v2 timeout aborts a non-cooperating worker", async () => {
  const controller = new AbortController();
  await assert.rejects(api.withDesktopAutoFixDeadline(
    () => new Promise(() => {}), controller, 10,
  ), /timed out/u);
  assert.equal(controller.signal.aborted, true);
});

test("Autofix v2 deadline never invokes already cancelled work", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(api.withDesktopAutoFixDeadline(async () => { called = true; }, controller, 10));
  assert.equal(called, false);
});

async function withServer(session: any, exercise: (post: (path: string, body?: any) => Promise<Response>) => Promise<void>, options = {}) {
  const server = createDesktopServer({ session, ...options });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    await exercise((path, body = {}) => fetch(base + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2_000),
    }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function repairSession() {
  let target = { ...initialTarget };
  let modelCalls = 0;
  let applyCalls = 0;
  return {
    id: "desktop-default",
    get modelCalls() { return modelCalls; },
    get applyCalls() { return applyCalls; },
    async getLatestAutoFixTarget() { return target; },
    changeTarget() { target = { ...target, validationId: "newer-validation" }; },
    async run(_message: string, emit: (event: any) => void) {
      modelCalls += 1;
      emit({ type: "plan-review", data: { review: {
        changeSetId: "repair-" + modelCalls, files: [], additions: 0, deletions: 0, createdAt: "2026-09-30T00:00:00.000Z",
      } } });
      emit({ type: "done", data: { status: "done" } });
    },
    async applyPlannedChangeSet(review: any, _prompt: string, emit: (event: any) => void) {
      applyCalls += 1;
      target = { ...target, changeSetId: review.changeSetId, validationId: "validation-" + applyCalls };
      emit({ type: "validation", data: { changeSetId: review.changeSetId, status: "failed" } });
      emit({ type: "done", data: { status: "done" } });
    },
  };
}

test("Autofix v2 HTTP bounds retries and apply never calls the model", async () => {
  const session = repairSession();
  await withServer(session, async (post) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const preview = await post("/api/autofix", { maxAttempts: 3 });
      assert.equal(preview.status, 200);
      assert.match(await preview.text(), /event: plan-review/u);
      const applied = await post("/api/plans/apply", { changeSetId: "repair-" + attempt });
      assert.equal(applied.status, 200);
      assert.match(await applied.text(), /event: validation/u);
      assert.equal(session.modelCalls, attempt);
    }
    const exhausted = await post("/api/autofix", { maxAttempts: 3 });
    assert.equal(exhausted.status, 409);
    assert.equal((await exhausted.json() as any).code, "autofix-exhausted");
    assert.equal(session.modelCalls, 3);
  });
});

test("Autofix v2 HTTP rejects invalid budgets before calling the model", async () => {
  const session = repairSession();
  await withServer(session, async (post) => {
    for (const maxAttempts of [0, 4, 1.5, "3", null]) {
      const response = await post("/api/autofix", { maxAttempts });
      assert.equal(response.status, 400);
    }
    assert.equal(session.modelCalls, 0);
  });
});

test("Autofix v2 HTTP refuses stale review without applying files", async () => {
  const session = repairSession();
  await withServer(session, async (post) => {
    await (await post("/api/autofix")).text();
    session.changeTarget();
    const applied = await post("/api/plans/apply", { changeSetId: "repair-1" });
    assert.equal(applied.status, 409);
    assert.equal((await applied.json() as any).code, "autofix-stale");
    assert.equal(session.applyCalls, 0);
  });
});

test("Autofix v2 HTTP times out and ignores late reviews", async () => {
  let lateEmit: (event: any) => void;
  const session = repairSession();
  session.run = async (_message, emit) => { lateEmit = emit; await new Promise(() => {}); };
  await withServer(session, async (post) => {
    const response = await post("/api/autofix");
    assert.match(await response.text(), /timed out/u);
    lateEmit({ type: "plan-review", data: { review: { changeSetId: "late", files: [], additions: 0, deletions: 0, createdAt: "now" } } });
    const applied = await post("/api/plans/apply", { changeSetId: "late" });
    assert.equal(applied.status, 404);
  }, { autofixTimeoutMs: 10 });
});

test("Autofix v2 HTTP keeps an explicit one-attempt budget across omitted and changed requests", async () => {
  const session = repairSession();
  await withServer(session, async (post) => {
    await (await post("/api/autofix", { maxAttempts: 1 })).text();
    await (await post("/api/plans/apply", { changeSetId: "repair-1" })).text();
    assert.equal((await post("/api/autofix", { maxAttempts: 3 })).status, 409);
    assert.equal((await post("/api/autofix")).status, 409);
    assert.equal(session.modelCalls, 1);
  });
});

test("Autofix v2 HTTP locks the session before asynchronously loading the target", async () => {
  const session = repairSession();
  let release: () => void;
  let started: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const getTarget = session.getLatestAutoFixTarget;
  session.getLatestAutoFixTarget = async () => { started(); await hold; return getTarget(); };
  await withServer(session, async (post) => {
    const first = post("/api/autofix");
    await ready;
    try {
      const concurrent = await post("/api/autofix");
      assert.equal(concurrent.status, 409);
    } finally {
      release();
    }
    await (await first).text();
    assert.equal(session.modelCalls, 1);
  });
});

test("Autofix v2 HTTP rejects discard, conflict and missing validation as retry sources", async () => {
  for (const scenario of ["discard", "conflict", "missing", "blocked", "passed"]) {
    const session = repairSession();
    if (scenario !== "discard") {
      session.applyPlannedChangeSet = async (review, _prompt, emit) => {
        if (scenario === "conflict") throw new Error("preimage conflict");
        if (scenario !== "missing") emit({ type: "validation", data: { changeSetId: review.changeSetId, status: scenario } });
        emit({ type: "done", data: { status: "done" } });
      };
    }
    await withServer(session, async (post) => {
      await (await post("/api/autofix")).text();
      const result = await post(scenario === "discard" ? "/api/plans/reject" : "/api/plans/apply", { changeSetId: "repair-1" });
      await result.text();
      assert.equal((await post("/api/autofix")).status, 409, scenario);
      assert.equal((await post("/api/plans/apply", { changeSetId: "repair-1" })).status, 404, scenario);
      assert.equal(session.modelCalls, 1);
    });
  }
});

test("Autofix v2 HTTP cancellation ignores late plans and cannot restart the loop", async () => {
  const session = repairSession();
  let lateEmit: (event: any) => void;
  let started: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  session.run = async (_message, emit) => { lateEmit = emit; started(); await new Promise(() => {}); };
  await withServer(session, async (post) => {
    const preview = post("/api/autofix");
    await ready;
    assert.equal((await post("/api/chat/cancel")).status, 200);
    const response = await preview;
    await response.text();
    const snapshot = await fetch(response.url.replace("/api/autofix", "/api/sessions/desktop-default/run"));
    assert.equal((await snapshot.json() as any).status, "aborted");
    lateEmit({ type: "plan-review", data: { review: { changeSetId: "late", files: [], additions: 0, deletions: 0, createdAt: "now" } } });
    assert.equal((await post("/api/plans/apply", { changeSetId: "late" })).status, 404);
    assert.equal((await post("/api/autofix")).status, 409);
  });
});

test("Autofix v2 HTTP cannot apply a review recovered from another server", async () => {
  const session = repairSession();
  await withServer(session, async (post) => { await (await post("/api/autofix")).text(); });
  await withServer(session, async (post) => {
    assert.equal((await post("/api/plans/apply", { changeSetId: "repair-1" })).status, 404);
    assert.equal(session.applyCalls, 0);
  });
});

test("Autofix v2 HTTP apply timeout removes the review and ignores late validation", async () => {
  const session = repairSession();
  let lateEmit: (event: any) => void;
  session.applyPlannedChangeSet = async (_review, _prompt, emit) => { lateEmit = emit; await new Promise(() => {}); };
  await withServer(session, async (post) => {
    await (await post("/api/autofix")).text();
    const applied = await post("/api/plans/apply", { changeSetId: "repair-1" });
    assert.match(await applied.text(), /timed out/u);
    lateEmit({ type: "validation", data: { changeSetId: "repair-1", status: "failed" } });
    lateEmit({ type: "done", data: { status: "done" } });
    assert.equal((await post("/api/plans/apply", { changeSetId: "repair-1" })).status, 404);
    assert.equal((await post("/api/autofix")).status, 409);
  }, { autofixTimeoutMs: 10 });
});

test("Autofix v2 refuses cleaned, missing and mismatched worktrees without touching project WIP", async () => {
  for (const scenario of ["cleaned", "missing", "branch-mismatch"]) {
    const directory = await mkdtemp(join(tmpdir(), "autofix-v2-worktree-"));
    const root = join(directory, "repo");
    const worktrees = join(directory, "worktrees");
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
    await mkdir(root);
    git(root, "init", "--quiet");
    git(root, "config", "user.name", "Autofix fixture");
    git(root, "config", "user.email", "autofix@example.invalid");
    await writeFile(join(root, "README.md"), "base\n");
    git(root, "add", "README.md");
    git(root, "commit", "--quiet", "-m", "fixture");
    await writeFile(join(root, "README.md"), "user WIP\n");
    await writeFile(join(root, "untracked.txt"), "user untracked WIP\n");
    const task = repairSession();
    try {
      await withServer(repairSession(), async (post) => {
        const created = await post("/api/workspaces");
        assert.equal(created.status, 201);
        const { sessionId } = await created.json() as any;
        await (await post("/api/autofix", { sessionId })).text();
        if (scenario === "cleaned") {
          let cleaned: Response;
          for (let attempt = 0; attempt < 30; attempt += 1) {
            cleaned = await fetch(created.url + "/" + sessionId, { method: "DELETE" });
            if (cleaned.status !== 409 || (await cleaned.clone().json() as any).code !== "workspace-running") break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(cleaned.status, 200);
        } else if (scenario === "missing") {
          await rm(join(worktrees, sessionId), { recursive: true, force: true });
        } else {
          git(join(worktrees, sessionId), "switch", "--quiet", "-c", "unrelated-fixture-branch");
        }
        const applied = await post("/api/plans/apply", { sessionId, changeSetId: "repair-1" });
        assert.equal(applied.status, scenario === "missing" ? 404 : 409, scenario);
        assert.equal((await applied.json() as any).code, "workspace-" + scenario);
        assert.equal(task.applyCalls, 0);
        assert.equal(await readFile(join(root, "README.md"), "utf8"), "user WIP\n");
        assert.equal(await readFile(join(root, "untracked.txt"), "utf8"), "user untracked WIP\n");
      }, {
        workspaceRoot: root, worktreeDirectory: worktrees, workspaceStateFile: join(directory, "workspaces.json"),
        scheduledTasksStateFile: join(directory, "schedules.json"), executionHistoryStateFile: join(directory, "history.json"),
        createSession: (sessionId: string) => { task.id = sessionId; return task; },
      });
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
});
