// The landing page: draws the scene and characters, switches the card between its panels
// (log in, create account, forgotten password, check your inbox, signed in), checks forms
// against the platform's rules before sending, and adds parallax and a raptor whose eye
// follows the pointer. Works without animation when the visitor prefers reduced motion.
//
// Preview the signed-in card with ?demo=account (sample data, nothing is sent anywhere).

import { buildScene, letterBird, cornerVine } from "./scene.js";
import { triceratops, raptorPeek } from "./critters.js";
import * as auth from "./auth.js";

const $ = (sel, root = document) => root.querySelector(sel);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const params = new URLSearchParams(location.search);

// ---------- Drawing ----------

$("#scene").innerHTML = buildScene();
$("#peeker").innerHTML = raptorPeek();
$("#buddy").innerHTML = triceratops();
$("#sentArt").innerHTML = letterBird();
$("#cardVines").innerHTML = cornerVine(1, 3).replace("<svg", `<svg class="vl"`) + cornerVine(-1, 8).replace("<svg", `<svg class="vr"`);

function applyMotionPreference() {
  for (const svg of document.querySelectorAll("svg")) {
    if (typeof svg.pauseAnimations !== "function") continue;
    if (reduced.matches) svg.pauseAnimations(); else svg.unpauseAnimations();
  }
}
applyMotionPreference();
reduced.addEventListener("change", applyMotionPreference);

// ---------- Parallax and the raptor's eye ----------

const layers = [...document.querySelectorAll("#scene .layer")].map((el) => ({ el, depth: Number(el.dataset.depth) }));
const pupil = document.getElementById("raptorPupil");
let target = { x: 0, y: 0 }, current = { x: 0, y: 0 }, pointer = null, frame = 0;

window.addEventListener("pointermove", (e) => {
  target = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 };
  pointer = { x: e.clientX, y: e.clientY };
  if (!frame) frame = requestAnimationFrame(tick);
}, { passive: true });

function tick() {
  frame = 0;
  if (reduced.matches) return;
  current.x += (target.x - current.x) * 0.08;
  current.y += (target.y - current.y) * 0.08;
  for (const { el, depth } of layers) {
    el.setAttribute("transform", `translate(${(-current.x * depth * 60).toFixed(2)} ${(-current.y * depth * 24).toFixed(2)})`);
  }
  if (pupil && pointer) {
    const box = pupil.getBoundingClientRect();
    const dx = pointer.x - (box.left + box.width / 2), dy = pointer.y - (box.top + box.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / 200) * 3.2;
    pupil.setAttribute("transform", `translate(${((dx / len) * k).toFixed(2)} ${((dy / len) * k).toFixed(2)})`);
  }
  if (Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001) frame = requestAnimationFrame(tick);
}

// ---------- Panels ----------

const panels = new Map([...document.querySelectorAll("[data-panel]")].map((p) => [p.dataset.panel, p]));
const plank = { login: "Base Camp", join: "New Explorer", forgot: "Lost & Found", sent: "Message Sent", account: "Base Camp" };
const card = $(".card");
let signedIn = null;

function show(name, { focus = true } = {}) {
  if (!panels.has(name) || (name === "account" && !signedIn)) name = signedIn ? "account" : "login";
  for (const [key, el] of panels) el.hidden = key !== name;
  $("#plankText").textContent = plank[name];
  for (const note of document.querySelectorAll(".note")) note.hidden = true;
  if (focus) panels.get(name).querySelector("input, .btn-primary")?.focus({ preventScroll: true });
}
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

// ---------- Messages ----------

const toastEl = $("#toast");
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3800);
}

function fail(form, text, field) {
  const note = $(".note", form);
  note.textContent = text;
  note.className = "note";
  note.hidden = false;
  if (field) { field.closest(".field").classList.add("invalid"); field.focus(); }
  card.classList.remove("shake");
  void card.offsetWidth;
  if (!reduced.matches) card.classList.add("shake");
}

function busy(form, on) {
  const btn = $(".btn-primary", form);
  btn.disabled = on;
  btn.style.filter = on ? "grayscale(.6)" : "";
}

for (const input of document.querySelectorAll(".field input")) {
  input.addEventListener("input", () => {
    input.closest(".field").classList.remove("invalid");
    const note = $(".note", input.form);
    if (note) note.hidden = true;
  });
}

for (const btn of document.querySelectorAll("[data-peek]")) {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.peek);
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    btn.setAttribute("aria-pressed", String(reveal));
    btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    input.focus();
  });
}

