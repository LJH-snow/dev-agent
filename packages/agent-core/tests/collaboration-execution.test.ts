import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, ChatOptions, ModelProvider } from "@dev-agent/model";

import {
  AgentToolRegistry,
  createCollaborativeExecution,
  createCollaborationTaskGraph,
  fingerprintCollaborationTaskGraph,
  planCollaborativeTasks,
  runCollaborativeExecution,
  type CollaborationExecutionEvent,
  type CollaborationTask,
  type CollaborationWorkspace,
  type CollaborationWorkspaceProvider,
  type ToolExecutionContext,
} from "../dist/index.js";

function modelThatFinishes(): {
  readonly id: "openai";
  readonly model: string;
  chat: (messages: readonly { role: string; content: string }[]) => Promise<{
    content: string;
    toolCalls: [];
  }>;
} {
  return {
    id: "openai",
    model: "test-model",
    async chat(messages) {
      const task = messages
        .find((message) => message.role === "user")
        ?.content.match(/TASK ID: ([^\n]+)/)?.[1] ?? "unknown";
      return { content: `completed ${task}`, toolCalls: [] };
    },
  };
}

function fakeWorkspaceProvider(
  options: {
    readonly onCreate?: (task: CollaborationTask) => Promise<void> | void;
    readonly onDispose?: (workspace: CollaborationWorkspace) => Promise<void> | void;
  } = {},
): CollaborationWorkspaceProvider {
  return {
    async create(task) {
      await options.onCreate?.(task);
      return {
        id: `workspace-${task.id}`,
        path: `/tmp/${task.id}`,
        mode: "worktree",
      };
    },
    async inspect(workspace) {
      return {
        changedFiles: [`${workspace.id}.txt`],
        additions: 1,
        deletions: 0,
        summary: `${workspace.id} diff`,
      };
    },
    async dispose(workspace) {
      await options.onDispose?.(workspace);
    },
  };
}

test("rejects missing dependencies and cycles before creating workspaces", () => {
  assert.throws(
    () =>
      createCollaborationTaskGraph([
        {
          id: "build",
          title: "Build",
          instructions: "build",
          dependsOn: ["missing"],
        },
      ]),
    /unknown dependency: missing/,
  );

  assert.throws(
    () =>
      createCollaborationTaskGraph([
        { id: "a", title: "A", instructions: "a", dependsOn: ["b"] },
        { id: "b", title: "B", instructions: "b", dependsOn: ["a"] },
      ]),
    /cycle/,
  );
});

test("parses a bounded model task plan into a validated DAG", async () => {
  const tasks = await planCollaborativeTasks("add feature", {
    model: {
      id: "openai",
      model: "planner",
      async chat() {
        return {
          content: JSON.stringify({
            tasks: [
              {
                id: "analysis",
                title: "Analyze",
                role: "architect",
                instructions: "inspect the repository",
              },
              {
                id: "implementation",
                title: "Implement",
                role: "coder",
                instructions: "make the code change",
                dependsOn: ["analysis"],
                maxAttempts: 1,
                toolAllowlist: ["shell"],
              },
            ],
          }),
          toolCalls: [],
        };
      },
    },
  });

  assert.deepEqual(
    tasks.map((task) => [task.id, task.dependsOn]),
    [
      ["analysis", undefined],
      ["implementation", ["analysis"]],
    ],
  );
  assert.equal(tasks.find((task) => task.id === "implementation")?.maxAttempts, 1);
  assert.equal(
    Object.hasOwn(tasks.find((task) => task.id === "implementation") ?? {}, "toolAllowlist"),
    false,
    "planner output must not assign worker capabilities",
  );
});

test("uses a safe parallel-capable fallback when the planner response is invalid", async () => {
  const tasks = await planCollaborativeTasks("add feature", {
    model: {
      id: "openai",
      model: "planner",
      async chat() {
        return { content: "not json", toolCalls: [] };
      },
    },
  });

  assert.deepEqual(tasks.map((task) => task.id), [
    "analysis",
    "implementation",
    "tests",
    "review",
  ]);
  assert.deepEqual(tasks.find((task) => task.id === "implementation")?.dependsOn, ["analysis"]);
  assert.deepEqual(tasks.find((task) => task.id === "tests")?.dependsOn, ["analysis"]);
});

