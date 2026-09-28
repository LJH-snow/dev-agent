# Findings

- The first version deliberately does not run `git`, shell commands, or automatic remediation.
- Scan roots are bounded by file count, bytes, and per-file size; common generated/dependency trees are skipped.
- Finding locations are workspace-relative and secret values are never retained or formatted.
- MCP findings inspect only metadata; environment values and argument contents are not emitted.
