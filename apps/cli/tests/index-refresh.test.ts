import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  indexDirectory,
  refreshIndexDirectory,
  type IndexProgress,
} from "../dist/index-command.js";

test("index refresh cancellation preserves the previous index and can recover", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-index-refresh-cancel-"));
  const indexPath = join(root, "cache", "index.json");
  try {
    await writeFile(join(root, "stable.ts"), "export const stable = 1;\n", "utf8");
    await indexDirectory(root, undefined, [], indexPath);
    const before = await readFile(indexPath);

    for (let index = 0; index < 16; index += 1) {
      await writeFile(
        join(root, `new-${index}.ts`),
        `export const newSymbol${index} = ${index};\n`,
        "utf8"
      );
    }

    const controller = new AbortController();
    const progress: IndexProgress[] = [];
    await assert.rejects(
      indexDirectory(root, undefined, [], indexPath, {
        concurrency: 2,
        signal: controller.signal,
        onProgress: (event: IndexProgress) => {
          progress.push(event);
          if (event.phase === "processing" && event.completed >= 1 && event.active === 0) {
            controller.abort();
          }
        },
      }),
      (error) => {
        const candidate = error as { code?: unknown; progress?: { phase?: unknown } };
        assert.equal(candidate.code, "INDEX_REFRESH_CANCELLED");
        assert.equal(candidate.progress?.phase, "processing");
        return true;
      }
    );

    assert.deepEqual(await readFile(indexPath), before);
    assert.ok(progress.length > 0);
    for (const phase of ["discovering", "processing", "persisting"]) {
      const phaseProgress = progress.filter((event) => event.phase === phase);
      assert.ok(phaseProgress.every((event, index) => (
        index === 0 || event.completed >= phaseProgress[index - 1].completed
      )));
    }

    const recovered = await indexDirectory(root, undefined, [], indexPath);
    assert.equal(recovered.files, 17);
    const refreshed = JSON.parse(await readFile(indexPath, "utf8"));
    assert.ok(refreshed.symbols.some((symbol) => symbol.name === "newSymbol15"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("index refresh reports bounded processing concurrency", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-index-refresh-concurrency-"));
  try {
    for (let index = 0; index < 12; index += 1) {
      await writeFile(
        join(root, `file-${index}.ts`),
        `export const value${index} = ${index};\n`,
        "utf8"
      );
    }

    const progress: IndexProgress[] = [];
    await indexDirectory(root, undefined, [], join(root, "index.json"), {
      concurrency: 3,
      onProgress: (event: IndexProgress) => progress.push(event),
    });

    const processing = progress.filter((event) => event.phase === "processing");
    assert.ok(processing.length > 0);
    assert.ok(processing.every((event) => event.active <= 3));
    assert.equal(processing.at(-1).completed, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("index refresh returns a stable cancelled result for an already-aborted request", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-index-refresh-aborted-"));
  try {
    const controller = new AbortController();
    controller.abort();

    const result = await refreshIndexDirectory(
      root,
      undefined,
      [],
      join(root, "index.json"),
      { signal: controller.signal }
    );

    assert.equal(result.status, "cancelled");
    assert.equal(result.progress.phase, "discovering");
    assert.equal(typeof result.progress.completed, "number");
    assert.equal(typeof result.progress.total, "number");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