test("caller-owned task tool scopes hide and block tools outside the allowlist", async () => {
  const tools = new AgentToolRegistry();
  let visibleRuns = 0;
  let hiddenRuns = 0;
  tools.register({
    name: "visible-tool",
    description: "A tool included in this worker's scope.",
    metadata: { risk: "read-only", confirmation: "never" },
    async execute() {
      visibleRuns += 1;
      return { ok: true };
    },
  });
  tools.register({
    name: "hidden-tool",
    description: "A tool excluded from this worker's scope.",
    metadata: { risk: "read-only", confirmation: "never" },
    async execute() {
      hiddenRuns += 1;
      return { ok: true };
    },
  });

  const advertisedToolNames: string[][] = [];
  let modelCalls = 0;
  const result = await runCollaborativeExecution("use only the permitted tool", {
    model: {
      id: "openai",
      model: "test-model",
      async chat(_messages, options) {
        advertisedToolNames.push((options?.tools ?? []).map((tool) => tool.name));
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: "",
            toolCalls: [{ id: "call-visible", name: "visible-tool", input: {} }],
          };
        }
        if (modelCalls === 2) {
          // A model may still emit an unadvertised name; runtime lookup must
          // enforce the same allowlist rather than trusting the schema.
          return {
            content: "",
            toolCalls: [{ id: "call-hidden", name: "hidden-tool", input: {} }],
          };
        }
        return { content: "completed", toolCalls: [] };
      },
    },
    tools,
    workingDirectory: "/workspace",
    sessionId: "tool-scope-team",
    tasks: [{ id: "scoped", title: "Scoped task", instructions: "use permitted tools" }],
    workspaceProvider: fakeWorkspaceProvider(),
    toolAllowlistForTask: (task) => task.id === "scoped" ? ["visible-tool"] : [],
  });

  assert.equal(result.tasks[0]?.status, "completed");
  assert.equal(modelCalls, 3);
  assert.deepEqual(advertisedToolNames, [
    ["visible-tool"],
    ["visible-tool"],
    ["visible-tool"],
  ]);
  assert.equal(visibleRuns, 1);
  assert.equal(hiddenRuns, 0);
});

test("matching caller-owned role bindings select worker model, prompt, tools, and budget", async () => {
  const tools = new AgentToolRegistry();
  let roleToolRuns = 0;
  let outsideRoleToolRuns = 0;
  tools.register({
    name: "role-tool",
    description: "Allowed by the named role.",
    metadata: { risk: "read-only", confirmation: "never" },
    async execute() { roleToolRuns += 1; return { ok: true }; },
  });
  tools.register({
    name: "reviewed-only-tool",
    description: "Allowed by the task scope, but not this role.",
    metadata: { risk: "read-only", confirmation: "never" },
    async execute() { outsideRoleToolRuns += 1; return { ok: true }; },
  });

  const baseModelCalls: string[] = [];
  const roleRequests: Array<{
    readonly messages: readonly { readonly role: string; readonly content: string }[];
    readonly toolNames: readonly string[];
  }> = [];
  let roleCallCount = 0;
  const baseModel: ModelProvider = {
    id: "openai",
    model: "base-model",
    async chat(messages: readonly ChatMessage[]) {
      baseModelCalls.push(messages.map((message) => message.content).join("\n"));
      return { content: "base model must not run", toolCalls: [] as const };
    },
  };
  const roleModel: ModelProvider = {
    id: "openai",
    model: "reviewer-model",
    async chat(messages: readonly ChatMessage[], options?: ChatOptions) {
      roleRequests.push({
        messages,
        toolNames: options?.tools?.map((tool) => tool.name) ?? [],
      });
      roleCallCount += 1;
      return roleCallCount === 1
        ? {
            content: "",
            toolCalls: [{ id: "call-role-tool", name: "role-tool", input: {} }],
          }
        : { content: "finished", toolCalls: [] };
    },
  };

  const result = await createCollaborativeExecution({
    model: baseModel,
    tools,
    roleBindings: [{
      id: "tester",
      instructions: "TRUSTED_TESTER_ROLE_INSTRUCTIONS",
      model: roleModel,
      tools: {
        list: () => [tools.get("role-tool")!],
        get: (name) => name === "role-tool" ? tools.get(name) : undefined,
      },
      budget: { maxTurns: 1 },
    }],
    prompt: "Review this implementation.",
    tasks: [{
      id: "review",
      title: "Review implementation",
      role: "tester",
      instructions: "Inspect the behavior and report risks.",
      maxAttempts: 1,
    }],
    workspaceProvider: fakeWorkspaceProvider(),
    workingDirectory: "/tmp/work",
    sessionId: "role-binding-session",
    maxTurns: 8,
    toolScopeCeiling: ["role-tool", "reviewed-only-tool"],
    toolAllowlistForTask: () => ["role-tool", "reviewed-only-tool"],
  }).promise;

  assert.equal(roleCallCount, 1, "the role's one-turn budget stops before a second model call");
  assert.equal(
    result.tasks[0]?.status,
    "failed",
    `one-turn role budget ended as ${result.tasks[0]?.status} after ${roleCallCount} calls ` +
      `and ${result.tasks[0]?.attempts} attempt(s): ${result.tasks[0]?.error ?? "no error"}`,
  );
  assert.deepEqual(baseModelCalls, []);
  assert.equal(roleToolRuns, 1);
  assert.equal(outsideRoleToolRuns, 0);
  assert.deepEqual(roleRequests[0]?.toolNames, ["role-tool"]);
  assert.ok(roleRequests[0]?.messages.some((message) =>
    message.role === "system" && message.content.includes("TRUSTED_TESTER_ROLE_INSTRUCTIONS"),
  ));
  assert.ok(roleRequests[0]?.messages.some((message) =>
    message.role === "user" && message.content.includes("TASK ROLE: tester"),
  ));
});

