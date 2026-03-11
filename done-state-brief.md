Improve Aeon Worker Cockpit again.

Goal:
Add a clearer completed-worker model so workers that finished and are just waiting for review do NOT look broken or vaguely stale.

Requirements:
1. Add a state like `done` or `awaiting-review`.
2. Prefer event-aware logic using worker events + idle transitions.
3. A good rule of thumb:
   - if a worker had a worker_idle event and has no newer worker_active event, classify as done/awaiting-review unless there is strong evidence it is blocked/stale
   - reserve stale for workers that appear abandoned/uncertain, not simply quiet after completion
4. Update summary cards and worker cards accordingly.
5. Improve wording and colors to make the distinction obvious.
6. Update README briefly.

Keep the local simple architecture.
When finished, print a concise summary.
