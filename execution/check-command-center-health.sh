#!/usr/bin/env bash
# Command Center health check
#
# Verifies the full stack is reachable:
#   1. mcporter is in PATH
#   2. Worker MCP server is reachable and lists expected tools
#   3. Cockpit server is running and /api/claude-usage is responding
#   4. /api/workers returns a valid response (even if empty)
#
# Usage:
#   bash execution/check-command-center-health.sh [PORT] [MCP_SERVER]
#
# Defaults:
#   PORT=7700
#   MCP_SERVER=claude-team-http

set -euo pipefail

PORT="${1:-${PORT:-7700}}"
MCP_SERVER="${2:-${MCP_SERVER:-claude-team-http}}"
BASE_URL="http://localhost:${PORT}"

PASS=0
FAIL=0

ok()   { echo "  ✓  $1"; ((PASS++)) || true; }
fail() { echo "  ✗  $1"; [[ -n "${2:-}" ]] && echo "       $2"; ((FAIL++)) || true; }
section() { echo; echo "── $1"; }

echo "Command Center — health check"
echo "  PORT:       $PORT"
echo "  MCP_SERVER: $MCP_SERVER"

# ── 1. mcporter ──
section "1. mcporter"
if command -v mcporter &>/dev/null; then
  ok "mcporter found in PATH: $(command -v mcporter)"
else
  fail "mcporter not found in PATH" "Install mcporter or check your PATH"
fi

# ── 2. Worker MCP server ──
section "2. Worker MCP server ($MCP_SERVER)"
if command -v mcporter &>/dev/null; then
  RAW_SCHEMA=""
  if RAW_SCHEMA=$(mcporter list "${MCP_SERVER}" --schema 2>&1); then
    ok "mcporter can reach $MCP_SERVER"
    for TOOL in list_workers examine_worker worker_events message_workers close_workers; do
      if echo "$RAW_SCHEMA" | grep -q "$TOOL"; then
        ok "Tool available: $TOOL"
      else
        fail "Tool missing: $TOOL" "Backend may not expose this tool or MCP_SERVER is wrong"
      fi
    done
  else
    fail "mcporter could not reach $MCP_SERVER" "$RAW_SCHEMA"
    echo
    echo "  Tip: is the worker backend running?"
    echo "  Try: uvx --from maniple-mcp@latest maniple --http"
  fi
else
  ok "Skipping MCP check (mcporter not available)"
fi

# ── 3. Cockpit server ──
section "3. Cockpit server ($BASE_URL)"
if curl -sf --max-time 3 "$BASE_URL/" -o /dev/null; then
  ok "Cockpit server is responding at $BASE_URL"
else
  fail "Cockpit server not reachable at $BASE_URL" "Start it with: node server.js"
fi

# ── 4. /api/claude-usage ──
section "4. /api/claude-usage"
if command -v curl &>/dev/null; then
  USAGE_BODY=""
  USAGE_HTTP=""
  USAGE_BODY=$(curl -sf --max-time 5 -o /tmp/wc-usage.json -w "%{http_code}" "$BASE_URL/api/claude-usage" 2>&1) || true
  USAGE_HTTP="$USAGE_BODY"
  USAGE_BODY=$(cat /tmp/wc-usage.json 2>/dev/null || echo "")

  if [[ "$USAGE_HTTP" == "200" ]]; then
    ok "HTTP 200 from /api/claude-usage"
    STATUS=$(echo "$USAGE_BODY" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    ok "Response status field: $STATUS"
    if echo "$USAGE_BODY" | grep -q '"error"'; then
      ERROR=$(echo "$USAGE_BODY" | grep -o '"error":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      fail "Provider returned an error field" "$ERROR"
    else
      ok "No error field in response"
    fi
    if echo "$USAGE_BODY" | grep -q '"session"'; then
      ok "session field present"
    else
      fail "session field missing from response"
    fi
  else
    fail "/api/claude-usage returned HTTP $USAGE_HTTP (expected 200)" "$USAGE_BODY"
  fi
else
  fail "curl not available — cannot check /api/claude-usage"
fi

# ── 5. /api/workers ──
section "5. /api/workers"
if command -v curl &>/dev/null; then
  WORKERS_BODY=""
  WORKERS_HTTP=""
  WORKERS_BODY=$(curl -sf --max-time 5 -o /tmp/wc-workers.json -w "%{http_code}" "$BASE_URL/api/workers" 2>&1) || true
  WORKERS_HTTP="$WORKERS_BODY"
  WORKERS_BODY=$(cat /tmp/wc-workers.json 2>/dev/null || echo "")

  if [[ "$WORKERS_HTTP" == "200" ]]; then
    ok "HTTP 200 from /api/workers"
    if echo "$WORKERS_BODY" | grep -q '"workers"'; then
      ok "workers field present in response"
    else
      fail "workers field missing" "$WORKERS_BODY"
    fi
  else
    fail "/api/workers returned HTTP $WORKERS_HTTP" "$WORKERS_BODY"
  fi
else
  ok "Skipping /api/workers check (curl not available)"
fi

# ── Summary ──
echo
echo "── Result: $PASS passed, $FAIL failed"
echo

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