test("invalid task tool scopes fail before creating workspaces", () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "available-tool",
    description: "Available tool.",
    async execute() {
      return { ok: true };
    },
  });
  let workspaceCreates = 0;

  const createExecution = (allowlist: readonly string[]) => () =>
    createCollaborativeExecution({
      model: modelThatFinishes(),
      tools,
      prompt: "invalid scope",
      tasks: [{ id: "invalid-scope", title: "Invalid scope", instructions: "do nothing" }],
      workspaceProvider: fakeWorkspaceProvider({
        onCreate: () => {
          workspaceCreates += 1;
        },
      }),
      workingDirectory: "/workspace",
      sessionId: "invalid-scope-team",
      toolAllowlistForTask: () => allowlist,
    });

  assert.throws(createExecution(["unavailable-tool"]), /references an unavailable tool/);
  assert.throws(
    createExecution(["available-tool", "available-tool"]),
    /contains a duplicate tool name/,
  );
  assert.throws(createExecution([" available-tool"]), /contains an invalid tool name/);
  assert.throws(
    createExecution(Array.from({ length: 257 }, () => "available-tool")),
    /exceeds 256 entries/,
  );
  assert.equal(workspaceCreates, 0);
});

test("collaboration plan fingerprints cover normalized task order and execution details", () => {
  const plan: readonly CollaborationTask[] = [
    {
      id: " Inspect ",
      title: " Inspect files ",
      role: " architect ",
      instructions: "Read the source tree.",
    },
    {
      id: "implement",
      title: "Implement",
      instructions: "Apply the change.",
      dependsOn: ["inspect"],
      maxAttempts: 2,
    },
  ];
  const normalized = createCollaborationTaskGraph(plan).tasks;

  assert.equal(
    fingerprintCollaborationTaskGraph(plan),
    fingerprintCollaborationTaskGraph(normalized),
    "normalization produces a stable plan identity",
  );
  assert.notEqual(
    fingerprintCollaborationTaskGraph(plan),
    fingerprintCollaborationTaskGraph([...normalized].reverse()),
    "ordered task slots are part of the binding",
  );
  assert.notEqual(
    fingerprintCollaborationTaskGraph(plan),
    fingerprintCollaborationTaskGraph([
      normalized[0]!,
      { ...normalized[1]!, instructions: "Different reviewed instructions." },
    ]),
    "task instructions are part of the binding",
  );
  assert.notEqual(
    fingerprintCollaborationTaskGraph(plan),
    fingerprintCollaborationTaskGraph([
      normalized[0]!,
      { ...normalized[1]!, dependsOn: [] },
    ]),
    "dependency edges are part of the binding",
  );
});

