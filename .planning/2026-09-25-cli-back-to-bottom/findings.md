# Findings

- The navigation bar is rendered as ordinary text in `apps/cli/src/ink/app.tsx`.
- `MouseInputParser` currently consumes SGR/X10 mouse reports but discards click coordinates and click actions.
- The viewport mouse effect only consumes `parsed.directions`, so clicking the visible label cannot call `viewportModel.end()`.
- The dynamic shell reserves one navigation row above the status/composer/footer; `baseTranscriptRows = terminalRows - 15` and `visibleTranscriptRows` reserves one more row when a sticky task title exists.
- The composer has a separate mouse parser and must continue to ignore terminal mouse reports.
