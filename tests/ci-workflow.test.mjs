import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

function sectionAfter(marker, nextMarker) {
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `CI workflow should contain ${marker}`);
  const end = nextMarker ? workflow.indexOf(nextMarker, start + marker.length) : -1;
  return workflow.slice(start, end >= 0 ? end : undefined);
}

test("TypeScript CI installs the PTY dependencies before the release gate", () => {
  const typescriptJob = sectionAfter("  typescript:\n", "  rust:\n");
  const ptyInstall = typescriptJob.indexOf(
    "      - name: Install PTY test dependencies\n" +
      "        run: sudo apt-get update -qq && sudo apt-get install -y -qq expect procps\n"
  );
  const dependencyInstall = typescriptJob.indexOf("      - name: Install dependencies\n");
  const releaseGate = typescriptJob.indexOf("        run: pnpm verify:typescript\n");

  assert.ok(ptyInstall >= 0, "TypeScript CI must install expect and procps explicitly");
  assert.ok(dependencyInstall >= 0, "TypeScript CI should install workspace dependencies");
  assert.ok(releaseGate >= 0, "TypeScript CI should run the TypeScript release gate");
  assert.ok(ptyInstall < dependencyInstall, "PTY dependencies must be installed before workspace tests");
  assert.ok(ptyInstall < releaseGate, "PTY dependencies must be installed before the release gate");
});

test("CI TypeScript job runs the CLI package smoke test", () => {
  const job = sectionAfter("  typescript:\n", "  rust:\n");
  assert.match(job, /- name: CLI package install smoke test\n\s+run: pnpm package:smoke/);
});

test("CI runs the complete verify gate with live Linux sandbox prerequisites", () => {
  const job = sectionAfter("  full-verify:\n", "  rust:\n");

  assert.match(job, /name: Full verify/);
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /timeout-minutes: 45/);
  assert.match(job, /DEV_AGENT_REQUIRE_LIVE_SANDBOX: "1"/);
  assert.match(
    job,
    /sudo apt-get install -y -qq bubblewrap expect procps protobuf-compiler ripgrep/
  );
  assert.match(job, /- name: Configure hosted user namespace prerequisites/);
  assert.match(job, /pnpm install --frozen-lockfile/);
  assert.match(job, /- name: Complete release gate\n\s+run: pnpm verify/);

  const prerequisites = job.indexOf("- name: Install full verify prerequisites");
  const namespace = job.indexOf("- name: Configure hosted user namespace prerequisites");
  const dependencies = job.indexOf("- name: Install dependencies");
  const gate = job.indexOf("run: pnpm verify");
  assert.ok(prerequisites >= 0 && prerequisites < namespace);
  assert.ok(namespace < dependencies && dependencies < gate);
});