test("reviewed tool scopes bind by ordered plan slot and stay under the global ceiling", async () => {
  const tools = new AgentToolRegistry();
  for (const name of ["filesystem", "search", "shell"]) {
    tools.register({
      name,
      description: `${name} test tool.`,
      async execute() {
        return { ok: true };
      },
    });
  }
  const tasks: readonly CollaborationTask[] = [
    { id: "planner-id-one", title: "First", instructions: "Use the first slot." },
    {
      id: "planner-id-two",
      title: "Second",
      instructions: "Use the second slot.",
      dependsOn: ["planner-id-one"],
    },
  ];
  const scopesSeenByTask = new Map<string, string[]>();
  const result = await runCollaborativeExecution("run reviewed plan", {
    model: {
      id: "openai",
      model: "test-model",
      async chat(messages, options) {
        const taskId = messages
          .find((message) => message.role === "user")
          ?.content.match(/TASK ID: ([^\n]+)/)?.[1] ?? "unknown";
        scopesSeenByTask.set(
          taskId,
          (options?.tools ?? []).map((tool) => tool.name),
        );
        return { content: "completed", toolCalls: [] };
      },
    },
    tools,
    tasks,
    workspaceProvider: fakeWorkspaceProvider(),
    workingDirectory: "/workspace",
    sessionId: "reviewed-plan-team",
    toolScopeCeiling: ["filesystem", "search"],
    reviewedToolScopes: {
      planFingerprint: fingerprintCollaborationTaskGraph(tasks),
      scopesByTaskIndex: [["filesystem"], ["search"]],
    },
  });

  assert.equal(result.status, "review");
  assert.deepEqual(scopesSeenByTask.get("planner-id-one"), ["filesystem"]);
  assert.deepEqual(scopesSeenByTask.get("planner-id-two"), ["search"]);
});

test("reviewed plan mismatch and ceiling widening fail before workspace creation", () => {
  const tools = new AgentToolRegistry();
  for (const name of ["filesystem", "shell"]) {
    tools.register({
      name,
      description: `${name} test tool.`,
      async execute() {
        return { ok: true };
      },
    });
  }
  const tasks: readonly CollaborationTask[] = [
    { id: "reviewed", title: "Reviewed", instructions: "Keep this exact instruction." },
  ];
  let workspaceCreates = 0;
  const common = {
    model: modelThatFinishes(),
    tools,
    prompt: "review binding",
    tasks,
    workspaceProvider: fakeWorkspaceProvider({
      onCreate: () => {
        workspaceCreates += 1;
      },
    }),
    workingDirectory: "/workspace",
    sessionId: "review-binding-team",
    toolScopeCeiling: ["filesystem"],
  } as const;

  assert.throws(
    () => createCollaborativeExecution({
      ...common,
      reviewedToolScopes: {
        planFingerprint: fingerprintCollaborationTaskGraph([
          { ...tasks[0]!, instructions: "Different task instructions." },
        ]),
        scopesByTaskIndex: [["filesystem"]],
      },
    }),
    /do not match the normalized collaboration plan/u,
  );
  assert.throws(
    () => createCollaborativeExecution({
      ...common,
      reviewedToolScopes: {
        planFingerprint: fingerprintCollaborationTaskGraph(tasks),
        scopesByTaskIndex: [["shell"]],
      },
    }),
    /exceeds the configured global ceiling/u,
  );
  assert.throws(
    () => createCollaborativeExecution({
      ...common,
      reviewedToolScopes: {
        planFingerprint: fingerprintCollaborationTaskGraph(tasks),
        scopesByTaskIndex: [],
      },
    }),
    /do not cover the complete collaboration plan/u,
  );
  const sparseScopes = new Array<readonly string[]>(1);
  assert.throws(
    () => createCollaborativeExecution({
      ...common,
      reviewedToolScopes: {
        planFingerprint: fingerprintCollaborationTaskGraph(tasks),
        scopesByTaskIndex: sparseScopes,
      },
    }),
    /missing ordered task slot 1/u,
  );
  assert.equal(workspaceCreates, 0);
});

