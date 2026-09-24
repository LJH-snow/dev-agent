import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  loadWorkbenchMetadata,
  probeGitHubCapability,
} from "../dist/capabilities.js";
import { createDesktopServer } from "../dist/server.js";

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
    enabled: false,
    cliAvailable: false,
    authenticated: false,
    mutationAllowed: false,
    reason: "opt-in-required",
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

test("Desktop exposes read-only GitHub, workbench, and monitoring metadata routes", async () => {
  const server = createDesktopServer({
    session: { id: "capability-session", run: async () => undefined },
    githubCapability: async () => ({
      provider: "github",
      enabled: true,
      cliAvailable: true,
      authenticated: true,
      mutationAllowed: false,
    }),
    workbenchMetadata: async () => ({
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
      enabled: true,
      cliAvailable: true,
      authenticated: true,
      mutationAllowed: false,
    });

    const workbench = await fetch(`${base}/api/capabilities/workbench?sessionId=capability-session`);
    assert.equal(workbench.status, 200);
    const metadata = await workbench.json() as any;
    assert.equal(metadata.sessionId, "capability-session");
    assert.deepEqual(metadata.skills, [{ name: "demo", description: "Demo", scope: "project" }]);
    assert.equal(JSON.stringify(metadata).includes("mutation"), false);

    const monitoring = await fetch(`${base}/api/monitoring`);
    assert.equal(monitoring.status, 200);
    const snapshot = await monitoring.json() as any;
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.canApprove, false);
    assert.equal(snapshot.canMutate, false);
    assert.equal(Array.isArray(snapshot.sessions), true);
  });
});


test("Desktop renders the metadata-only capability panel without mutation controls", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(html, /id="workbench-capabilities-panel"/);
  assert.match(html, /id="capabilities-github"/);
  assert.match(html, /id="capabilities-skills"/);
  assert.match(html, /id="capabilities-jobs"/);
  assert.match(html, /\/api\/monitoring/);
  assert.match(serverSource, /canApprove/);
  assert.match(html, /metadata-only/);
  assert.doesNotMatch(html, /\/api\/capabilities\/github[^\n]*method: ["']POST/);
});
