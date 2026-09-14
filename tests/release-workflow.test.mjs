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

  assert.match(releaseJob, /needs: build/);
  assert.match(releaseJob, /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(releaseJob, /uses: actions\/download-artifact@v8/);
  assert.match(releaseJob, /merge-multiple: true/);
  assert.match(releaseJob, /gh release create/);
  assert.match(releaseJob, /dist\/\*\.tar\.gz dist\/\*\.sha256/);
  assert.match(workflow, /workflow_dispatch:/);
});