test("collaborative workers inherit bounded sandbox profiles and expansion decisions", async () => {
  const capturedContexts: ToolExecutionContext[] = [];
  const expansionRequests: Array<{
    readonly workingDirectory: string;
    readonly profile: { readonly name: string; readonly network?: string };
  }> = [];
  const tools = new AgentToolRegistry();
  tools.register({
    name: "network-tool",
    description: "Uses the worker's sandbox profile.",
    metadata: { risk: "read-only", confirmation: "never" },
    async execute(_input, context) {
      assert.ok(context);
      capturedContexts.push({ ...context });
      if (context.sandbox?.network !== "enabled") {
        throw Object.assign(new Error("network access denied"), {
          code: "SANDBOX_DENIED",
          capability: "network",
        });
      }
      return { ok: true };
    },
  });

  let modelCalls = 0;
  const result = await runCollaborativeExecution("fetch a resource", {
    model: {
      id: "openai",
      model: "test-model",
      async chat() {
        modelCalls += 1;
        return modelCalls === 1
          ? {
              content: "",
              toolCalls: [{ id: "call-network", name: "network-tool", input: {} }],
            }
          : { content: "completed", toolCalls: [] };
      },
    },
    tools,
    workingDirectory: "/workspace",
    sessionId: "sandbox-team",
    tasks: [{ id: "network", title: "Network task", instructions: "fetch a resource" }],
    workspaceProvider: fakeWorkspaceProvider(),
    toolSandboxProfile: (_toolName, context) => ({
      name: "worker-restricted",
      network: "disabled",
      writablePaths: [context.workingDirectory],
    }),
    onSandboxExpansion: (request) => {
      expansionRequests.push({
        workingDirectory: request.workingDirectory,
        profile: request.profile,
      });
      return {
        decision: "allow",
        profile: {
          ...request.profile,
          name: "worker-restricted+network",
          network: "enabled",
        },
      };
    },
  });

  assert.equal(result.status, "review");
  assert.equal(result.tasks[0]?.status, "completed");
  assert.equal(modelCalls, 2);
  assert.equal(capturedContexts.length, 2);
  assert.deepEqual(
    capturedContexts.map(({ workingDirectory, sandbox }) => ({
      workingDirectory,
      name: sandbox?.name,
      network: sandbox?.network,
      writablePaths: sandbox?.writablePaths,
    })),
    [
      {
        workingDirectory: "/tmp/network",
        name: "worker-restricted",
        network: "disabled",
        writablePaths: ["/tmp/network"],
      },
      {
        workingDirectory: "/tmp/network",
        name: "worker-restricted+network",
        network: "enabled",
        writablePaths: ["/tmp/network"],
      },
    ],
  );
  assert.deepEqual(expansionRequests, [
    {
      workingDirectory: "/tmp/network",
      profile: {
        name: "worker-restricted",
        network: "disabled",
        writablePaths: ["/tmp/network"],
      },
    },
  ]);
});

test("runs ready tasks in parallel and unlocks dependents after completion", async () => {
  let active = 0;
  let peak = 0;
  const events: CollaborationExecutionEvent[] = [];
  const result = await runCollaborativeExecution("ship feature", {
    model: modelThatFinishes(),
    workingDirectory: "/workspace",
    sessionId: "team-test",
    tasks: [
      { id: "api", title: "API", instructions: "implement API" },
      { id: "ui", title: "UI", instructions: "implement UI" },
      {
        id: "test",
        title: "Tests",
        instructions: "test both",
        dependsOn: ["api", "ui"],
      },
    ],
    workspaceProvider: fakeWorkspaceProvider({
      onCreate: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
    }),
    maxParallel: 2,
    onEvent: (event) => events.push(event),
  });

  assert.equal(peak <= 2, true);
  assert.deepEqual(
    result.tasks.map((task) => task.status),
    ["completed", "completed", "completed"],
  );
  assert.ok(
    events.findIndex((event) => event.type === "task.started" && event.taskId === "test") >
      events.findIndex((event) => event.type === "task.completed" && event.taskId === "api"),
  );
  assert.equal(result.review.mergeable, true);
});

