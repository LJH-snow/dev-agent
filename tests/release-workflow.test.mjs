import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

function sectionAfter(marker, nextMarker) {
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `release workflow should contain ${marker}`);
  const end = nextMarker ? workflow.indexOf(nextMarker, start + marker.length) : -1;
  return workflow.slice(start, end >= 0 ? end : undefined);
}

test("release matrix covers every documented runtime target", () => {
  const buildJob = sectionAfter("  build:\n", "  release:\n");
  const expectedTargets = [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
  ];

  for (const target of expectedTargets) {
    assert.match(buildJob, new RegExp(`target: ${target}`));
  }
  assert.match(buildJob, /runs-on: \$\{\{ matrix\.os \}\}/);
  assert.match(buildJob, /targets: \$\{\{ matrix\.target \}\}/);
  assert.match(workflow, /aarch64-apple-darwin/);
  assert.match(workflow, /x86_64-apple-darwin/);
  assert.match(workflow, /x86_64-unknown-linux-gnu/);
  assert.match(workflow, /aarch64-unknown-linux-gnu/);
});

test("manual dispatch never enters the publish job", () => {
  const releaseJob = sectionAfter("  release:\n");

  assert.match(
    releaseJob,
    /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\)/,
    "the publish job must require a tag push, not merely a tag-shaped ref"
  );
  assert.doesNotMatch(
    releaseJob,
    /if: startsWith\(github\.ref, 'refs\/tags\/'\)/,
    "manual dispatch must never publish, even when a tag ref is selected"
  );
});

test("build job cannot inherit contents write permission", () => {
  const jobsStart = workflow.indexOf("jobs:\n");
  assert.ok(jobsStart >= 0, "release workflow should contain jobs");
  const workflowPermissions = workflow.slice(0, jobsStart);
  const buildJob = sectionAfter("  build:\n", "  release:\n");
  const releaseJob = sectionAfter("  release:\n");

  assert.match(
    workflowPermissions,
    /permissions:\n\s+contents: read/,
    "workflow-level permissions must be read-only"
  );
  assert.doesNotMatch(
    workflowPermissions,
    /permissions:\n\s+contents: write/,
    "workflow-level contents write would grant build jobs unnecessary access"
  );
  assert.doesNotMatch(
    buildJob,
    /permissions:[\s\S]*contents: write/,
    "the build job must not have contents write permission"
  );
  assert.match(
    releaseJob,
    /permissions:\n\s+contents: write/,
    "only the publish job should have contents write permission"
  );
});

test("release packaging verifies archive contents, checksum, executable bit, and README", () => {
  const buildJob = sectionAfter("  build:\n", "  release:\n");

  assert.match(buildJob, /test -x "dist\/\$\{asset\}\/dev-agent-executor"/);
  assert.match(buildJob, /test -f "dist\/\$\{asset\}\/README\.md"/);
  assert.match(buildJob, /tar -tzf "dist\/\$\{asset\}\.tar\.gz"/);
  assert.match(buildJob, /sha256sum -c "\$\{asset\}\.tar\.gz\.sha256"|shasum -a 256 -c/);
});

