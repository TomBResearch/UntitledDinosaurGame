// Talking to the shared account platform (docs/architecture/accounts.md; the platform's
// docs/spec.md is the authority). Log in, sign up, password reset, resend verification, refresh,
// "who am I" and log out, plus player-facing text for every error the platform sends.
//
// Tokens: the refresh token is an HttpOnly cookie on the accounts domain that this page never
// sees. The access token lives only in this module's memory, never in storage. The game at /play/
// gets its own access token by refreshing with the same cookie (ADR 0015).
//
// One refresh at a time: two refreshes at once with the same cookie count as reuse, and the
// platform then logs the player out everywhere. Refresh and log out run under a Web Lock that the
// game takes too (client/net/platform/web_platform_transport.gd), so this page and a game open in
// another tab never overlap.
//
// Local testing: on a page served from localhost, ?accounts=http://localhost:3110 points this page
// at a local copy of the platform (web/README.md). A deployed page always uses the real one.

export const ENABLED = true;
const PLATFORM = "https://accounts.untitledgames.co.uk";
const LOCK_NAME = "udg-platform-session"; // The game uses the same name.

/** The local platform from ?accounts=, on a local page only. Null otherwise. */
export const localPlatform = (() => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return null;
  const given = new URLSearchParams(location.search).get("accounts");
  return given && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(given) ? given.replace(/\/$/, "") : null;
})();
const BASE = localPlatform ?? PLATFORM;

let accessToken = null;
let refreshing = null;

/** Runs fn alone across every tab of this site, where the browser supports Web Locks. */
function exclusive(fn) {
  return navigator.locks?.request ? navigator.locks.request(LOCK_NAME, fn) : fn();
}

async function call(path, { method = "POST", body, auth = false } = {}) {
  if (!ENABLED) return { ok: false, status: 0, error: "not_open" };
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: data?.error ?? "unknown", message: data?.message };
    return { ok: true, status: res.status, data };
  } catch {
    // No answer at all. A browser refusing the request (CORS, before the platform allows this
    // site) looks the same from here.
    return { ok: false, status: 0, error: "network" };
  }
}

export async function logIn(email, password) {
  const r = await call("/auth/login", { body: { email, password } });
  if (r.ok) accessToken = r.data?.accessToken ?? null;
  return r;
}

export function register(username, email, password, dateOfBirth) {
  return call("/auth/register", { body: { username, email, password, dateOfBirth } });
}

export function requestReset(email) {
  return call("/auth/password-reset/request", { body: { email } });
}

export function resendVerification(email) {
  return call("/auth/verify-email/resend", { body: { email } });
}

/** Refreshes the session from the cookie. Only one refresh runs at a time, in any tab. */
export function refresh() {
  if (!refreshing) {
    refreshing = exclusive(() => call("/auth/refresh")).then((r) => {
      accessToken = r.ok ? (r.data?.accessToken ?? null) : null;
      return r;
    }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export function me() {
  return call("/me", { method: "GET", auth: true });
}

/** Ends the session on the platform: this page and any game using this login. */
export async function logOut() {
  if (refreshing) await refreshing;
  const r = await exclusive(() => call("/auth/logout"));
  accessToken = null;
  return r;
}

/** Which sign-up field an error is about, so the page can point at it. */
export function fieldFor(error) {
  return {
    username_taken: "username", invalid_username: "username",
    weak_password: "password",
    invalid_date_of_birth: "dateOfBirth", too_young: "dateOfBirth",
  }[error] ?? null;
}

/** Player-facing text for the platform's error codes (its docs/spec.md, "API"). */
export function explain(r) {
  switch (r.error) {
    case "not_open": return "Accounts open with the next update. Hang tight, explorer!";
    // Log in
    case "invalid_credentials": return "That email and password don't match. Check them and try again.";
    case "email_not_verified": return "Confirm your email first: open the link we sent you, then log in.";
    case "banned": return r.message || "This account is banned.";
    case "too_many_attempts": return r.message ? `Too many wrong passwords. ${r.message.replace(/^Too many failed attempts\.\s*/, "")}` : "Too many wrong passwords. Wait a minute, then try again.";
    // Sign up
    case "username_taken": return "Someone already has that username. Try another.";
    case "invalid_username": return r.message || "That username isn't allowed. Use 3–16 letters, numbers or underscores.";
    case "weak_password": return r.message || "Pick a stronger password: 10 or more characters, not a common one.";
    case "invalid_date_of_birth": return "That date of birth doesn't look right.";
    case "too_young": return "Sorry, you need to be 13 or older to play.";
    // Sessions
    case "no_session":
    case "session_expired":
    case "token_reused":
    case "invalid_token": return "You've been logged out. Please log in again.";
    case "bad_origin": return "This page isn't allowed to use accounts yet. Please try again later.";
    // Anything
    case "invalid_request": return "Something in the form wasn't right. Check it and try again.";
    case "rate_limited": return "Slow down, speedy raptor. Wait a few minutes, then try again.";
    case "network": return "We couldn't reach the accounts server. Check your connection and try again.";
    case "internal": return "The accounts server tripped over a fossil. Please try again in a moment.";
    default: return r.message || "Something went wrong. Please try again.";
  }
}
