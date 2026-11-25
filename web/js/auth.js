// Talking to the shared account platform (docs/architecture/accounts.md; the platform's
// docs/spec.md is the authority). Log in, sign up, password reset and "who am I".
//
// OFF until M1: the platform must first allow this site's origin (ALLOWED_ORIGINS). Until then
// every call answers { ok: false, error: "not_open" } and the page says accounts open soon.
// Turning it on is one line: ENABLED = true.
//
// Tokens: the refresh token is an HttpOnly cookie on the accounts domain that this page never
// sees. The access token lives only in this module's memory, never in storage. The game page
// gets its own access token by refreshing (one refresh at a time: two at once count as reuse).

export const ENABLED = false;
const BASE = "https://accounts.untitledgames.co.uk";

let accessToken = null;
let refreshing = null;

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

/** Refreshes the session from the cookie. Only one refresh runs at a time. */
export function refresh() {
  if (!refreshing) {
    refreshing = call("/auth/refresh").then((r) => {
      accessToken = r.ok ? (r.data?.accessToken ?? null) : null;
      return r;
    }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export function me() {
  return call("/me", { method: "GET", auth: true });
}

export async function logOut() {
  const r = await call("/auth/logout");
  accessToken = null;
  return r;
}

/** Player-facing text for the platform's error codes. */
export function explain(r) {
  switch (r.error) {
    case "not_open": return "Accounts open with the next update. Hang tight, explorer!";
    case "invalid_credentials": return "That email and password don't match. Check them and try again.";
    case "email_not_verified": return "Check your inbox first: you need to confirm your email before logging in.";
    case "banned": return r.message || "This account is banned.";
    case "too_many_attempts": return "Too many tries. Wait a minute, then try again.";
    case "rate_limited": return "Slow down, speedy raptor. Try again in a little while.";
    case "username_taken": return "Someone already has that username. Try another.";
    case "invalid_username": return r.message || "That username isn't allowed. Use 3–16 letters, numbers or underscores.";
    case "weak_password": return r.message || "Pick a stronger password: 10 or more characters, not a common one.";
    case "invalid_date_of_birth": return "That date of birth doesn't look right.";
    case "too_young": return "Sorry, you need to be 13 or older to play.";
    case "network": return "We couldn't reach the accounts server. Check your connection.";
    default: return r.message || "Something went wrong. Please try again.";
  }
}
