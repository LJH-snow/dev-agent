import {
  type AgentTaskExecutionContext,
  type AgentTaskScheduler,
} from "@dev-agent/agent-core";

export interface InteractiveTaskStatusBridge {
  readonly current?: AgentTaskExecutionContext["setStatus"];
  set: (setter?: AgentTaskExecutionContext["setStatus"]) => void;
  waiting: (detail?: string) => void;
  running: () => void;
}

export function createTaskStatusBridge(): InteractiveTaskStatusBridge {
  let current: AgentTaskExecutionContext["setStatus"] | undefined;
  return {
    get current() {
      return current;
    },
    set(value) {
      current = value;
    },
    waiting(detail) {
      current?.("waiting-for-confirmation", detail ?? "approval pending");
    },
    running() {
      current?.("running", "confirmation resolved");
    },
  };
}

export function scheduleInteractiveTask<T>(
  scheduler: AgentTaskScheduler,
  bridge: InteractiveTaskStatusBridge,
  runner: (context: AgentTaskExecutionContext) => Promise<T> | T,
): Promise<T> {
  return scheduler.schedule({
    run: async (context) => {
      const { setStatus } = context;
      bridge.set(setStatus);
      try {
        return await runner(context);
      } finally {
        if (bridge.current === setStatus) {
          bridge.set(undefined);
        }
      }
    },
  });
}
