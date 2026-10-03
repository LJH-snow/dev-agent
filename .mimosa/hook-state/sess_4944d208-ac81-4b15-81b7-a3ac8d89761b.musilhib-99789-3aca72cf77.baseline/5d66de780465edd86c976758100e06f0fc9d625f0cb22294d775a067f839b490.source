import assert from "node:assert/strict";
import test from "node:test";

import { createMcpServer } from "../dist/index.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function delayedCancellationTool() {
  const started = deferred<void>();
  const release = deferred<void>();
  let signal: AbortSignal | undefined;

  return {
    tool: {
      name: "slow",
      description: "Waits until the caller cancels it.",
      async execute(_input: unknown, context?: { sessionId?: string; workingDirectory?: string; signal?: AbortSignal }) {
        signal = context?.signal;
        started.resolve(undefined);
        await Promise.race([
          release.promise,
          new Promise<never>((_resolve, reject) => {
            context?.signal?.addEventListener(
              "abort",
              () => reject(new Error("tool observed cancellation")),
              { once: true }
            );
          }),
        ]);
        return null;
      },
    },
    started: started.promise,
    release: () => release.resolve(undefined),
    get signal() {
      return signal;
    },
  };
}

test("notifications/cancelled aborts the matching in-flight tool request", async () => {
  const fixture = delayedCancellationTool();
  const server = createMcpServer({ tools: [fixture.tool] });

  const call = server.handleMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "slow", arguments: {} },
    })
  );
  await fixture.started;

  const notification = await server.handleMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 7, reason: "user stopped the run" },
    })
  );

  assert.equal(notification, undefined);
  const responsePromise = Promise.race([
    call,
    new Promise<string | undefined>((resolve) => setTimeout(() => resolve(undefined), 100)),
  ]);
  const responseLine = await responsePromise;
  if (responseLine === undefined) {
    fixture.release();
  }
  const response = JSON.parse((await call) ?? "null");
  assert.equal(fixture.signal?.aborted, true);
  assert.equal(fixture.signal?.reason, "user stopped the run");
  assert.equal(response.id, 7);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.content[0].text, "tool observed cancellation");
});

test("start processes cancellation notifications while a tool is still running", async () => {
  const fixture = delayedCancellationTool();
  const input = new FakeInput();
  const output = new FakeOutput();
  const server = createMcpServer({ tools: [fixture.tool], input, output });

  const started = server.start();
  input.emit(
    "data",
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "slow", arguments: {} },
    })}\n`
  );
  await fixture.started;
  input.emit(
    "data",
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 8, reason: "stop from stdio" },
    })}\n`
  );
  input.emit("end");

  const status = await Promise.race([
    started.then(() => "completed" as const),
    new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 100)),
  ]);

  if (status !== "completed") {
    // Release the intentionally blocked fixture so the RED test can cleanly
    // finish even while the old serial input pump is still under test.
    fixture.release();
    await started;
    await Promise.race([started, new Promise<void>((resolve) => setTimeout(resolve, 100))]);
  } else {
    await started;
  }

  assert.equal(status, "completed");
  assert.equal(output.lines.length, 1);
  const response = JSON.parse(output.lines[0] ?? "null");
  assert.equal(response.id, 8);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.content[0].text, "tool observed cancellation");
});

class FakeInput {
  private readonly dataListeners: Array<(chunk: string | Buffer) => void> = [];
  private readonly endListeners: Array<() => void> = [];

  on(event: "data", listener: (chunk: string | Buffer) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: unknown) => void): this;
  on(event: "data" | "end" | "error", listener: (...args: any[]) => void): this {
    if (event === "data") {
      this.dataListeners.push(listener as (chunk: string | Buffer) => void);
    } else if (event === "end") {
      this.endListeners.push(listener as () => void);
    }
    return this;
  }

  emit(event: "data" | "end", chunk?: string): void {
    if (event === "data") {
      for (const listener of this.dataListeners) {
        listener(chunk ?? "");
      }
      return;
    }
    for (const listener of this.endListeners) {
      listener();
    }
  }
}

class FakeOutput {
  readonly lines: string[] = [];

  write(chunk: string): void {
    this.lines.push(chunk.trim());
  }
}
