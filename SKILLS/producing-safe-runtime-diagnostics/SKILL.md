---
name: producing-safe-runtime-diagnostics
description: Use when exposing provider, MCP, tool, or subprocess failures through CLI/UI output, logs, telemetry, or support exports.
---

# Producing Safe Runtime Diagnostics

Error details create a second data-egress path. Treat provider messages, tool output, subprocess streams, and nested exception objects as untrusted input.

## Safe-diagnostic workflow

1. **Map the path.** Identify the source, every parse/buffer step, and every sink: JSON stdout, human terminal output, stderr, logs, telemetry, and support exports. Preserve each sink’s existing format contract.
2. **Establish the report schema.** Derive fields and exact spelling from an existing contract or an approved design. For each field, record provenance, validation/normalization, and why support needs it. If no schema is available, mark fields **unknown**; do not invent a sample payload, request ID, server label, status field, or fixed output size.
3. **Bound input before parsing.** Enforce byte limits while reading, before retaining or parsing the full response. Choose limits from protocol constraints and legitimate workload evidence; use the same effective limit across connected runtimes. On overflow, stop, clean up the operation, and return a fixed typed error—never parse or emit a truncated raw body.
4. **Project through an allowlist.** Build a new typed diagnostic record from approved fields; never spread or serialize an upstream error object. Prefer a normalized category and fixed human message. Exclude credentials, environment values, raw provider text, bodies, headers, arguments, URLs, local paths, stack/cause chains, and hidden reasoning unless a reviewed contract explicitly permits a safe derived value. Post-serialization regex redaction is not the boundary.
5. **Keep output safe and parseable.** Neutralize terminal control sequences in human-facing output. In `--json` mode, stdout contains only the established structured format; raw errors do not leak through stderr, logs, or telemetry.

## Acceptance checks

- Seed nested error fields with fake credential canaries, absolute paths, provider text, and ANSI/OSC control sequences. Assert none reach any captured sink.
- Verify the output has only contract-approved fields and stays within a justified output bound; confirm JSON remains parseable and free of incidental text.
- Test malformed, deeply nested, truncated, and oversized responses. Check byte limits just below, at, and above the cap; confirm over-limit data is rejected before full buffering/parsing and cleanup completes.
- Confirm successful calls and existing human/JSON modes remain compatible.

**REQUIRED BACKGROUND:** Use superpowers:test-driven-development when implementing or changing diagnostic behavior.
