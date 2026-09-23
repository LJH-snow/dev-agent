import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const controller = await readFile(new URL("../public/task-workspace-ui.js", import.meta.url), "utf8");

test("Desktop exposes an isolated task action and bilingual worktree inspector contract", () => {
  assert.match(html, /id="new-task"[^>]*data-i18n-title="session\.newTaskTitle"/);
  assert.match(html, /id="task-workspace-panel"/);
  assert.match(html, /id="task-workspace-list"/);
  assert.match(html, /id="task-workspace-diff-tabs"[^>]*role="tablist"/);
  assert.match(html, /id="task-workspace-comments-panel"/);
  assert.match(html, /id="task-workspace-comments-list"/);
  assert.match(html, /id="task-workspace-insert-comments"/);
  assert.match(html, /id="task-workspace-branch"/);
  assert.match(html, /id="task-workspace-directory"/);
  assert.match(html, /id="task-workspace-state"/);
  assert.match(html, /id="task-workspace-changes"/);
  assert.match(html, /id="task-workspace-compare"/);
  assert.match(html, /id="task-workspace-merge"/);
  assert.match(html, /id="task-workspace-cleanup"/);
  assert.match(html, /"workspace\.title": "Task workspaces"/);
  assert.match(html, /"workspace\.title": "任务工作区"/);
  assert.match(html, /createTaskWorkspaceUI\(/);
  assert.match(styles, /\.task-workspace-card\s*\{/);
  assert.match(styles, /\.task-workspace-diff\s*\{/);
  assert.match(styles, /\.task-workspace-diff-line\.is-addition/);
  assert.match(styles, /\.task-workspace-comments-panel/);
});

test("task worktree actions use the bounded API and confirm merge or cleanup", () => {
  assert.match(controller, /compareButton\.addEventListener\("click", \(\) => void compare\(\)\)/);
  assert.match(controller, /fetcher\("\/api\/workspaces"/);
  assert.match(controller, /method: "POST"[\s\S]*body: JSON\.stringify\(\{\}\)/);
  assert.match(controller, /\/api\/workspaces\/\$\{encodeURIComponent\(workspace\.sessionId\)\}\/diff\$\{query\}/);
  assert.match(controller, /\?path=\$\{encodeURIComponent\(path\)\}/);
  assert.match(controller, /workspace\.diff\.\$\{section\.group\}/);
  assert.match(html, /"workspace\.diff\.staged": "Staged"/);
  assert.match(html, /"workspace\.diff\.unstaged": "Unstaged"/);
  assert.match(controller, /setAttribute\("aria-selected"/);
  assert.match(controller, /\/api\/workspaces\/\$\{encodeURIComponent\(workspace\.sessionId\)\}\/merge/);
  assert.match(controller, /confirmAction\(translate\("workspace\.confirm\.merge"/);
  assert.match(controller, /confirmAction\(translate\("workspace\.confirm\.cleanup"/);
  assert.match(controller, /\/api\/workspaces\/\$\{encodeURIComponent\(workspace\.sessionId\)\}.*method: "DELETE"/);
  assert.match(controller, /mergeButton\.disabled = !workspace \|\| workspace\.dirty/);
  assert.match(controller, /cleanupButton\.disabled = !workspace \|\| workspace\.dirty/);
  assert.doesNotMatch(controller, /\.innerHTML\s*=/, "Git paths and diffs must not enter an HTML parser");
  assert.match(controller, /renderPatch\(selectedWorkspace\(\), activeChoice\.group, activeChoice\.diff\)/);
  assert.match(controller, /textContent = file\.path/);
});
