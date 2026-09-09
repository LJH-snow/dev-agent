# Docs

Architecture, design decisions, and module documentation will live here as the
project grows. Start with `../README.md` for the current project overview.

Sandbox, filesystem, and network policies are implemented in **Starlark** and
evaluated by the Rust runtime. The macOS backend enforces them with
`sandbox-exec`. See `../runtime/rust/README.md` for the current policy model and
the planned Linux backend.
