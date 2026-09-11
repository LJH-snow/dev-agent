# @dev-agent/code-intelligence

Code parsing, indexing, symbol extraction, and code search for dev-agent.

Phase 1 now includes:

- `scanTypeScriptSymbols(source, filePath)` using the TypeScript AST. It captures
  functions, classes, interfaces, type aliases, enums, methods, properties,
  variables, and arrow-function variables, with line, column, container, and
  signature metadata.
- `InMemoryCodeIndex` with `addSymbol`, `addSource`, `search`, and
  `searchSymbols`. `searchSymbols` supports optional `limit` and `kinds`
  filters and returns ranked matches with scoring reasons.
- `typeScriptScanner` as a small source-scanner adapter for tool code that wants
  a stable scanner interface.
- `TypeScriptReferenceIndex` built on the TypeScript language service for accurate
  `findReferences(filePath, line, column)` and `findDefinition(filePath, line, column)`
  queries against in-memory source files. It serves virtual files plus real TS lib files
  resolved from the installed `typescript` package.
- `scanPythonSymbols(source, filePath)` for Python functions and classes.
- `scanRustSymbols(source, filePath)` for Rust items: `fn`/`struct`/`enum`/`type`/
  `mod`/`use`/`trait`, with visibility (`pub`, `pub(crate)`, `pub(in path)`) and
  item modifiers (`async`, `unsafe`, `const`, `default`, `extern "C"`) handled.
  Functions inside `impl` and `trait` blocks are reported as `method` symbols
  carrying the container name.
- `scanFile(source, filePath)` dispatches to the right scanner by extension.

Typical usage:

```ts
import { InMemoryCodeIndex } from "@dev-agent/code-intelligence";

const index = new InMemoryCodeIndex();
index.addSource("export function loadAgent() {}", "src/agent.ts");

const matches = index.searchSymbols({ query: "loadAgent", limit: 10 });
```

`InMemoryCodeIndex` also exposes `removeFile(filePath)`, which drops every
symbol recorded for a file. Callers that cache an index across scans use it to
update changed or deleted files without rebuilding the whole index.
