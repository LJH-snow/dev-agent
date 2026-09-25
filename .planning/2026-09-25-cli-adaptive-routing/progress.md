# Progress

- RED: added routing/budget unit tests and observed expected missing-module failures.
- GREEN: implemented `apps/cli/src/model-routing.ts` and `apps/cli/src/model-budget.ts`.
- Added routing config validation and CLI config typing.
- Integrated automatic routing, manual `:mode` override, `:route`, and `:budget` into readline and Ink.
- Added fake-provider CLI integration coverage for greeting routing and manual override.
- Verification: CLI build, test compilation, 17 routing/budget tests, config validation tests, Ink tests, and existing auto-fix/GitHub/project-memory focused tests pass serially.
- Remaining: selective commit, then continue to Security Center and Skill Marketplace.
