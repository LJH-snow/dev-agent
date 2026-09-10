# @dev-agent/tools

Tool registry and built-in tools such as filesystem, shell, git, and search.

Implemented in phase 1:

- `FilesystemTool` - read, write, list, stat, and mkdir
- `ShellTool` - run local commands through the executor
- `GitTool` - run git commands through the executor
- `SearchTool` - search code with ripgrep
- `CodeSearchTool` - scan TypeScript/JavaScript files and return ranked,
  kind-filterable symbol matches with `score`, `reasons`, `signature`, and
  container metadata
- `createDefaultTools` - creates the default tool set from one executor

Built-in tools accept an optional context object with `sessionId` and
`workingDirectory`. Shell/git/search commands run in that working directory,
and filesystem and code-search paths are resolved relative to it. `code-search`
also accepts `kind` and `limit` inputs to keep agent queries focused.

`CodeSearchTool` caches its scan per root directory in the tool instance. A
repeated search re-reads only the files whose size or mtime changed, drops
deleted files from the index, and exposes `getCacheStats()` (`hits`, `misses`,
`rescanned`) for diagnostics.
