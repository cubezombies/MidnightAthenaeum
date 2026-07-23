'use strict';

/**
 * Optional Discord Rich Presence — shows "Listening to <title> — Ch. N" on
 * the user's Discord profile while a book plays. Entirely best-effort and
 * silent: if Discord isn't installed/running, or no client ID is configured,
 * every call here just no-ops rather than surfacing an error anywhere in the
 * app. Off by default (see the topbar toggle in app.js) — this reports what
 * you're listening to externally, so it's opt-in like the online metadata
 * lookup, not a launch-time default.
 *
 * Needs a free Discord "Application" registered at
 * https://discord.com/developers/applications to get a client ID — create
 * one (its name is what shows in the presence card's header), copy the
 * Application ID, and set it as DISCORD_CLIENT_ID below or in the
 * environment. Until that's set, this module is inert.
 */

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';

let RPC = null;
try {
  // eslint-disable-next-line global-require
  RPC = require('@xhayper/discord-rpc');
} catch (err) {
  console.warn('[discord] @xhayper/discord-rpc not available:', err.message);
}

let client = null;
let connectPromise = null;
let enabled = false;
let lastFailedAt = 0;

// Discord's own RPC client library doesn't reliably fail fast when Discord
// isn't running (observed hanging indefinitely in testing rather than
// rejecting) — this wrapper guarantees a bounded wait regardless of what the
// library actually does internally, since a stuck connect() here must never
// be able to wedge presence updates for the rest of the session.
const CONNECT_TIMEOUT_MS = 4000;
// After a failed/timed-out attempt, don't retry on every single playback
// event (a chapter change, a play/pause toggle) — that's most of them while
// Discord is closed. One attempt per cooldown window is enough.
const RETRY_COOLDOWN_MS = 30_000;

function log(...args) {
  console.log('[discord]', ...args);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]);
}

/** Connects once and reuses the connection; concurrent callers share the same in-flight attempt. */
async function ensureClient() {
  if (!RPC || !CLIENT_ID) return null;
  if (client?.isConnected) return client;
  if (connectPromise) return connectPromise;
  if (Date.now() - lastFailedAt < RETRY_COOLDOWN_MS) return null;

  connectPromise = (async () => {
    const c = new RPC.Client({ clientId: CLIENT_ID });
    // Errors after login (e.g. Discord quit mid-session) shouldn't crash
    // the app — just drop the stale client so the next update reconnects.
    c.on('disconnected', () => { if (client === c) client = null; });
    try {
      await withTimeout(c.login(), CONNECT_TIMEOUT_MS);
      client = c;
      log('connected to Discord');
      return c;
    } catch (err) {
      log('could not connect (Discord probably not running):', err.message);
      lastFailedAt = Date.now();
      try { await c.destroy(); } catch { /* best effort */ }
      return null;
    }
  })();

  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

function setEnabled(value) {
  const next = Boolean(value);
  if (enabled === next) return;
  enabled = next;
  if (!enabled) clearActivity();
}

function isEnabled() {
  return enabled;
}

/** @param {{ title: string, chapterLabel?: string, isPlaying: boolean }} info */
async function setActivity(info) {
  if (!enabled || !info?.title) return;
  const c = await ensureClient();
  if (!c?.user) return;

  try {
    await c.user.setActivity({
      details: info.title,
      state: info.chapterLabel
        ? (info.isPlaying ? info.chapterLabel : `Paused — ${info.chapterLabel}`)
        : (info.isPlaying ? 'Listening' : 'Paused'),
      startTimestamp: info.isPlaying ? Date.now() : undefined,
      instance: false,
    });
  } catch (err) {
    log('setActivity failed:', err.message);
  }
}

async function clearActivity() {
  if (!client?.user) return;
  try {
    await client.user.clearActivity();
  } catch (err) {
    log('clearActivity failed:', err.message);
  }
}

/** Best-effort teardown on app quit — never blocks it. */
async function shutdown() {
  if (!client) return;
  try {
    await client.destroy();
  } catch {
    // Quitting anyway.
  }
  client = null;
}

module.exports = { setEnabled, isEnabled, setActivity, clearActivity, shutdown };