test("retries one failed task without rerunning completed siblings", async () => {
  const calls = new Map<string, number>();
  const disposed: string[] = [];
  const result = await runCollaborativeExecution("retry one task", {
    model: {
      id: "openai",
      model: "test-model",
      async chat(messages) {
        const task = messages
          .find((message) => message.role === "user")
          ?.content.match(/TASK ID: ([^\n]+)/)?.[1] ?? "unknown";
        const count = (calls.get(task) ?? 0) + 1;
        calls.set(task, count);
        if (task === "unstable" && count === 1) {
          throw new Error("temporary provider failure");
        }
        return { content: `completed ${task}`, toolCalls: [] };
      },
    },
    workingDirectory: "/workspace",
    sessionId: "retry-test",
    tasks: [
      { id: "stable", title: "Stable", instructions: "finish once" },
      {
        id: "unstable",
        title: "Unstable",
        instructions: "retry once",
        maxAttempts: 2,
      },
    ],
    workspaceProvider: fakeWorkspaceProvider({
      onDispose: (workspace) => {
        disposed.push(workspace.id);
      },
    }),
    maxParallel: 2,
  });

  assert.equal(result.status, "review");
  assert.equal(result.tasks.every((task) => task.status === "completed"), true);
  assert.equal(calls.get("stable"), 1);
  assert.equal(calls.get("unstable"), 2);
  assert.deepEqual(disposed, ["workspace-unstable"]);
});

test("cancels one task and blocks only its dependents", async () => {
  let handle!: ReturnType<typeof createCollaborativeExecution>;
  let slowStarted = false;
  const resultPromise = (handle = createCollaborativeExecution({
    prompt: "cancel one worker",
    model: {
      id: "openai",
      model: "test-model",
      async chat(messages, options) {
        const task = messages
          .find((message) => message.role === "user")
          ?.content.match(/TASK ID: ([^\n]+)/)?.[1] ?? "unknown";
        if (task === "slow") {
          slowStarted = true;
          return new Promise((resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason ?? new Error("cancelled")),
              { once: true },
            );
            options?.signal?.aborted && reject(options.signal.reason);
          });
        }
        return { content: `completed ${task}`, toolCalls: [] };
      },
    },
    workingDirectory: "/workspace",
    sessionId: "cancel-test",
    tasks: [
      { id: "slow", title: "Slow", instructions: "wait" },
      { id: "fast", title: "Fast", instructions: "finish" },
      {
        id: "dependent",
        title: "Dependent",
        instructions: "only after slow",
        dependsOn: ["slow"],
      },
    ],
    workspaceProvider: fakeWorkspaceProvider(),
    maxParallel: 2,
  })).promise;

  for (let attempt = 0; attempt < 50 && !slowStarted; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(slowStarted, true);
  assert.equal(handle.cancelTask("slow", "user stopped this worker"), true);

  const result = await resultPromise;
  const byId = new Map(result.tasks.map((task) => [task.id, task]));
  assert.equal(byId.get("slow")?.status, "cancelled");
  assert.equal(byId.get("fast")?.status, "completed");
  assert.equal(byId.get("dependent")?.status, "blocked");
  assert.equal(result.review.mergeable, false);
});

test("cancelling a queued task never creates its workspace", async () => {
  let handle!: ReturnType<typeof createCollaborativeExecution>;
  let firstStarted = false;
  const created: string[] = [];
  const resultPromise = (handle = createCollaborativeExecution({
    prompt: "cancel queued work",
    model: {
      id: "openai",
      model: "test-model",
      async chat(_messages, options) {
        firstStarted = true;
        return new Promise((resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason ?? new Error("cancelled")),
            { once: true },
          );
        });
      },
    },
    workingDirectory: "/workspace",
    sessionId: "queued-cancel-test",
    tasks: [
      { id: "first", title: "First", instructions: "wait" },
      { id: "queued", title: "Queued", instructions: "must not start" },
    ],
    workspaceProvider: fakeWorkspaceProvider({
      onCreate: (task) => {
        created.push(task.id);
      },
    }),
    maxParallel: 1,
  })).promise;

  for (let attempt = 0; attempt < 50 && !firstStarted; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(firstStarted, true);
  assert.equal(handle.cancelTask("queued", "user skipped queued task"), true);
  assert.equal(handle.cancelTask("first", "stop active task"), true);

  const result = await resultPromise;
  assert.deepEqual(created, ["first"]);
  assert.equal(result.tasks.find((task) => task.id === "queued")?.status, "cancelled");
});