// ---------- Checks (the platform checks again; these just save a round trip) ----------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;

function ageOn(dob, today = new Date()) {
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

// ---------- Forms ----------

let lastEmail = "";

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.email.value.trim(), password = form.password.value;
  if (!EMAIL.test(email)) return fail(form, "Enter the email address you signed up with.", form.email);
  if (!password) return fail(form, "A password, please. Fossils don't count.", form.password);
  busy(form, true);
  const r = await auth.logIn(email, password);
  busy(form, false);
  if (!r.ok) return fail(form, auth.explain(r));
  form.password.value = "";
  signIn(r.data.account);
});

$("#joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const username = form.username.value.trim(), email = form.email.value.trim();
  const password = form.password.value, dob = form.dateOfBirth.value;
  if (!USERNAME.test(username)) return fail(form, "Usernames are 3–16 letters, numbers or underscores.", form.username);
  if (!EMAIL.test(email)) return fail(form, "That email address doesn't look right.", form.email);
  if (password.length < 10) return fail(form, "Passwords need at least 10 characters.", form.password);
  if (/^(.)\1*$/.test(password)) return fail(form, "Not just one character over and over, please.", form.password);
  const lower = password.toLowerCase();
  if (lower.includes(username.toLowerCase()) || lower.includes(email.split("@")[0].toLowerCase())) {
    return fail(form, "Your password can't contain your username or email.", form.password);
  }
  if (!dob) return fail(form, "Enter your date of birth.", form.dateOfBirth);
  const age = ageOn(dob);
  if (Number.isNaN(age) || age > 120) return fail(form, "That date of birth doesn't look right.", form.dateOfBirth);
  if (age < 13) return fail(form, "Sorry, you need to be 13 or older to play.", form.dateOfBirth);
  busy(form, true);
  const r = await auth.register(username, email, password, dob);
  busy(form, false);
  if (!r.ok) return fail(form, auth.explain(r));
  form.reset();
  lastEmail = email;
  $("#sentText").textContent = "We've sent a link to confirm your email. Open it within an hour, then log in.";
  location.hash = "sent";
});

$("#forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.email.value.trim();
  if (!EMAIL.test(email)) return fail(form, "Enter the email address on your account.", form.email);
  busy(form, true);
  const r = await auth.requestReset(email);
  busy(form, false);
  if (!r.ok) return fail(form, auth.explain(r));
  lastEmail = email;
  $("#sentText").textContent = "If that email has an account, a reset link is on its way. It works for one hour.";
  location.hash = "sent";
});

$("#resendBtn").addEventListener("click", async () => {
  if (!lastEmail) return toast("Head back and enter your email first.");
  const r = await auth.resendVerification(lastEmail);
  toast(r.ok ? "Sent again. Check your spam folder too." : auth.explain(r));
});

$("#logoutBtn").addEventListener("click", async () => {
  await auth.logOut();
  signedIn = null;
  toast("See you soon, explorer.");
  location.hash = "login";
  show("login");
});

// ---------- Signed in ----------

function signIn(account) {
  signedIn = account;
  $("#accName").textContent = account.username;
  $("#accEmail").textContent = account.email ?? "–";
  $("#accSince").textContent = account.createdAt
    ? new Date(account.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "–";
  const next = account.usernameChangeAvailableAt ? new Date(account.usernameChangeAvailableAt) : null;
  $("#accUsernameNote").textContent = next && next > new Date()
    ? `Can change from ${next.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Can be changed";
  const badges = [];
  const role = { moderator: "Moderator", admin: "Admin", owner: "Owner" }[account.role];
  if (role) badges.push(`<span class="badge staff">${role}</span>`);
  if (account.premium) badges.push(`<span class="badge premium">Premium</span>`);
  if (!badges.length) badges.push(`<span class="badge">Explorer</span>`);
  $("#accBadges").innerHTML = badges.join("");
  location.hash = "account";
  show("account");
}

// ---------- Start ----------

if (params.get("demo") === "account") {
  signIn({
    username: "RaptorRanger99", email: "ranger@example.com", role: "normal", premium: true,
    createdAt: "2026-11-25T10:00:00Z", usernameChangeAvailableAt: null,
  });
} else {
  show(location.hash.slice(1) || "login", { focus: false });
  if (auth.ENABLED) {
    auth.refresh().then((r) => { if (r.ok && r.data?.account) signIn(r.data.account); });
  }
}
