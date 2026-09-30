import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  loadProjectCapabilityMetadata,
  loadWorkbenchMetadata,
  normalizeGitHubCapabilitySnapshot,
  normalizeWorkbenchMetadataSnapshot,
  probeGitHubCapability,
} from "../dist/capabilities.js";
import { createDesktopServer } from "../dist/server.js";

function runGit(args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileCallback("git", [...args], { cwd, windowsHide: true }, (error) => error ? reject(error) : resolve());
  });
}

async function withServer(server: ReturnType<typeof createDesktopServer>, run: (base: string) => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("GitHub capability probe is disabled by default and never grants mutation", async () => {
  const snapshot = await probeGitHubCapability(false);
  assert.deepEqual(snapshot, {
    provider: "github",
    state: "disabled",
    enabled: false,
    cliAvailable: false,
    authenticated: false,
    mutationAllowed: false,
    reason: "opt-in-required",
    ci: {
      provider: "github-actions",
      state: "disabled",
      enabled: false,
      workflowDetected: false,
      mutationAllowed: false,
      reason: "opt-in-required",
    },
  });
});

test("workbench metadata exposes bounded skill/job metadata without paths or instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-capabilities-"));
  await mkdir(join(root, ".dev-agent", "skills", "demo"), { recursive: true });
  await writeFile(
    join(root, ".dev-agent", "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Demo skill\n---\nprivate instruction body\n",
    "utf8",
  );
  const snapshot = await loadWorkbenchMetadata(root);
  const skill = snapshot.skills.find((candidate) => candidate.name === "demo");
  assert.deepEqual(skill, { name: "demo", description: "Demo skill", scope: "project" });
  assert.equal(JSON.stringify(snapshot).includes("private instruction body"), false);
  assert.equal(JSON.stringify(snapshot).includes("SKILL.md"), false);
  assert.deepEqual(snapshot.limits, { maxSkills: 64, maxJobs: 100 });
});

test("project capability metadata exposes only bounded Git branch, dirty, and remote-host state", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-project-capability-"));
  try {
    await runGit(["init", "--quiet"], root);
    await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], root);
    await runGit(["remote", "add", "origin", "git@github.com:acme/demo.git"], root);
    await writeFile(join(root, "untracked.txt"), "untracked\n", "utf8");

    const snapshot = await loadProjectCapabilityMetadata(root);
    assert.deepEqual(snapshot, {
      provider: "git",
      state: "ready",
      branch: "main",
      dirty: true,
      changedFiles: 1,
      remoteHost: "github.com",
      remoteProvider: "github",
    });
    assert.equal(JSON.stringify(snapshot).includes(root), false);
    assert.equal(JSON.stringify(snapshot).includes("acme/demo"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project capability metadata distinguishes non-repositories and malformed remotes", async () => {
  const nonRepository = await mkdtemp(join(tmpdir(), "dev-agent-project-not-git-"));
  const malformed = await mkdtemp(join(tmpdir(), "dev-agent-project-bad-remote-"));
  try {
    assert.deepEqual(await loadProjectCapabilityMetadata(nonRepository), {
      provider: "git",
      state: "not-a-repository",
      reason: "not-a-repository",
    });
    await runGit(["init", "--quiet"], malformed);
    await runGit(["remote", "add", "origin", "not-a-valid-remote"], malformed);
    const snapshot = await loadProjectCapabilityMetadata(malformed);
    assert.equal(snapshot.state, "ready");
    assert.equal(snapshot.provider, "git");
    assert.equal(snapshot.remoteHost, undefined);
  } finally {
    await Promise.all([
      rm(nonRepository, { recursive: true, force: true }),
      rm(malformed, { recursive: true, force: true }),
    ]);
  }
});

