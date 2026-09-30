import type { BackgroundJobSnapshot } from "./background-jobs.js";
import { formatBackgroundJob, formatBackgroundJobs } from "./background-jobs.js";

export type BackgroundJobCommand =
  | { readonly handled: false }
  | { readonly handled: true; readonly action: "list" }
  | { readonly handled: true; readonly action: "start"; readonly prompt: string }
  | { readonly handled: true; readonly action: "inspect"; readonly id: string }
  | { readonly handled: true; readonly action: "cancel"; readonly id: string }
  | { readonly handled: true; readonly action: "resume"; readonly id: string }
  | { readonly handled: true; readonly action: "usage" };

export function parseBackgroundJobCommand(command: string): BackgroundJobCommand {
  const normalized = normalize(command);
  if (normalized === ":jobs") return { handled: true, action: "list" };
  if (normalized === ":job" || normalized === ":job help") {
    return { handled: true, action: "usage" };
  }
  if (!normalized.startsWith(":job ")) return { handled: false };

  const rest = normalized.slice(5).trim();
  const start = /^start\s+([\s\S]+)$/u.exec(rest);
  if (start) {
    const prompt = start[1]!.trim();
    return prompt.length === 0
      ? { handled: true, action: "usage" }
      : { handled: true, action: "start", prompt };
  }
  const operation = /^(cancel|resume)\s+([^\s]+)$/u.exec(rest);
  if (operation) {
    return {
      handled: true,
      action: operation[1] as "cancel" | "resume",
      id: operation[2]!,
    };
  }
  if (/^\S+$/u.test(rest)) return { handled: true, action: "inspect", id: rest };
  return { handled: true, action: "usage" };
}

export function formatBackgroundJobCommandResult(
  command: BackgroundJobCommand,
  jobs: readonly BackgroundJobSnapshot[] = [],
  job?: BackgroundJobSnapshot,
): string {
  if (!command.handled) return "";
  switch (command.action) {
    case "list":
      return formatBackgroundJobs(jobs);
    case "inspect":
      return formatBackgroundJob(job, command.id);
    case "start":
      return job === undefined
        ? "Background job could not be started."
        : `Started background job ${job.id} (${job.status}). Use :jobs to check progress.`;
    case "cancel":
      return job === undefined
        ? `Unknown background job: ${safeText(command.id)}`
        : job.status === "cancelled"
          ? `Background job ${job.id} cancelled.`
          : `Cancellation requested for background job ${job.id} (${job.status}).`;
    case "resume":
      return job === undefined
        ? `Unknown background job: ${safeText(command.id)}`
        : `Explicit continuation started for background job ${job.id} (${job.status}).`;
    case "usage":
      return "Usage: :jobs | :job <id> | :job start <request> | :job cancel <id> | :job resume <id>";
  }
}

function normalize(command: string): string {
  const value = command.trim();
  return value.startsWith("/") ? `:${value.slice(1)}` : value;
}

function safeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 160);
}
