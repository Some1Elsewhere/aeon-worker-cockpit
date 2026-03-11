# Command Center — Claude Usage Provider

## Objective

Keep the Claude Code usage badge in the Worker Cockpit header working reliably.
The badge shows session and weekly utilization so you know at a glance whether a Claude worker is near its limit. It must degrade gracefully when the API is rate-limited or credentials are unavailable — not make the dashboard useless.

---

## How It Works

```
macOS Keychain
  └── "Claude Code-credentials" (JSON)
        └── accessToken
              └── GET https://api.anthropic.com/api/oauth/usage
                    └── plugins/claude-usage.js (in-process cache, 60s TTL)
                          └── GET /api/claude-usage (server.js route)
                                └── frontend badge (public/app.js)
```

**Key files:**

| File | Role |
|------|------|
| `plugins/claude-usage.js` | Provider: reads keychain, fetches API, caches result |
| `server.js` (route `/api/claude-usage`) | Serves provider output; always returns 200 |
| `public/app.js` (poll loop) | Fetches `/api/claude-usage` every poll cycle; renders badge |

**Poll cadence:** The frontend polls all API routes on the same interval (see `poll()` in `app.js`). The provider uses a 60-second in-memory cache, so actual Anthropic API calls happen at most once per minute regardless of how fast the frontend polls.

---

## Known Issue: HTTP 429 from Anthropic

**Symptom:** `/api/claude-usage` returns `{ error: "Usage API returned HTTP 429", status: "stale" }` or similar. Badge shows `--`.

**Suspected causes (investigate, do not guess):**

1. The in-memory cache resets on every server restart. If the server restarts frequently (dev mode, crashes), the 60s "at most once per minute" guarantee breaks — each restart triggers a fresh fetch.
2. The Anthropic usage endpoint may have a tighter per-token rate limit than 1 req/min. Evidence needed.
3. The OAuth token may be shared with other tooling (e.g. Claude CLI itself) also hitting the same endpoint. Check whether the same credentials are used elsewhere.

**Current behavior on 429:**
- If a valid stale cache exists → returns `{ ..._cache, status: "stale" }` — badge still shows last known data.
- If no cache exists (first fetch after restart) → throws → server returns `{ error: "...", status: "error" }` → badge shows `--`.

**Mitigation options for the Fixer to evaluate:**

- Extend cache TTL on 429 response (e.g. backoff to 5 min) rather than simply throwing.
- Persist cache to a file so restarts don't lose it. Weigh the complexity cost — the project is intentionally zero-dependency.
- Add exponential backoff so repeated 429s don't hammer the API.
- Add a `?refresh=1` query param to force a fresh fetch from the UI when needed.

---

## Edge Cases

| Situation | Expected Behavior |
|-----------|------------------|
| Keychain entry missing | Returns `{ error: "Claude Code credentials not found in keychain", status: "error" }`. Badge shows `--`. |
| OAuth token expired | Returns stale cache if available; else `{ error: "OAuth token expired...", status: "error" }`. User must re-run `claude /login`. |
| Anthropic API timeout (>10s) | Returns stale cache if available; else throws. |
| Anthropic API 429 | Returns stale cache if available; else `status: "error"`. See above. |
| Anthropic API changes response shape | Parse defensively. Log unknown fields. Return partial data rather than crashing. |
| Non-macOS host (Linux CI) | `security` exec fails. Provider should catch and return `{ status: "unavailable" }`. Badge shows `--`. Does not crash the server. |
| Server restart | In-memory cache cleared. First fetch after restart hits the API. |

---

## Testing

Run the deterministic test script to verify the provider in isolation (no server required):

```bash
node execution/test-claude-usage-provider.js
```

Run the health check to verify the full stack is reachable:

```bash
bash execution/check-command-center-health.sh
```

See those files for what they check and what output to expect.

---

## Self-Correction Loop

When the provider breaks:

1. Run `node execution/test-claude-usage-provider.js` — it will tell you which layer failed (keychain, API, parsing).
2. Fix the failing layer in `plugins/claude-usage.js`.
3. Re-run the test script to confirm it passes.
4. If you discovered a new constraint (e.g. tighter rate limit, changed API shape), update this directive.
5. Update `REVIEW_NOTES.md` if the implementation changed significantly.

---

## What Not to Do

- Do not add `npm` dependencies — the project is intentionally zero-dependency.
- Do not attempt automatic token refresh by spawning the Claude CLI. If the token is expired, return an error and let the user re-authenticate manually. The poll loop recovers on the next successful cycle.
- Do not implement Linux `secret-tool` support unless specifically requested.
- Do not add a dedicated `/api/claude-usage/refresh` endpoint — a `?refresh=1` query param is enough if forced refresh is needed.
- Do not return HTTP 500 from `/api/claude-usage`. The frontend `.catch(() => null)` path silently discards the badge on any fetch error. Always return 200 with a structured error body.

---

## Verification Checklist

### Functional
- [ ] `/api/claude-usage` returns valid JSON with `session` and `weekly` fields when credentials are in Keychain
- [ ] `/api/claude-usage` returns `{ error: "...", status: "error", session: null, weekly: null }` when credentials are absent — not a 500
- [ ] `resets_at` values are valid ISO 8601 strings parseable by `new Date()`
- [ ] `utilization` values are integers 0–100
- [ ] Second request within 60s returns cached result (check `cached_at` field)
- [ ] Badge renders correctly with real data: `42% session`, countdown, weekly
- [ ] Badge shows `--` gracefully when credentials are unavailable
- [ ] Reset-pending note appears correctly when utilization is high and reset is imminent
- [ ] All worker features (list, inspect, events, message, close) are unaffected

### Structural
- [ ] `server.js` does not reference any external shell script for usage
- [ ] `plugins/claude-usage.js` exports `fetchUsage`
- [ ] No `grep` or `sed` in the usage path
- [ ] `resets_at` is parsed with `new Date()`, not `date -j`

### Platform
- [ ] On a host without `security` command, server starts cleanly and badge shows `--`
