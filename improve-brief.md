Improve the existing Aeon Worker Cockpit app in this directory.

Goals for this pass:
1. Better worker-state logic:
   - distinguish active / idle / stale / closed-ish more accurately
   - if worker_events or examine data suggests idle, reflect that well
   - avoid misleading “stuck” labels when a worker simply finished recently
2. Add worker actions from the UI if feasible through server endpoints:
   - refresh now
   - inspect details
   - copy worktree path
   - close worker
   - optionally send a short message to a worker
3. Add Obsidian/session integration if feasible:
   - show whether a likely Obsidian session note exists for the worker name/date
   - if not exact, at least provide a link target pattern or helper section
4. Improve the mission-control feel:
   - stronger hierarchy
   - clearer status colors
   - more legible event stream
   - better detail panel
5. Keep it local, dependency-light, and actually runnable.

Constraints:
- Maintain the existing simple Node server architecture if possible.
- No big framework migration.
- Keep code understandable.
- Update README with the new capabilities.

When finished, print a concise summary of improvements.
