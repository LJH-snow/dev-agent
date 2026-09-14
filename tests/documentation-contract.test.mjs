import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const docsReadme = readFileSync(new URL("../docs/README.md", import.meta.url), "utf8");

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
  ]) {
    assert.ok(readme.includes(link), `README should link to ${link}`);
  }

  for (const link of [
    "../README.md",
    "architecture.md",
    "CHANGELOG.md",
    "day-plan-v60.md",
    "day-plan-v60-progress.md",
  ]) {
    assert.ok(docsReadme.includes(`](${link})`), `docs/README.md should link to ${link}`);
  }
});
