import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUnifiedDiff,
  createChangeSetFileReview,
  createChangeSetId,
  createChangeSetReview,
  hashBytes,
} from "../dist/index.js";

const encoder = new TextEncoder();

function hash(text: string): string {
  return hashBytes(encoder.encode(text));
}

test("hashBytes returns a stable SHA-256 digest and change-set ids are unique UUIDs", () => {
  assert.equal(
    hash("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
  );
  const first = createChangeSetId();
  const second = createChangeSetId();
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

test("createChangeSetFileReview describes a new file with a real diff and hashes", () => {
  const review = createChangeSetFileReview({
    path: "notes.txt",
    before: undefined,
    after: "hello\nworld\n",
  });

  assert.equal(review.path, "notes.txt");
  assert.equal(review.kind, "file");
  assert.equal(review.beforeExists, false);
  assert.equal(review.beforeHash, undefined);
  assert.equal(review.afterExists, true);
  assert.equal(review.afterHash, hash("hello\nworld\n"));
  assert.equal(review.additions, 2);
  assert.equal(review.deletions, 0);
  assert.match(review.diff, /--- a\/notes\.txt/);
  assert.match(review.diff, /\+\+\+ b\/notes\.txt/);
  assert.match(review.diff, /@@ -0,0 \+1,2 @@/);
  assert.match(review.diff, /\+hello/);
  assert.match(review.diff, /\+world/);

  const unchanged = createChangeSetFileReview({
    path: "same.txt",
    before: "same\n",
    after: "same\n",
  });
  assert.equal(unchanged.diff, "");
  assert.equal(unchanged.additions, 0);
  assert.equal(unchanged.deletions, 0);
});

test("buildUnifiedDiff reports a minimal line change", () => {
  const result = buildUnifiedDiff("src/app.ts", "const value = 1;\nkeep\n", "const value = 2;\nkeep\n");

  assert.equal(result.additions, 1);
  assert.equal(result.deletions, 1);
  assert.match(result.diff, /@@ -1,2 \+1,2 @@/);
  assert.match(result.diff, /-const value = 1;/);
  assert.match(result.diff, /\+const value = 2;/);
  assert.match(result.diff, / keep/);
});

test("buildUnifiedDiff handles empty files, full deletion, and UTF-8 text", () => {
  assert.deepEqual(buildUnifiedDiff("empty.txt", "", ""), {
    diff: "",
    additions: 0,
    deletions: 0,
  });

  const deleted = buildUnifiedDiff("old.txt", "one\ntwo\n", "");
  assert.equal(deleted.additions, 0);
  assert.equal(deleted.deletions, 2);
  assert.match(deleted.diff, /@@ -1,2 \+0,0 @@/);
  assert.match(deleted.diff, /-one/);
  assert.match(deleted.diff, /-two/);

  const utf8 = createChangeSetFileReview({
    path: "你好.txt",
    before: "旧内容\n",
    after: "新内容\n",
  });
  assert.equal(utf8.beforeHash, hash("旧内容\n"));
  assert.equal(utf8.afterHash, hash("新内容\n"));
  assert.match(utf8.diff, /-旧内容/);
  assert.match(utf8.diff, /\+新内容/);
});

test("createChangeSetReview aggregates file statistics and preserves review metadata", () => {
  const files = [
    createChangeSetFileReview({ path: "a.txt", before: "a\n", after: "a\nb\n" }),
    createChangeSetFileReview({ path: "b.txt", before: "x\ny\n", after: "" }),
  ];

  const review = createChangeSetReview(files, {
    changeSetId: "cs-test",
    createdAt: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(review.changeSetId, "cs-test");
  assert.equal(review.createdAt, "2026-09-13T00:00:00.000Z");
  assert.equal(review.files.length, 2);
  assert.equal(review.additions, 1);
  assert.equal(review.deletions, 2);
  assert.deepEqual(
    review.files.map((file) => file.path),
    ["a.txt", "b.txt"]
  );
});
