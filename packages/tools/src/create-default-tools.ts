import { LocalExecutor, type Executor } from "@dev-agent/executor";

import { CodeSearchTool } from "./code-search.js";
import { FilesystemTool } from "./filesystem.js";
import { GitTool } from "./git.js";
import { SearchTool } from "./search.js";
import { ShellTool } from "./shell.js";
import type { Tool } from "./index.js";

export function createDefaultTools(executor: Executor = new LocalExecutor()): Tool[] {
  return [
    new CodeSearchTool(),
    new FilesystemTool(),
    new ShellTool(executor),
    new GitTool(executor),
    new SearchTool(executor),
  ];
}