test("custom capability metadata is sanitized and never grants mutation", () => {
  const github = normalizeGitHubCapabilitySnapshot({
    provider: "github",
    state: "ready",
    enabled: true,
    cliAvailable: true,
    authenticated: true,
    mutationAllowed: true,
    ci: {
      provider: "github-actions",
      state: "ready",
      enabled: true,
      workflowDetected: true,
      mutationAllowed: true,
      latestRun: {
        status: "completed",
        conclusion: "success",
        workflow: "/Users/Admin/.secrets/TOKEN=super-secret",
      },
    },
  });
  assert.equal(github.mutationAllowed, false);
  assert.equal(github.ci.mutationAllowed, false);
  assert.doesNotMatch(JSON.stringify(github), /Users|super-secret|mutationAllowed":true/i);

  const queued = normalizeGitHubCapabilitySnapshot({
    provider: "github",
    state: "ready",
    enabled: true,
    cliAvailable: true,
    authenticated: true,
    ci: {
      provider: "github-actions",
      state: "ready",
      enabled: true,
      workflowDetected: true,
      mutationAllowed: true,
      latestRun: { status: "in_progress", conclusion: "unknown", workflow: "CI" },
    },
  });
  assert.deepEqual(queued.ci.latestRun, { status: "in_progress", conclusion: "unknown", workflow: "CI" });

  const disabled = normalizeGitHubCapabilitySnapshot({
    provider: "github",
    state: "ready",
    enabled: false,
    cliAvailable: true,
    authenticated: true,
    ci: {
      provider: "github-actions",
      state: "ready",
      enabled: true,
      workflowDetected: true,
      mutationAllowed: true,
    },
  });
  assert.equal(disabled.state, "disabled");
  assert.equal(disabled.authenticated, false);
  assert.deepEqual(disabled.ci, {
    provider: "github-actions",
    state: "disabled",
    enabled: false,
    workflowDetected: false,
    mutationAllowed: false,
    reason: "opt-in-required",
  });

  const workbench = normalizeWorkbenchMetadataSnapshot({
    repository: {
      provider: "git",
      state: "ready",
      branch: "/Users/Admin/private/secret",
      dirty: true,
      remoteHost: "https://token:super-secret@example.com/repo.git",
    },
    skills: [{ name: "ok", description: "password=super-secret", scope: "project" }],
    jobs: [{ id: "job-aaaaaaaaaaaaaaaa", status: "TOKEN=super-secret", createdAt: "/tmp/path", updatedAt: "now", runCount: 1 }],
  });
  assert.equal(workbench.repository.state, "invalid");
  assert.deepEqual(workbench.skills, [{ name: "ok", description: "", scope: "project" }]);
  assert.deepEqual(workbench.jobs, []);
  assert.doesNotMatch(JSON.stringify(workbench), /Users|super-secret|token:/i);
});

test("Desktop exposes read-only GitHub, workbench, and monitoring metadata routes", async () => {
  const server = createDesktopServer({
    session: { id: "capability-session", run: async () => undefined },
    githubCapability: async () => ({
      provider: "github",
      state: "ready",
      enabled: true,
      cliAvailable: true,
      authenticated: true,
      mutationAllowed: false,
      ci: {
        provider: "github-actions",
        state: "ready",
        enabled: true,
        workflowDetected: false,
        mutationAllowed: false,
        reason: "no-workflows",
      },
    }),
    workbenchMetadata: async () => ({
      repository: { provider: "git", state: "ready", branch: "main", dirty: false, changedFiles: 0, remoteHost: "github.com", remoteProvider: "github" },
      skills: [{ name: "demo", description: "Demo", scope: "project" }],
      jobs: [],
      limits: { maxSkills: 64, maxJobs: 100 },
    }),
  });
  await withServer(server, async (base) => {
    const github = await fetch(`${base}/api/capabilities/github`);
    assert.equal(github.status, 200);
    assert.deepEqual(await github.json(), {
      provider: "github",
      state: "ready",
      enabled: true,
      cliAvailable: true,
      authenticated: true,
      mutationAllowed: false,
      ci: {
        provider: "github-actions",
        state: "ready",
        enabled: true,
        workflowDetected: false,
        mutationAllowed: false,
        reason: "no-workflows",
      },
    });

    const workbench = await fetch(`${base}/api/capabilities/workbench?sessionId=capability-session`);
    assert.equal(workbench.status, 200);
    const metadata = await workbench.json() as any;
    assert.equal(metadata.sessionId, "capability-session");
    assert.deepEqual(metadata.repository, { provider: "git", state: "ready", branch: "main", dirty: false, changedFiles: 0, remoteHost: "github.com", remoteProvider: "github" });
    assert.deepEqual(metadata.skills, [{ name: "demo", description: "Demo", scope: "project" }]);
    assert.equal(JSON.stringify(metadata).includes("mutation"), false);

    const monitoring = await fetch(`${base}/api/monitoring`);
    assert.equal(monitoring.status, 200);
    const snapshot = await monitoring.json() as any;
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.canApprove, false);
    assert.equal(snapshot.canMutate, false);
    assert.equal(snapshot.project?.state, "ready");
    assert.deepEqual(snapshot.capabilities?.github, {
      provider: "github",
      state: "ready",
      enabled: true,
      cliAvailable: true,
      authenticated: true,
      mutationAllowed: false,
    });
    assert.deepEqual(snapshot.capabilities?.ci, {
      provider: "github-actions",
      state: "ready",
      enabled: true,
      workflowDetected: false,
      mutationAllowed: false,
      reason: "no-workflows",
    });
    assert.equal(Array.isArray(snapshot.sessions), true);
  });
});


test("Desktop renders the metadata-only capability panel without mutation controls", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(html, /id="workbench-capabilities-panel"/);
  assert.match(html, /id="capabilities-github"/);
  assert.match(html, /id="capabilities-ci"/);
  assert.match(html, /id="capabilities-repository"/);
  assert.match(html, /id="capabilities-remote"/);
  assert.match(html, /id="capabilities-skills"/);
  assert.match(html, /id="capabilities-jobs"/);
  assert.match(html, /\/api\/monitoring/);
  assert.match(html, /\/api\/capabilities\/github" \+ query/);
  assert.match(html, /function renderRepositoryCapability\(workbench, monitoring\)/);
  assert.match(html, /capabilities\.ci\.readOnly/);
  assert.match(html, /latestRun/);
  assert.match(serverSource, /canApprove/);
  assert.match(html, /metadata-only/);
  assert.doesNotMatch(html, /\/api\/capabilities\/github[^\n]*method: ["']POST/);
});
