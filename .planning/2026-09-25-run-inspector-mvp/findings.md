# Findings

- The backend already exposes metadata-only runs and spans through `/trace`; no new server endpoint is required for the MVP.
- Tool names, statuses, timestamps, capabilities, and authorization results are already bounded and sanitized upstream.
- The new UI keeps prompt, tool input/output, paths, URLs, and raw errors out of the rendered Run Inspector.
