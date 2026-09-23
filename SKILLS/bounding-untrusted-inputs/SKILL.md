---
name: bounding-untrusted-inputs
description: Use when reading, listing, indexing, downloading, decompressing, or persisting data whose size, entry count, nesting, or arrival time is not bounded, especially when cancellation or partial failure could corrupt previously valid state.
---

# Bounding Untrusted Inputs

## Overview

Resource limits are correctness. Avoid unbounded allocation, partial
replacement, leaked locks, and unrecoverable cancellation.

Use this for resource/state boundaries. Use
`producing-safe-runtime-diagnostics` for error projection.

## Core Pattern

1. **Name every bound before coding.** Set limits for bytes, entries, depth,
   decompressed output, workers, and time; keep separate caps when one
   resource expands another. If no limit is justified by protocol, workload,
   or policy, mark it unknown and identify the owner; do not invent a magic
   number.
2. **Reject before retaining.** Inspect file metadata before reading; count
   stream bytes while consuming and stop at the limit. Never trust
   `Content-Length` alone. Cap directory enumeration and archive expansion
   before building collections.
3. **Commit only complete results.** Write to a unique temporary target,
   validate it, then atomically replace the previous target. Failed or
   cancelled refreshes must leave the last valid state intact.
4. **Make failure recoverable.** Return a stable typed error or result,
   terminate the producer, remove temporary files, release locks, and reap
   child work so retry needs no manual cleanup.
5. **Preserve existing contracts.** Keep successful small inputs, output
   formats, ordering, and limits compatible. Never silently truncate an
   over-limit result.

## Acceptance Matrix

| Case | Required proof |
|---|---|
| Just below the limit | Succeeds with normal output |
| Exactly at the limit | Uses the documented inclusive/exclusive rule |
| Just above the limit | Stops before full retention or parsing |
| Unknown length or expansion | Streaming/expanded cap still holds |
| Cancellation or write failure | Previous valid state remains; cleanup completes |
| Retry after failure | No stale lock/temp file prevents recovery |
| Small valid input | No accidental blanket rejection |
| No justified limit | Unknown is reported instead of guessed |

## Example

For a generated index or cache:

```ts
import { randomUUID } from "node:crypto";
import { rm, rename, writeFile } from "node:fs/promises";

const MAX_INDEX_BYTES = 16 * 1024 * 1024;

async function replaceIndex(target: string, payload: string) {
  if (Buffer.byteLength(payload, "utf8") > MAX_INDEX_BYTES) {
    throw new Error("INDEX_TOO_LARGE");
  }
  JSON.parse(payload);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, payload, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
```

For incoming data, enforce the read or expansion cap during consumption.

## Common Mistakes

- Checking size only after `readFile`, buffering the input first.
- Treating a compressed or encoded size as the expanded-size bound.
- Replacing the live cache before validation finishes.
- Returning a partial index/list and calling it a successful refresh.
- Aborting work without releasing the lifecycle lock or removing its temp file.
- Applying a new cap without testing the documented successful boundary.

**REQUIRED BACKGROUND:** Use `superpowers:test-driven-development` when
changing the implementation.
