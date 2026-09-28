# Findings

- v1 is intentionally local-source only; there is no network fetch or arbitrary package execution.
- Install copies only a bounded `SKILL.md` and records version/disabled metadata in a private state file.
- Disable renames the file to `SKILL.md.disabled`, so the existing bounded SkillRegistry ignores it while preserving content.
- Marketplace mutation messages expose permission labels but not source absolute paths.
