import { performance } from "node:perf_hooks";
import type { ModelProvider } from "@dev-agent/model";

export interface SpeedBenchmarkResult {
  readonly firstTokenMs?: number;
  readonly totalMs: number;
}

/** Runs one isolated provider request and returns timings only. */
export async function benchmarkModel(
  provider: ModelProvider,
  prompt = "hi",
): Promise<SpeedBenchmarkResult> {
  const startedAt = performance.now();
  let firstTokenMs: number | undefined;
  const messages = [{ role: "user" as const, content: prompt }];
  if (provider.streamChat) {
    await provider.streamChat(messages, {
      // A latency smoke test should not spend time generating a long answer.
      maxTokens: 32,
      onToken: (token) => {
        if (token.length > 0 && firstTokenMs === undefined) {
          firstTokenMs = elapsedSince(startedAt);
        }
      },
    });
  } else {
    await provider.chat(messages, { maxTokens: 32 });
  }
  return {
    ...(firstTokenMs === undefined ? {} : { firstTokenMs }),
    totalMs: elapsedSince(startedAt),
  };
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}
