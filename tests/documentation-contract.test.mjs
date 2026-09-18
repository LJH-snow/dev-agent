import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const docsReadme = readFileSync(new URL("../docs/README.md", import.meta.url), "utf8");
const nextRoadmap = readFileSync(
  new URL("../docs/next-roadmap-plans-v62-plus.md", import.meta.url),
  "utf8"
);
const v63Plan = readFileSync(new URL("../docs/day-plan-v63.md", import.meta.url), "utf8");
const releaseChecklist = readFileSync(
  new URL("../docs/release-candidate-checklist-v0.1.0.md", import.meta.url),
  "utf8"
);
const cliReadme = readFileSync(new URL("../apps/cli/README.md", import.meta.url), "utf8");
const desktopCandidate = readFileSync(
  new URL("../docs/release-candidate-checklist-v0.1.7-desktop.md", import.meta.url),
  "utf8"
);
const desktopReadme = readFileSync(
  new URL("../apps/desktop/README.md", import.meta.url),
  "utf8"
);
const cliPackage = JSON.parse(
  readFileSync(new URL("../apps/cli/package.json", import.meta.url), "utf8")
);
const npmRelease = readFileSync(
  new URL("../docs/release-cli-npm.md", import.meta.url),
  "utf8"
);
const releaseState = JSON.parse(
  readFileSync(new URL("../docs/release-state.json", import.meta.url), "utf8")
);
const publishedCliVersion = String(releaseState.publishedVersion);
const candidateCliVersion = String(releaseState.candidateVersion);

function cliVersionPattern(version) {
  const escaped = version.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return new RegExp(`@agent_cli/cli@${escaped}`);
}
const cliDistributionPlan = readFileSync(
  new URL("../docs/superpowers/plans/2026-09-15-cli-npm-distribution.md", import.meta.url),
  "utf8"
);

const roadmapStart = readme.indexOf("## Roadmap");
assert.ok(roadmapStart >= 0, "README should contain a Roadmap heading");
const roadmap = readme.slice(roadmapStart);

function roadmapNumbers() {
  return roadmap
    .split("\n")
    .map((line) => line.match(/^(\d+)\. /)?.[1])
    .filter((value) => value !== undefined)
    .map(Number);
}

test("README roadmap numbering is unique and sequential", () => {
  const numbers = roadmapNumbers();
  assert.ok(numbers.length > 0, "README should contain roadmap entries");
  assert.deepEqual(
    numbers,
    numbers.map((_, index) => index + 1),
    "roadmap entries should have one stable sequential number each"
  );
});

