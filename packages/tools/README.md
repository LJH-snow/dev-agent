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

`FilesystemTool` reads, writes, edits, lists, stats, and creates directories.
`read` takes an optional `offset` (1-based) and `limit` (default 2000 lines) and
answers with `{ content, startLine, endLine, totalLines, truncated }`, so large
files can be read in slices. `edit` replaces `oldText` with `newText` only when
that snippet appears exactly once; a missing or ambiguous match is an error the
model can correct instead of a silent mis-edit. The same workspace rules apply
to `edit` as to `write`: the approval policy denies targets outside the working
directory.

Built-in tools accept an optional context object with `sessionId` and
`workingDirectory`. Shell/git/search commands run in that working directory,
and filesystem and code-search paths are resolved relative to it. `code-search`
also accepts `kind` and `limit` inputs to keep agent queries focused.

`CodeSearchTool` caches its scan per root directory in the tool instance. A
repeated search re-reads only the files whose size or mtime changed, drops
deleted files from the index, and exposes `getCacheStats()` (`hits`, `misses`,
`rescanned`) for diagnostics.
