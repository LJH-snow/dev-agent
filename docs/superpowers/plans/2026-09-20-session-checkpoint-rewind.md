# Session Checkpoint Rewind

## Goal

Extend the existing FileMemory checkpoint scaffold with a safe conversation-history
rewind that follows the Gemini CLI architecture study without introducing
cross-process filesystem undo.

## Safety boundary

- `restore()` remains metadata-only and never mutates memory or the workspace.
- `rewind()` truncates only persisted conversation entries at a validated
  checkpoint anchor.
- Rewind never calls `FilesystemTool`, restores before-images, removes files, or
  changes applied/rolled-back change-set evidence.
- A stale, foreign-session, or mismatched entry anchor fails closed.
- Checkpoints created after the rewind target are discarded because they no
  longer describe the current conversation history.

## Implementation

1. Add a typed `CheckpointRewindResult` and a `rewind()` operation to the core
   checkpoint store.
2. Add memory-level anchor validation and truncation for `InMemoryMemory` and
   `FileMemory`; clear summaries that cover discarded entries and preserve
   usage/evidence metadata.
3. Add `:checkpoint`, `:checkpoints`, and `:rewind <id>` plus slash aliases to
   both ANSI and Ink interactive command adapters.
4. Render bounded checkpoint rows and an explicit “workspace unchanged” notice
   without exposing file paths or executable evidence.
5. Add core and CLI regression tests for persistence, stale anchors, session
   isolation, command output, and both interactive renderers.
6. Update the task plan and progress record, then run focused tests, the full
   TypeScript gate, behavior evaluations, and `git diff --check`.

## Acceptance

- Rewinding removes only entries after the selected checkpoint.
- Reopening the memory file observes the rewound conversation.
- Applied change-set records and workspace bytes are unchanged.
- `restore()` remains backward compatible and side-effect free.
- Unknown or stale checkpoint ids produce a bounded user-facing error.
- No package publish, tag, release, or network release is performed.
