## [LRN-20260930-001] shared-worktree-parallel-window-check

**Priority**: high
**Status**: pending
**Area**: tools
**Source**: user_feedback, best_practice

### 内容
共享工作区中其他窗口可能在任意时刻写入同一功能的 source/test；即使刚开始检查时工作区干净，也不能把后续出现的同文件改动当成本窗口所有。发现重叠后必须停止该切片，精确撤回自己新增的块，保留并行改动，并改选不冲突的文件范围。

### 建议修复
每次写入前后都重新检查 `git status --short` 和目标文件 diff；提交前只用路径精确 `git add`，并检查 staged 文件列表。若同一文件出现并行变化，不做 broad restore/reset/clean，先放弃重复切片或等待其完成。
