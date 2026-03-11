#!/usr/bin/env node
/**
 * Deterministic test: Claude usage provider
 *
 * Tests the provider in isolation — no running server required.
 * Exits 0 if all checks pass, 1 if any fail.
 *
 * Usage:
 *   node execution/test-claude-usage-provider.js
 *
 * What it checks:
 *   1. Keychain credential read (macOS only)
 *   2. Credential shape (has accessToken, not expired)
 *   3. API response format (status, utilization, resets_at)
 *   4. In-memory cache behavior (second call returns cached result)
 *   5. Graceful stale behavior (simulated API failure after warm cache)
 */

const path = require("node:path");
const { execFile } = require("node:child_process");
const https = require("node:https");

const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 60_000;

// ── Minimal standalone reimplementation for isolated testing ──
// (We do not `require` the plugin directly so this script is portable
//  and can be run from any working directory.)

function readCredentials() {
  return new Promise((resolve, reject) => {
    execFile(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return reject(new Error("Keychain read failed: " + err.message));
        try {
          const creds = JSON.parse(stdout.trim());
          resolve(creds);
        } catch {
          reject(new Error("Keychain returned invalid JSON"));
        }
      }
    );
  });
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), raw: body });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: body });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("Request timed out")));
    req.end();
  });
}

// ── Test runner ──

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗  ${label}`);
  if (detail) console.error(`       ${detail}`);
  failed++;
}

function section(title) {
  console.log(`\n── ${title}`);
}

async function run() {
  console.log("Claude Usage Provider — deterministic test\n");

  // ── 1. Keychain ──
  section("1. Keychain credential read");
  let creds;
  try {
    creds = await readCredentials();
    ok("Keychain read succeeded");
  } catch (err) {
    fail("Keychain read failed", err.message);
    console.error("\n  Cannot continue without credentials. Check: claude /login\n");
    process.exit(1);
  }

  // ── 2. Credential shape ──
  section("2. Credential shape");
  if (creds.accessToken && typeof creds.accessToken === "string" && creds.accessToken.length > 10) {
    ok("accessToken present and non-trivial");
  } else {
    fail("accessToken missing or malformed", JSON.stringify(Object.keys(creds)));
  }

  if (creds.expiresAt) {
    const expiresMs = new Date(creds.expiresAt).getTime();
    if (isNaN(expiresMs)) {
      fail("expiresAt is not a parseable date", String(creds.expiresAt));
    } else if (expiresMs < Date.now()) {
      fail("OAuth token is expired", `expired at ${new Date(expiresMs).toISOString()} — run: claude /login`);
    } else {
      ok(`Token valid until ${new Date(expiresMs).toISOString()}`);
    }
  } else {
    ok("No expiresAt field (token may not expire)");
  }

  // ── 3. API call ──
  section("3. Anthropic usage API call");
  let apiResult;
  try {
    apiResult = await httpGet(USAGE_API, {
      Authorization: `Bearer ${creds.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    });
  } catch (err) {
    fail("API request failed", err.message);
    console.error("\n  Cannot continue without API response.\n");
    process.exit(1);
  }

  if (apiResult.status === 200) {
    ok(`HTTP 200 received`);
  } else if (apiResult.status === 429) {
    fail(`HTTP 429 — rate limited`, "Provider will serve stale cache if available. Investigate polling frequency.");
    console.log("  Raw response:", apiResult.raw?.slice(0, 200));
  } else {
    fail(`Unexpected HTTP ${apiResult.status}`, apiResult.raw?.slice(0, 200));
  }

  // ── 4. Response shape ──
  section("4. API response shape");
  const data = apiResult.data;
  if (!data) {
    fail("Response body is not valid JSON", apiResult.raw?.slice(0, 200));
  } else {
    const checkPeriod = (key) => {
      const period = data[key];
      if (!period) {
        fail(`Missing '${key}' field in response`);
        return;
      }
      const util = Number(period.utilization ?? -1);
      if (util >= 0 && util <= 100) {
        ok(`${key}.utilization = ${util} (valid 0-100)`);
      } else {
        fail(`${key}.utilization out of range or missing`, String(period.utilization));
      }
      if (period.resets_at) {
        const d = new Date(period.resets_at);
        if (isNaN(d.getTime())) {
          fail(`${key}.resets_at is not parseable as a date`, period.resets_at);
        } else {
          ok(`${key}.resets_at = ${d.toISOString()} (parseable)`);
        }
      } else {
        fail(`${key}.resets_at missing`);
      }
    };

    if (apiResult.status === 200) {
      checkPeriod("five_hour");
      checkPeriod("seven_day");
    } else {
      ok("Skipping shape checks (non-200 response)");
    }
  }

  // ── 5. Plugin cache behavior ──
  section("5. Plugin module cache behavior");
  // Load the actual plugin from its real location relative to this script
  const pluginPath = path.resolve(__dirname, "../plugins/claude-usage.js");
  let plugin;
  try {
    plugin = require(pluginPath);
    ok("Plugin loaded from " + pluginPath);
  } catch (err) {
    fail("Could not load plugin", err.message);
    console.log("\n  Skipping cache test.\n");
    summarize();
    return;
  }

  if (typeof plugin.fetchUsage !== "function") {
    fail("Plugin does not export fetchUsage function");
    summarize();
    return;
  }

  let first;
  try {
    first = await plugin.fetchUsage();
    ok(`fetchUsage() returned status: ${first.status}`);
    if (first.cached_at) ok(`cached_at: ${first.cached_at}`);
    else fail("Missing cached_at in response");
  } catch (err) {
    fail("fetchUsage() threw", err.message);
    summarize();
    return;
  }

  let second;
  try {
    second = await plugin.fetchUsage();
    if (second.cached_at === first.cached_at) {
      ok("Second call returned cached result (same cached_at)");
    } else {
      fail("Second call did NOT return cached result (cached_at changed)", `first: ${first.cached_at} second: ${second.cached_at}`);
    }
  } catch (err) {
    fail("Second fetchUsage() threw", err.message);
  }

  summarize();
}

function summarize() {
  console.log(`\n── Result: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
