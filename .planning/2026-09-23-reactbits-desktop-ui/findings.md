# Findings — ReactBits desktop UI

## Repository
- Desktop entry: `apps/desktop/src/index.ts`; server serves local `apps/desktop/public` assets.
- Frontend: `apps/desktop/public/index.html` plus `styles.css` and small browser modules. The app is not built with React.
- Native macOS shell embeds the local server frontend; the shared web UI is also usable in a browser.
- Existing inspector includes status, live run timeline, runtime trace, and evidence preview; timeline/trace entries can be generated dynamically.
- Existing worktree has extensive unrelated staged/unstaged/untracked changes. Avoid cleanup or resetting.

## ReactBits / MCP
- The official ReactBits MCP guide at `https://reactbits.dev/get-started/mcp` recommends the shadcn MCP server and an `@react-bits` registry (`https://reactbits.dev/r/{name}.json`).
- The guide's setup expects a React/shadcn project with a `components.json`; this repository has no such config or React dependency, so direct installation is inappropriate for this bounded UI task.
- Selected design: SpotlightCard — cursor-following radial illumination. The official `SpotlightCard-JS-CSS` registry item supplies the radial-gradient/hover interaction; the desktop adaptation uses local CSS and delegated browser pointer events, with theme-aware accent color and keyboard `:focus-within` support. No remote asset/runtime dependency is added.
- Available Codex tools in this session do not expose a ReactBits or Context7 MCP tool. Consulted the official ReactBits guide and registry item directly; do not claim a live MCP tool call.
- An initial guessed registry slug returned the site HTML shell; resolved it using the documented case-sensitive `SpotlightCard-JS-CSS` item name.

## Implementation
- Added `apps/desktop/public/spotlight-cards.js`. One delegated listener on the inspector supports existing and dynamically inserted status/timeline/trace/evidence cards. Coordinates are clamped and rounded to integer percentages; touch pointers clear the effect.
- The effect uses local CSS radial gradients only. JS initialization is skipped for coarse pointers and reduced motion; CSS independently hides the pseudo-element for those settings.
- The enhancement does not fetch network assets, change card dimensions, or touch server/session/model behavior.

## QA inventory
- Claim: inspector cards gain a restrained pointer-following highlight — verify CSS coordinates update under a pointer inside a card and no style changes on pointer leave.
- Claim: cards added dynamically are supported — verify delegated event handling on a dynamically inserted status card.
- Claim: accessibility/compatibility — verify reduced-motion and coarse-pointer settings disable the effect, while desktop card layout and controls remain unchanged.
- Off-happy-path: zero-size/removed target does not throw; leaving the card clears the active state.