test("documentation index points to the current source-of-truth documents", () => {
  for (const link of [
    "docs/README.md",
    "docs/architecture.md",
    "docs/CHANGELOG.md",
    "docs/day-plan-v60.md",
    "docs/day-plan-v60-progress.md",
    "docs/day-plan-v61.md",
    "docs/day-plan-v61-progress.md",
    "docs/next-roadmap-plans-v62-plus.md",
    "docs/day-plan-v62.md",
    "docs/day-plan-v62-progress.md",
    "docs/day-plan-v63.md",
    "docs/day-plan-v63-progress.md",
    "docs/day-plan-v64.md",
    "docs/day-plan-v64-progress.md",
    "docs/cli-runtime-observability.md",
    "docs/superpowers/plans/2026-09-14-cli-runtime-observability.md",
    "docs/cli-tui-v1.md",
    "docs/cli-tui-v1.1-reliability.md",
    "docs/release-candidate-checklist-v0.1.0.md",
    "docs/superpowers/plans/2026-09-14-cli-tui-v1.md",
    "docs/superpowers/plans/2026-09-14-cli-tui-v1.1-reliability.md",
    "docs/superpowers/plans/2026-09-15-release-candidate-hardening.md",
    "docs/superpowers/plans/2026-09-15-eight-hour-unattended-development-goal.md",
    "docs/superpowers/plans/2026-09-15-eight-hour-unattended-development-goal-progress.md",
    "docs/superpowers/plans/2026-09-15-release-provenance-audit.md",
    "docs/superpowers/plans/2026-09-15-cancellation-boundary-audit.md",
    "docs/superpowers/plans/2026-09-15-overnight-development-goals.md",
    "docs/release-cli-npm.md",
    "docs/release-state.json",
  ]) {
    assert.ok(readme.includes(link), `README should link to ${link}`);
  }

  for (const link of [
    "../README.md",
    "architecture.md",
    "CHANGELOG.md",
    "day-plan-v60.md",
    "day-plan-v60-progress.md",
    "day-plan-v61.md",
    "day-plan-v61-progress.md",
    "windows-sandbox-feasibility-v61.md",
    "next-roadmap-plans-v62-plus.md",
    "day-plan-v62.md",
    "day-plan-v62-progress.md",
    "day-plan-v63.md",
    "day-plan-v63-progress.md",
    "day-plan-v64.md",
    "day-plan-v64-progress.md",
    "cli-runtime-observability.md",
    "superpowers/plans/2026-09-14-cli-runtime-observability.md",
    "cli-tui-v1.md",
    "cli-tui-v1.1-reliability.md",
    "release-candidate-checklist-v0.1.0.md",
    "superpowers/plans/2026-09-14-cli-tui-v1.md",
    "superpowers/plans/2026-09-14-cli-tui-v1.1-reliability.md",
    "superpowers/plans/2026-09-15-release-candidate-hardening.md",
    "superpowers/plans/2026-09-15-eight-hour-unattended-development-goal.md",
    "superpowers/plans/2026-09-15-eight-hour-unattended-development-goal-progress.md",
    "superpowers/plans/2026-09-15-release-provenance-audit.md",
    "superpowers/plans/2026-09-15-cancellation-boundary-audit.md",
    "superpowers/plans/2026-09-15-overnight-development-goals.md",
    "release-cli-npm.md",
    "release-state.json",
  ]) {
    assert.ok(docsReadme.includes(`](${link})`), `docs/README.md should link to ${link}`);
  }
});

