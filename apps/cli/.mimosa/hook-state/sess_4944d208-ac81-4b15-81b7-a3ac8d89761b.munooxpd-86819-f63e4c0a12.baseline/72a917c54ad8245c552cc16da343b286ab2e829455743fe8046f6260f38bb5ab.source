import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

type ResolvePromptContext = (
  prompt: string,
  options: {
    readonly workingDirectory: string;
    readonly maxFileChars?: number;
    readonly maxTotalChars?: number;
    readonly maxFiles?: number;
    readonly gitDiff?: (workingDirectory: string) => Promise<string>;
  },
) => Promise<{
  readonly prompt: string;
  readonly context?: string;
    readonly attachments: readonly {
      readonly reference: string;
      readonly kind: string;
      readonly chars: number;
      readonly truncated: boolean;
    }[];
  readonly unresolved: readonly string[];
}>;

async function loadResolver(): Promise<ResolvePromptContext> {
  const module = await import("../dist/context-attachments.js") as {
    readonly resolvePromptContext: ResolvePromptContext;
  };
  return module.resolvePromptContext;
}

async function withWorkspace(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-context-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("resolves a file reference without replacing the visible prompt", async () => {
  await withWorkspace(async (workingDirectory) => {
    await writeFile(join(workingDirectory, "src.ts"), "export const answer = 42;\n", "utf8");
    const resolvePromptContext = await loadResolver();

    const result = await resolvePromptContext("explain @src.ts", { workingDirectory });

    assert.equal(result.prompt, "explain @src.ts");
    assert.deepEqual(
      result.attachments.map(({ reference, kind }) => ({ reference, kind })),
      [{ reference: "src.ts", kind: "file" }],
    );
    assert.equal(result.attachments[0]?.truncated, false);
    assert.equal(result.unresolved.length, 0);
    assert.match(result.context ?? "", /export const answer = 42/);
    assert.match(result.context ?? "", /src\.ts/);
    assert.doesNotMatch(result.context ?? "", new RegExp(workingDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("bounds directory attachments and rejects paths outside the workspace", async () => {
  await withWorkspace(async (workingDirectory) => {
    await mkdir(join(workingDirectory, "src"), { recursive: true });
    await writeFile(join(workingDirectory, "src", "a.ts"), "a".repeat(40), "utf8");
    await writeFile(join(workingDirectory, "src", "b.ts"), "b".repeat(40), "utf8");
    await writeFile(join(workingDirectory, "outside.txt"), "outside", "utf8");
    const resolvePromptContext = await loadResolver();

    const result = await resolvePromptContext("inspect @src and @../outside.txt", {
      workingDirectory,
      maxFileChars: 12,
      maxTotalChars: 30,
      maxFiles: 1,
    });

    assert.deepEqual(
      result.attachments.map(({ reference, kind }) => ({ reference, kind })),
      [{ reference: "src", kind: "directory" }],
    );
    assert.deepEqual(result.unresolved, ["../outside.txt"]);
    assert.ok((result.context?.length ?? 0) <= 30);
    assert.doesNotMatch(result.context ?? "", /outside/);
  });
});

test("resolves @git diff through the bounded git provider", async () => {
  await withWorkspace(async (workingDirectory) => {
    const resolvePromptContext = await loadResolver();
    const result = await resolvePromptContext("review @git diff", {
      workingDirectory,
      gitDiff: async (cwd) => {
        assert.equal(cwd, workingDirectory);
        return "diff --git a/src.ts b/src.ts\n+added line\n";
      },
    });

    assert.deepEqual(
      result.attachments.map(({ reference, kind }) => ({ reference, kind })),
      [{ reference: "git diff", kind: "git-diff" }],
    );
    assert.equal(result.attachments[0]?.truncated, false);
    assert.equal(result.unresolved.length, 0);
    assert.match(result.context ?? "", /added line/);
  });
});

test("reports a missing reference without treating it as attached context", async () => {
  await withWorkspace(async (workingDirectory) => {
    const resolvePromptContext = await loadResolver();
    const result = await resolvePromptContext("inspect @missing.ts", { workingDirectory });

    assert.deepEqual(result.attachments, []);
    assert.deepEqual(result.unresolved, ["missing.ts"]);
    assert.equal(result.context, undefined);
  });
});