test("release packaging and publish boundaries are fail-closed and tag-only", () => {
  const buildJob = sectionAfter("  build:\n", "  release:\n");
  const releaseJob = sectionAfter("  release:\n");

  assert.match(buildJob, /uses: dtolnay\/rust-toolchain@stable/);
  assert.match(buildJob, /targets: \$\{\{ matrix\.target \}\}/);
  assert.match(
    buildJob,
    /run: cargo build --release --bin dev-agent-executor --target \$\{\{ matrix\.target \}\}/
  );
  assert.match(buildJob, /working-directory: runtime\/rust/);
  assert.match(buildJob, /tar -C dist -czf/);
  assert.match(buildJob, /shasum -a 256/);
  assert.match(buildJob, /sha256sum/);
  assert.match(buildJob, /uses: actions\/upload-artifact@v7/);
  assert.match(buildJob, /dist\/dev-agent-executor-\$\{\{ matrix\.target \}\}\.tar\.gz/);
  assert.match(buildJob, /dist\/dev-agent-executor-\$\{\{ matrix\.target \}\}\.tar\.gz\.sha256/);
  assert.match(buildJob, /if-no-files-found: error/);

  assert.match(releaseJob, /needs: \[build, cli-package, manifest\]/);
  assert.match(releaseJob, /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(releaseJob, /uses: actions\/download-artifact@v8/);
  assert.match(releaseJob, /merge-multiple: true/);
  assert.match(releaseJob, /gh release create/);
  assert.match(releaseJob, /dist\/\*\.tar\.gz dist\/\*\.sha256/);
  assert.match(workflow, /workflow_dispatch:/);
});

test("release workflow keeps publish verification bounded and credentials ephemeral", () => {
  const buildJob = sectionAfter("  build:\n", "  release:\n");
  const releaseJob = sectionAfter("  release:\n");

  assert.match(buildJob, /timeout-minutes: 30/);
  assert.match(buildJob, /fail-fast: false/);
  assert.match(buildJob, /persist-credentials: false/);
  assert.match(releaseJob, /timeout-minutes: 10/);
  assert.match(releaseJob, /persist-credentials: false/);
  assert.match(releaseJob, /git rev-list -n 1/);
  assert.match(releaseJob, /test \"\$\{tag_sha\}\" = \"\$\{GITHUB_SHA\}\"/);
  assert.match(releaseJob, /Verify downloaded release artifacts/);
  assert.match(releaseJob, /dev-agent-executor-aarch64-apple-darwin\.tar\.gz/);
  assert.match(releaseJob, /sha256sum -c/);
  assert.match(releaseJob, /--verify-tag/);
});

test("release workflow verifies and carries the npm CLI package without publishing it", () => {
  const cliJob = sectionAfter("  cli-package:\n", "  release:\n");
  const releaseJob = sectionAfter("  release:\n");
  assert.match(cliJob, /name: Build CLI npm package/);
  assert.match(cliJob, /- name: CLI package install smoke test\n\s+run: pnpm package:smoke/);
  assert.match(cliJob, /- name: Pack CLI npm artifact/);
  assert.match(cliJob, /- name: Verify CLI npm artifact/);
  assert.match(cliJob, /tar -tzf "\$\{tarball\}"/);
  assert.match(cliJob, /- name: Upload CLI package/);
  assert.match(cliJob, /pnpm --filter @agent_cli\/cli pack --pack-destination dist/);
  assert.match(cliJob, /path: dist\/agent_cli-cli-\*\.tgz/);
  assert.match(releaseJob, /needs: \[build, cli-package, manifest\]/);
  assert.match(releaseJob, /agent_cli-cli-\*\.tgz/);
  assert.match(releaseJob, /dist\/\*\.tar\.gz dist\/\*\.sha256 dist\/\*\.tgz/);
});


test("manifest job aggregates the four build outputs and uploads the checksum-only contract", () => {
  const manifestJob = sectionAfter("  manifest:\n", "  release:\n");

  assert.match(manifestJob, /needs: build/);
  assert.match(manifestJob, /actions\/download-artifact@v8/);
  assert.match(manifestJob, /merge-multiple: true/);
  assert.match(manifestJob, /build-runtime-manifest\.mjs/);
  assert.match(manifestJob, /verify-release-version\.mjs/);
  assert.match(manifestJob, /--tag/);
  assert.match(manifestJob, /--repository/);
  assert.match(manifestJob, /actions\/upload-artifact@v7/);
  assert.match(manifestJob, /dev-agent-runtime-manifest\.json/);
  assert.match(manifestJob, /checksum-only/i);
});

test("release allowlist and release assets include the runtime manifest", () => {
  const releaseJob = sectionAfter("  release:\n");

  assert.match(releaseJob, /needs: \[build, cli-package, manifest\]/);
  assert.match(releaseJob, /dev-agent-runtime-manifest\.json/);
  assert.match(releaseJob, /JSON\.parse|node .*dev-agent-runtime-manifest/);
  assert.match(releaseJob, /gh release create/);
  assert.match(releaseJob, /dist\/dev-agent-runtime-manifest\.json/);
});

test("manual dispatch can build and upload a manifest but can never publish", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release_tag:/);
  const releaseJob = sectionAfter("  release:\n");
  assert.match(
    releaseJob,
    /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\)/
  );
  assert.doesNotMatch(releaseJob, /if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
});

test("manifest and build jobs keep read-only contents permissions", () => {
  const jobsStart = workflow.indexOf("jobs:\n");
  const workflowPermissions = workflow.slice(0, jobsStart);
  const buildJob = sectionAfter("  build:\n", "  cli-package:\n");
  const manifestJob = sectionAfter("  manifest:\n", "  release:\n");

  assert.match(workflowPermissions, /permissions:\n\s+contents: read/);
  assert.doesNotMatch(buildJob, /contents: write/);
  assert.doesNotMatch(manifestJob, /contents: write/);
});
