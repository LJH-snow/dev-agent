import type { ModelSpeedMode } from "@dev-agent/model";

export type SpeedModeCommand =
  | { readonly kind: "show" }
  | { readonly kind: "set"; readonly mode: ModelSpeedMode }
  | { readonly kind: "invalid" };

export function parseSpeedModeCommand(command: string): SpeedModeCommand | undefined {
  if (command === ":mode") return { kind: "show" };
  if (!command.startsWith(":mode ")) return undefined;
  const mode = command.slice(":mode ".length).trim().toLowerCase();
  if (mode === "fast" || mode === "balanced" || mode === "deep") {
    return { kind: "set", mode };
  }
  return { kind: "invalid" };
}

export function parseBenchmarkCommand(command: string): string | undefined {
  if (command === ":bench") return "hi";
  if (command.startsWith(":bench ")) {
    const prompt = command.slice(":bench ".length).trim();
    return prompt || "hi";
  }
  return undefined;
}
