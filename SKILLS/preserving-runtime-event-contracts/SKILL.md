---
name: preserving-runtime-event-contracts
description: Use when adding or changing runtime events, cancellation state, SSE or JSON streams, framed IPC, or messages consumed across desktop, CLI, MCP, or Rust boundaries.
---

# Preserving Runtime Event Contracts

Treat a runtime event change as a producer-to-consumer contract change, not a provider callback or UI-only feature.

## Contract-first workflow

1. **Inventory before naming fields.** Read the existing shared event type/schema, producer mapping, serializers, consumer decoders, and any allowlists. Record each field with its source and exact spelling.
2. **Apply the schema-evidence gate.** A payload example or field-level contract may be written only after its source was inspected. If source access is unavailable, report only what the request explicitly guarantees; put field names, casing, identifiers, and lifecycle semantics under **Unknown—inspect**. Give ownership areas, not guessed JSON, “suggested” fields, or filenames. Calling a guess an example does not make it verified.
3. **Define the lifecycle from existing state.** Establish which state transition emits the event, its correlation identifiers, ordering, terminal/resume behavior, and which nearby outcomes must not emit it. Preserve established envelope, casing, and compatibility conventions.
4. **Trace actual paths.** Map provider → canonical core event → each transport → reducer/consumer. Include every explicitly required surface, such as desktop SSE and CLI `--json`. Include MCP or Rust framed IPC only when tracing shows the event crosses that boundary; otherwise record the evidence that it is out of path.
5. **Implement one vertical slice.** Normalize provider-specific signals at the boundary, emit from the state owner, and have consumers react to the canonical event. Avoid parallel UI-only or transport-specific meanings.
6. **Prove each changed boundary.** Cover producer semantics and duplicate/race cases, serialization and decoding with the established envelope, every required consumer, and frame round-trips when IPC is used. A provider unit test or UI snapshot alone does not prove delivery. Update protocol documentation when the public contract changes.

## Required planning table

| Boundary | Existing contract source | Path verified? | Change and proof |
|---|---|---|---|
| Provider → core | Type/schema and mapping | Yes / no | Normalization test |
| Core → required transports | Event union and serializers | Yes / no | Contract/serialization test |
| Transport → consumer | Decoder/reducer | Yes / no | Consumer integration test |
| MCP / Rust IPC | Adapter or frame schema | Yes / no / not on path | Forwarding or round-trip proof |

Use **unknown / inspect** for unavailable evidence. A feature request describes desired behavior; it does not establish the current payload shape.

When the target checkout or schema cannot be read, the plan’s contract section must say: **“Exact payload fields and lifecycle semantics: unverified; inspect the existing event schema and state owner before proposing them.”** Do not add a “proposed payload” example in that case.

**REQUIRED BACKGROUND:** Use superpowers:test-driven-development when implementing the change.
