---
name: verifying-distribution-boundaries
description: Use when adding or changing dependencies, workspace packages, entry points, or build steps for a CLI or app that will be bundled, installed, or published outside its monorepo.
---

# Verifying Distribution Boundaries

## Overview

“Builds in the workspace” and “runs after installation” are different
contracts. Verify the artifact that users receive, not only source imports or
workspace-linked tests.

## Core Pattern

1. **Name each deliverable.** Separate workspace development, the compiled
   bundle, the packed archive, a clean install, and the installed entrypoint.
   Record which command and directory prove each one.
2. **Classify dependencies.** For every import, decide whether it is bundled
   at build time, an external runtime dependency, a peer, or optional. A
   private workspace package or `workspace:*` reference must not remain
   unresolved in a published runtime manifest unless the distribution
   contract explicitly supports it. If the bundler includes it, keep it a
   build input rather than adding an unresolvable runtime dependency.
3. **Close manifest and lockfile together.** Confirm the lockfile resolves
   every declared runtime and peer dependency for the packaged shape. Do not
   treat a successful workspace link or a lockfile-only update as proof that a
   clean install can resolve the artifact.
4. **Write the artifact smoke first.** Pack or assemble the distributable
   output in a temporary directory, install it without workspace links, invoke
   the real entrypoint, and assert the expected exit status and output.
   Inspect the packed manifest for workspace protocols, private package names,
   missing peers, and accidental source-only imports.
5. **Verify every boundary.** Run the workspace build, package smoke, clean
   install, runtime import, and relevant peer/optional-dependency cases. A
   source test passing while the packed artifact fails is a distribution failure,
   not a test-environment detail.
6. **Preserve output contracts.** Confirm normal stdout remains parseable,
   diagnostics stay on stderr when required, commands and exit codes remain
   compatible, and the package works outside the repository.

## Acceptance Matrix

| Boundary | Required proof |
|---|---|
| Workspace build | Typecheck and build succeed |
| Packed artifact | Archive contains the intended files and manifest |
| Manifest/lockfile | Declared runtime and peer dependencies resolve together |
| Clean install | No workspace symlink or local package is required |
| Runtime launch | Real entrypoint resolves all required imports |
| Peer/optional dependency | Declared behavior is tested when present and absent |
| CLI streams | stdout/stderr and exit status preserve their contracts |

## Common Mistakes

- Treating a monorepo symlink as proof of a publishable package.
- Putting a private `workspace:*` package in runtime dependencies of a
  single-file bundle.
- Checking only the source manifest and never inspecting the packed manifest.
- Running a package smoke inside the workspace so hidden links satisfy imports.
- Declaring success from a build while the installed entrypoint was never run.

**REQUIRED BACKGROUND:** Use
`superpowers:test-driven-development` when changing package or build behavior.
