Build a local web app called "Aeon Worker Cockpit".

Goal:
A real visual progress dashboard for Claude/maniple/claude-team workers so Felix can tell at a glance whether something is actively happening.

Location:
/Users/felixbarth/.openclaw/workspace/apps/worker-cockpit

Tech preference:
- Keep it simple and local-first
- Node or plain static + small local server is fine
- Must be runnable on this Mac without cloud services
- Prioritize working MVP over framework complexity

Core requirements:
1. Show all current claude-team/maniple workers in card/list form
2. Poll live data from `mcporter call claude-team-http.*` or the local HTTP endpoint
3. For each worker show:
   - name
   - status
   - idle vs active indicator
   - created time
   - last activity
   - project/worktree path
   - badge/task
   - last assistant preview if available
   - message count if available
4. Show a top summary bar:
   - total workers
   - active
   - idle
   - stuck warning if no activity threshold exceeded
5. Include a recent events panel if possible using worker_events/poll_worker_changes
6. Auto-refresh every few seconds
7. Strong visual design: premium mission-control feel, dark UI, highly legible
8. Include README with run instructions

Nice-to-have if easy:
- click a worker to expand details
- button to refresh immediately
- simple status pulse animation
- direct links/copy buttons for worktree paths

Constraints:
- local only
- no auth system needed
- do not build a fake mockup only; it should actually read live data
- keep implementation understandable and maintainable

You may create whatever files are needed. Make it runnable.
When finished, print:
- what stack you chose
- how to run it
- what live data sources it uses