test("next-phase roadmap records the completed ten-goal overnight plan", () => {
  assert.match(nextRoadmap, /## v62：Linux `bwrap` hosted live integration（已完成）/);
  assert.doesNotMatch(nextRoadmap, /## v62：Linux `bwrap` hosted live integration（推荐下一步）/);
  assert.match(
    nextRoadmap,
    /## 当前推荐[\s\S]*10 个开发目标的过夜开发计划[\s\S]*均已完成/
  );
  assert.match(nextRoadmap, /过夜开发计划/);
  assert.doesNotMatch(nextRoadmap, /先处理 CLI 索引/);
  assert.doesNotMatch(
    nextRoadmap,
    /8 小时安全无人值守并行开发计划[\s\S]*已经完成[\s\S]*merge preparation \/ maintainer decision gate/
  );
});

test("completed v63 day plan has no stale unchecked delivery items", () => {
  const taskStart = v63Plan.indexOf("## Task 4：文档与验证");
  const taskEnd = v63Plan.indexOf("## Acceptance checklist", taskStart);
  assert.ok(taskStart >= 0, "v63 plan should contain Task 4");
  assert.ok(taskEnd > taskStart, "v63 plan should delimit Task 4");
  const task = v63Plan.slice(taskStart, taskEnd);
  assert.doesNotMatch(task, /^- \[ \]/m, "completed v63 Task 4 must not retain unchecked items");
});

test("release docs distinguish readiness audit from formal release authorization", () => {
  assert.match(
    nextRoadmap,
    /## v64：Release candidate readiness（已完成）/
  );
  assert.match(nextRoadmap, /v64 readiness audit 已完成；formal release 仍保持 gated/);
  assert.match(readme, /The `v0\.1\.6` GitHub release flow is complete/);
  assert.match(
    readme,
    /Future\s+versions require a new explicit maintainer release decision/
  );
  assert.match(docsReadme, /release-candidate readiness audit/);
});

test("phase labels are distinct from root README roadmap item numbers", () => {
  assert.match(
    docsReadme,
    /The `v62\/v63\/v64` labels in phase documents are release-planning phase labels/,
  );
  assert.match(
    docsReadme,
    /not the\s+numbered items 62\/63\/64 in the root README Roadmap/,
  );
});

test("npm CLI docs describe external-directory use and current publication status", () => {
  assert.equal(releaseState.package, cliPackage.name);
  assert.equal(releaseState.status, "candidate");
  assert.equal(candidateCliVersion, cliPackage.version);
  assert.match(readme, /release-cli-npm\.md/);
  assert.match(readme, /npm install -g @agent_cli\/cli/);
  assert.match(readme, /--project-state/);
  assert.match(readme, cliVersionPattern(publishedCliVersion));
  assert.match(readme, cliVersionPattern(candidateCliVersion));
  assert.match(nextRoadmap, new RegExp(`当前 npm 包 \`@agent_cli/cli@${publishedCliVersion.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\` 已发布`));
  assert.match(nextRoadmap, cliVersionPattern(candidateCliVersion));
  assert.doesNotMatch(nextRoadmap, /当前 npm 包 `@agent_cli\/cli@0\.1\.0` 已发布/);
  assert.match(docsReadme, /release-cli-npm\.md/);
  assert.match(docsReadme, /release-state\.json/);
  assert.match(cliReadme, /^# @agent_cli\/cli/m);
  assert.match(cliReadme, /npm install -g @agent_cli\/cli/);
  assert.match(cliReadme, /--cwd <path>/);
  assert.match(cliReadme, /--project-state/);
  assert.match(cliReadme, /\.dev-agent\/config\.json/);
  assert.match(cliReadme, /\.dev-agent\/sessions/);
  assert.match(cliReadme, /DEV_AGENT_WORKING_DIRECTORY/);
  assert.match(cliReadme, /DEV_AGENT_CONFIG_FILE/);
  assert.match(npmRelease, /npm install -g @agent_cli\/cli/);
  assert.match(npmRelease, /dev-agent --cwd/);
  assert.match(npmRelease, /--project-state/);
  assert.match(npmRelease, /\.dev-agent\/config\.json/);
  assert.match(npmRelease, /\.dev-agent\/sessions/);
  assert.match(npmRelease, /npm whoami/);
  assert.match(npmRelease, /pnpm release:preflight/);
  assert.match(npmRelease, /pnpm release:publish -- --publish/);
  assert.match(npmRelease, cliVersionPattern(publishedCliVersion));
  assert.match(npmRelease, cliVersionPattern(candidateCliVersion));
  assert.match(npmRelease, /published to npm|已发布到 npm/i);
  assert.match(npmRelease, /候选|candidate/i);
  assert.match(npmRelease, /Rust|sandbox/i);
  assert.match(npmRelease, /session/i);
  assert.match(npmRelease, /GitHub Release|release tag|正式发布/i);
});

test("published CLI version is synchronized across release documentation", () => {
  assert.match(cliDistributionPlan, cliVersionPattern(publishedCliVersion));
  assert.doesNotMatch(cliDistributionPlan, /@agent_cli\/cli@0\.1\.0/);
  assert.match(cliDistributionPlan, /本次已获得该授权并单独完成 npm 包发布/);
});

test("runtime release selection and smoke command are documented as candidate-only", () => {
  assert.match(cliReadme, /--runtime-release <version>/);
  assert.match(cliReadme, /GitHub release that carries the runtime manifest and archive/);
  assert.match(cliReadme, /--runtime-release 0\.1\.6/);
  assert.match(cliReadme, /runtime identity/);
  assert.match(cliReadme, /pnpm runtime:smoke/);
  assert.match(desktopCandidate, /--runtime-release/);
  assert.match(desktopCandidate, /pnpm runtime:smoke/);
  assert.match(desktopCandidate, /workspace-only/i);
  assert.match(desktopCandidate, /no npm publish/i);
});

test("current overnight and v0.1.7 candidate evidence is indexed", () => {
  for (const file of [
    "docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md",
    "docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md",
    "docs/release-candidate-checklist-v0.1.7-desktop.md",
  ]) {
    assert.ok(readme.includes(file), `README should link to ${file}`);
    assert.ok(
      docsReadme.includes(file.replace(/^docs\//, "")),
      `docs/README.md should link to ${file}`
    );
  }
  assert.match(
    readme,
    /81\. ~~Managed runtime and Desktop project-surface hardening~~ \(workspace done; release gated\)/
  );
});

test("runtime smoke documents the proxy-aware verification command", () => {
  assert.match(cliReadme, /NODE_USE_ENV_PROXY=1/);
  assert.match(cliReadme, /--skip-build/);
  assert.match(desktopCandidate, /NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build/);
  assert.match(desktopCandidate, /proxy/i);
  assert.match(desktopCandidate, /does not authorize publishing/i);
});

test("v0.1.7 candidate records resolved handoff provenance", () => {
  assert.match(desktopCandidate, /## Candidate review handoff/);
  assert.match(desktopCandidate, /runtime-release slice has been committed and pushed/i);
  assert.match(desktopCandidate, /Desktop hardening slice has been committed locally/i);
  assert.match(desktopCandidate, /No shared staging index remains/i);
  assert.match(desktopCandidate, /Maintainers review these/i);
  assert.match(desktopCandidate, /commits separately/i);
  assert.match(desktopCandidate, /maintainer[\s\S]*decision/i);
  assert.doesNotMatch(desktopCandidate, /in-progress CLI\/runtime/i);
});

test("v0.1.7 documents desktop status stale-response safety", () => {
  assert.match(desktopReadme, /stale-safe/i);
  assert.match(desktopReadme, /does not render/i);
  assert.match(desktopCandidate, /stale-safe/i);
  assert.match(desktopCandidate, /aborts the previous[\s\S]*status request/i);
  assert.match(desktopReadme, /history loading is stale-safe/i);
  assert.match(desktopCandidate, /history loading is stale-safe/i);
});

test("v0.1.7 documents desktop validation rerun stale safety", () => {
  assert.match(desktopReadme, /validation rerun loading is stale-safe/i);
  assert.match(desktopCandidate, /validation rerun loading is stale-safe/i);
  assert.match(desktopCandidate, /stale request or session[\s\S]*update the UI/i);
});

test("v0.1.7 documents desktop undo rollback stale safety", () => {
  assert.match(desktopReadme, /undo loading is stale-safe/i);
  assert.match(desktopCandidate, /undo rollback loading is stale-safe/i);
  assert.match(desktopCandidate, /stale request or session[\s\S]*update the UI/i);
});

test("v0.1.7 documents active Desktop session lifecycle fail-closed behavior", () => {
  assert.match(desktopReadme, /deletion fails closed with `409`/i);
  assert.match(desktopReadme, /rename also fails closed with `409`/i);
  assert.match(desktopCandidate, /deleting or renaming a desktop session fails closed with `409`/i);
  assert.match(desktopCandidate, /memory file remain intact/i);
});

test("v0.1.7 documents rollback in active Desktop session lifecycle", () => {
  assert.match(desktopReadme, /rollback, deletion, and rename fail closed with\s+`409`/i);
  assert.match(desktopCandidate, /rollback,\s+deletion, or rename/i);
  assert.match(desktopCandidate, /concurrent rollback/i);
});

test("v0.1.7 documents the Desktop JSON request-body limit", () => {
  assert.match(desktopReadme, /1 MiB/i);
  assert.match(desktopReadme, /request body/i);
  assert.match(desktopReadme, /413/i);
  assert.match(desktopCandidate, /1 MiB/i);
  assert.match(desktopCandidate, /request body/i);
  assert.match(desktopCandidate, /413/i);
});

test("v0.1.7 documents the Desktop session registry limit", () => {
  assert.match(desktopReadme, /session registry/i);
  assert.match(desktopReadme, /256/i);
  assert.match(desktopReadme, /429/i);
  assert.match(desktopCandidate, /session registry/i);
  assert.match(desktopCandidate, /256/i);
});

test("v0.1.7 documents the Desktop always-allow registry limit", () => {
  assert.match(desktopReadme, /always-allow/i);
  assert.match(desktopReadme, /256/i);
  assert.match(desktopReadme, /512 bytes/i);
  assert.match(desktopCandidate, /always-allow/i);
  assert.match(desktopCandidate, /512 bytes/i);
});

test("v0.1.7 documents the Desktop static response limit", () => {
  assert.match(desktopReadme, /static response/i);
  assert.match(desktopReadme, /1 MiB/i);
  assert.match(desktopReadme, /413/i);
  assert.match(desktopCandidate, /static response/i);
  assert.match(desktopCandidate, /1 MiB/i);
});

test("v0.1.7 documents Desktop public symlink containment", () => {
  assert.match(desktopReadme, /symlink/i);
  assert.match(desktopReadme, /public\s+directory/i);
  assert.match(desktopReadme, /404/i);
  assert.match(desktopCandidate, /symlink/i);
  assert.match(desktopCandidate, /public\s+directory/i);
});

test("v0.1.7 documents the Desktop session ID length limit", () => {
  assert.match(desktopReadme, /session id/i);
  assert.match(desktopReadme, /96/i);
  assert.match(desktopCandidate, /session id/i);
  assert.match(desktopCandidate, /96/i);
});

test("v0.1.7 documents the Desktop session listing limit", () => {
  assert.match(desktopReadme, /session listing/i);
  assert.match(desktopReadme, /256/i);
  assert.match(desktopCandidate, /session listing/i);
  assert.match(desktopCandidate, /256/i);
});

test("v0.1.7 documents the Desktop history response limit", () => {
  assert.match(desktopReadme, /history response/i);
  assert.match(desktopReadme, /1 MiB/i);
  assert.match(desktopReadme, /413/i);
  assert.match(desktopCandidate, /history response/i);
  assert.match(desktopCandidate, /1 MiB/i);
});

test("v0.1.7 documents Desktop rename target and concurrency fail-closed behavior", () => {
  assert.match(desktopReadme, /active target/i);
  assert.match(desktopReadme, /source and target/i);
  assert.match(desktopReadme, /concurrent rename/i);
  assert.match(desktopCandidate, /active target/i);
  assert.match(desktopCandidate, /concurrent rename/i);
});

test("v0.1.7 documents the Desktop export response limit", () => {
  assert.match(desktopReadme, /export response/i);
  assert.match(desktopReadme, /1 MiB/i);
  assert.match(desktopReadme, /413/i);
  assert.match(desktopCandidate, /export response/i);
  assert.match(desktopCandidate, /1 MiB/i);
});

test("v0.1.7 candidate clarifies the doctor managed-state merge", () => {
  assert.match(desktopCandidate, /selected runtime probe identity/i);
  assert.match(desktopCandidate, /managed cache state/i);
  assert.match(desktopCandidate, /`rust runtime` check/i);
  assert.match(desktopCandidate, /summary fail/i);
});

test("published project-state work is represented in the current npm docs", () => {
  const escapedVersion = publishedCliVersion.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  assert.match(
    readme,
    new RegExp(`published[\\s\\S]*@agent_cli/cli@${escapedVersion}[\\s\\S]*--project-state`, "i")
  );
  assert.match(
    npmRelease,
    new RegExp(`--project-state[\\s\\S]*已随已发布的 \`@agent_cli/cli@${escapedVersion}\` 提供`)
  );
  assert.doesNotMatch(readme, /has not yet been republished/);
  assert.doesNotMatch(npmRelease, /尚未随已发布/);
});

test("roadmap attributes the first project-state release to 0.1.3", () => {
  assert.match(
    nextRoadmap,
    /该变更已随已发布的 npm `@agent_cli\/cli@0\.1\.3` 提供/
  );
  assert.doesNotMatch(
    nextRoadmap,
    /--project-state[\s\S]{0,320}该变更已随已发布的 npm `@agent_cli\/cli@0\.1\.5` 提供/
  );
});

test("release checklist evidence matches the current fixed gate counts", () => {
  assert.match(releaseChecklist, /CLI 全量测试[^\n]*159\/159/);
  assert.match(releaseChecklist, /机器输出回归[^\n]*5\/5/);
  assert.match(releaseChecklist, /JSON 输出契约[^\n]*7\/7/);
  assert.match(releaseChecklist, /Provider error-body boundary[^\n]*2\/2/);
  assert.match(releaseChecklist, /documentation contract[^\n]*7\/7/);
  assert.doesNotMatch(releaseChecklist, /CLI 全量测试[^\n]*158\/158/);
  assert.doesNotMatch(releaseChecklist, /CLI 全量测试[^\n]*157\/157/);
  assert.doesNotMatch(releaseChecklist, /CLI 全量测试[^\n]*151\/151/);
  assert.doesNotMatch(releaseChecklist, /CLI 全量测试[^\n]*146\/146/);
  assert.doesNotMatch(releaseChecklist, /documentation contract[^\n]*2\/2/);
});
