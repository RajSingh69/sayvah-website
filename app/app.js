// SayVah on the web. Talks to the same Firebase project as the phone app and
// writes requests, offers and messages in exactly the shapes the app writes
// (see seva_app: create_request_screen, seva_requests_screen, chat_screen).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail,
  signOut, setPersistence, browserLocalPersistence, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
  onSnapshot, query, where, orderBy, limit, runTransaction, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  getStorage, connectStorageEmulator, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2gzxxVo1WEHr8_BynpuyvxVry0WwqV7Q",
  authDomain: "seva-app-b6a18.firebaseapp.com",
  projectId: "seva-app-b6a18",
  storageBucket: "seva-app-b6a18.firebasestorage.app",
  messagingSenderId: "1046020854100",
  appId: "1:1046020854100:web:eec028446676e8141178c1",
  measurementId: "G-5FBW6MM28K"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const storage = getStorage(fbApp);

// Local testing only: http://localhost:<port>/app/?emulator=1 talks to the Firebase emulators.
const USING_EMULATORS = ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("emulator");
if (USING_EMULATORS) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8089);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

const PC_APP_URL = "https://seva-app-b6a18.web.app";
const APP_STORE_URL = "https://apps.apple.com/gb/app/id6772755865";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.sayvah.app&hl=en_GB";
const REQUEST_TAGS = ["Lifting", "Construction", "Gardening", "Cleaning", "Tech Help", "Elderly Support", "Tutoring", "Food Seva", "Weekend", "Urgent"];
const SERVICE_TYPES = ["In Person", "Online"];

const root = document.getElementById("root");
const state = { user: null, profile: null, blocked: new Set(), profileUnsub: null, blockedUnsub: null };
let viewUnsubs = [];
const nameCache = new Map();

/* ---------- Helpers mirrored from the app ---------- */

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function pickFirstString(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}
function pickFirstBool(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["true", "yes", "approved"].includes(v)) return true;
      if (["false", "no", "rejected"].includes(v)) return false;
    }
  }
  return null;
}
function normalizeRole(value) {
  return value.trim().toLowerCase().replaceAll("_", "").replaceAll("-", "").replaceAll(" ", "").replaceAll("&", "and");
}
function normalizedRoles(data) {
  const values = [
    pickFirstString(data, ["role"]),
    pickFirstString(data, ["userType", "accountType", "memberType"]),
    pickFirstString(data, ["sevaRole", "communityRole", "profileRole"])
  ];
  for (const key of ["roles", "userRoles", "accountRoles"]) {
    if (Array.isArray(data?.[key])) values.push(...data[key].map(String));
  }
  return new Set(values.flatMap(v => v.split(/[,/|&+]/)).map(normalizeRole).filter(Boolean));
}
const REQUEST_ROLES = ["requester", "seeker", "sevarequester", "both", "requesterandsevadaar", "requesterhelper", "requestersevadaar"];
const HELP_ROLES = ["sevadaar", "helper", "volunteer", "sewadar", "both", "requesterandsevadaar", "requesterhelper", "requestersevadaar"];
function roleAllowsRequesting(d) {
  return [...normalizedRoles(d)].some(r => REQUEST_ROLES.includes(r)) || d?.isRequester === true || d?.canRequest === true || d?.canRequestSeva === true;
}
function roleAllowsHelping(d) {
  return [...normalizedRoles(d)].some(r => HELP_ROLES.includes(r)) || d?.isSevadaar === true || d?.isHelper === true || d?.canHelp === true || d?.canProvideSeva === true;
}
function missingRequirements(d) {
  const missing = [];
  if (!pickFirstString(d, ["fullName", "name", "displayName"])) missing.push("your full name");
  if (!pickFirstString(d, ["photoUrl", "profileImageUrl", "imageUrl"])) missing.push("a profile picture");
  if (!pickFirstString(d, ["area", "location", "locationName", "locationId"])) missing.push("your area");
  if (normalizedRoles(d).size === 0) missing.push("your account role");
  return missing;
}
function isVerified(d) { return pickFirstBool(d, ["isVerified", "verified"]) === true; }
function isActiveMember(d) {
  return missingRequirements(d).length === 0 && pickFirstBool(d, ["isApproved", "approved"]) !== false &&
    isVerified(d) && d?.isBanned !== true && d?.banned !== true && d?.isHiddenFromCommunity !== true &&
    d?.hidden !== true && pickFirstBool(d, ["isActive", "active"]) !== false;
}
const canRequestSeva = d => isActiveMember(d) && roleAllowsRequesting(d);
const canProvideSeva = d => isActiveMember(d) && roleAllowsHelping(d);

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string") { const d = new Date(value); return isNaN(d) ? null : d; }
  return null;
}
const pad = n => String(n).padStart(2, "0");
function formatDate(d) { return d ? `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` : "Not specified"; }
function formatTime(d) { return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ""; }
function formatRange(start, end) {
  if (!start) return "Not specified";
  const s = `${formatDate(start)} ${formatTime(start)}`;
  return end ? `${s} - ${formatTime(end)}` : s;
}
function friendlyDay(d) {
  if (!d) return "Date not set";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  const time = formatTime(d);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
function outwardCode(postcode) {
  const compact = String(postcode || "").toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^([A-Z]{1,2}[0-9][A-Z0-9]?)[0-9][A-Z]{2}$/);
  return match ? match[1] : "";
}
function slotsFromRequest(data) {
  const raw = Array.isArray(data?.proposedTimeSlots) ? data.proposedTimeSlots : [];
  const slots = raw.map(s => ({ id: String(s?.id || ""), startAt: toDate(s?.startAt), endAt: toDate(s?.endAt) }))
    .filter(s => s.id && s.startAt && s.endAt);
  if (slots.length) return slots;
  const legacy = toDate(data?.confirmedStartAt) || toDate(data?.dateNeeded);
  if (!legacy) return [];
  return [{ id: "legacy_date_needed", startAt: legacy, endAt: toDate(data?.confirmedEndAt) || new Date(legacy.getTime() + 3600000) }];
}
function requestStart(data) { return toDate(data?.confirmedStartAt) || slotsFromRequest(data)[0]?.startAt || toDate(data?.dateNeeded); }

const STATUS_LABELS = {
  open: ["Open", "status-open"],
  pending_admin_approval: ["Waiting for admin approval", "status-pending"],
  accepted: ["Approved", "status-accepted"],
  active: ["In progress", "status-accepted"],
  in_progress: ["In progress", "status-accepted"],
  completed: ["Completed", "status-done"],
  rejected: ["Not approved", "status-closed"],
  cancelled: ["Cancelled", "status-closed"]
};
function statusPill(status) {
  const [label, cls] = STATUS_LABELS[String(status || "").toLowerCase()] || [status || "Unknown", "status-closed"];
  return `<span class="pill ${cls}">${escapeHtml(label)}</span>`;
}
function displayName(data) { return pickFirstString(data, ["fullName", "name", "displayName"]) || "SayVah member"; }
async function userName(uid) {
  if (!uid) return "SayVah member";
  if (uid === "support_team") return "SayVah Support";
  if (nameCache.has(uid)) return nameCache.get(uid);
  const promise = getDoc(doc(db, "users", uid)).then(s => displayName(s.data() || {})).catch(() => "SayVah member");
  nameCache.set(uid, promise);
  return promise;
}
function icon(id) { return `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`; }
function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("permission-denied")) return "SayVah didn't allow that. Your account may need to finish verification first.";
  if (code.includes("unavailable") || code.includes("network")) return "You seem to be offline. Check your connection and try again.";
  return error?.message?.replace(/^Error:\s*/, "") || "Something went wrong. Please try again.";
}
function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3800);
}
function clearView() { viewUnsubs.forEach(u => { try { u(); } catch {} }); viewUnsubs = []; }
function listen(q, onData, onError) {
  const unsub = onSnapshot(q, onData, err => { console.error(err); onError?.(err); });
  viewUnsubs.push(unsub);
  return unsub;
}

/* ---------- Auth ---------- */

setPersistence(auth, browserLocalPersistence).catch(() => {});

onAuthStateChanged(auth, user => {
  state.profileUnsub?.(); state.blockedUnsub?.();
  state.user = user; state.profile = null; state.blocked = new Set();
  clearView();
  if (!user) { renderSignIn(); return; }
  state.profileUnsub = onSnapshot(doc(db, "users", user.uid), snap => {
    const first = state.profile === null;
    state.profile = snap.data() || {};
    if (first) { renderShell(); route(); } else { renderSidebarProfile(); }
  }, err => { console.error(err); state.profile = {}; renderShell(); route(); });
  state.blockedUnsub = onSnapshot(collection(db, "users", user.uid, "blockedUsers"), snap => {
    state.blocked = new Set(snap.docs.map(d => d.id));
  }, () => {});
});

function renderSignIn() {
  document.title = "Sign in | SayVah";
  root.innerHTML = `
    <main class="signin">
      <a class="signin-brand" href="/"><span class="mark" aria-hidden="true">ੴ</span><span>SayVah</span></a>
      <section class="signin-card" aria-labelledby="signin-title">
        <h1 id="signin-title">Sign in to SayVah</h1>
        <p>Use the same email and password as the SayVah app. Everything you do here shows up on your phone too.</p>
        ${USING_EMULATORS ? `<p class="notice notice-warn">Test mode: connected to the local emulators, not the real SayVah.</p>` : ""}
        <form id="signin-form" novalidate>
          <label class="field"><span>Email address</span><input id="si-email" type="email" autocomplete="email" required /></label>
          <label class="field"><span>Password</span><input id="si-password" type="password" autocomplete="current-password" required /></label>
          <p class="form-msg" id="si-msg" role="alert"></p>
          <button class="btn btn-gold btn-block" type="submit" id="si-submit">Sign in</button>
          <button class="link-button" type="button" id="si-forgot">Forgotten your password?</button>
        </form>
      </section>
      <section class="signin-new">
        <h2>New to SayVah?</h2>
        <p>Create your account in the app first. It asks for your photo and area so your local admin can verify you. Then sign in here.</p>
        <div class="row">
          <a class="btn btn-surface" href="${APP_STORE_URL}" target="_blank" rel="noopener noreferrer">App Store</a>
          <a class="btn btn-surface" href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer">Google Play</a>
          <a class="btn btn-line" href="${PC_APP_URL}">Sign up on a computer</a>
        </div>
      </section>
      <a class="signin-home" href="/">${icon("back")} Back to sayvah.co.uk</a>
    </main>`;
  const form = document.getElementById("signin-form");
  const msg = document.getElementById("si-msg");
  const submit = document.getElementById("si-submit");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("si-email").value.trim();
    const password = document.getElementById("si-password").value;
    if (!email || !password) { msg.textContent = "Enter your email address and password."; return; }
    submit.disabled = true; submit.textContent = "Signing in…"; msg.textContent = "";
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const code = err?.code || "";
      msg.textContent = code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")
        ? "That email and password don't match a SayVah account."
        : code.includes("too-many-requests") ? "Too many attempts. Wait a few minutes, or reset your password." : friendlyError(err);
      submit.disabled = false; submit.textContent = "Sign in";
    }
  });
  document.getElementById("si-forgot").addEventListener("click", async () => {
    const email = document.getElementById("si-email").value.trim();
    if (!email) { msg.textContent = "Type your email address above first, then press this again."; return; }
    try {
      await sendPasswordResetEmail(auth, email);
      msg.textContent = `If ${email} has a SayVah account, a reset link is on its way.`;
    } catch (err) { msg.textContent = friendlyError(err); }
  });
}

/* ---------- Shell ---------- */

const NAV = [
  ["", "Home", "home"],
  ["requests", "Find requests", "search"],
  ["mine", "My requests", "list"],
  ["helping", "Helping", "hand"],
  ["chats", "Chats", "chat"]
];

function renderShell() {
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="/"><span class="mark" aria-hidden="true">ੴ</span><span>SayVah</span></a>
        <nav class="nav" aria-label="SayVah">
          ${NAV.map(([path, label, ic]) => `<a href="#/${path}" data-nav="${path}">${icon(ic)}<span>${label}</span></a>`).join("")}
        </nav>
        <a class="btn btn-gold new-request" href="#/new" aria-label="New request">${icon("plus")}<span>New request</span></a>
        <div class="me" id="me"></div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
    </div>
    ${USING_EMULATORS ? `<div class="test-banner">Test mode: local emulators</div>` : ""}`;
  renderSidebarProfile();
}

function renderSidebarProfile() {
  const me = document.getElementById("me");
  if (!me) return;
  const p = state.profile || {};
  const photo = pickFirstString(p, ["photoUrl", "profileImageUrl", "imageUrl"]);
  const area = pickFirstString(p, ["area", "locationName", "location"]);
  me.innerHTML = `
    <div class="me-row">
      ${photo ? `<img src="${escapeHtml(photo)}" alt="" />` : `<span class="avatar">${escapeHtml(displayName(p).charAt(0))}</span>`}
      <div><strong>${escapeHtml(displayName(p))}</strong><small>${escapeHtml(area || "No area set")}${isVerified(p) ? " · Verified" : ""}</small></div>
    </div>
    <button class="link-button" id="signout">${icon("out")} Sign out</button>`;
  document.getElementById("signout").onclick = () => signOut(auth);
}

window.addEventListener("hashchange", () => { if (state.user && state.profile) route(); });

function route() {
  clearView();
  const [section = "", id = ""] = location.hash.replace(/^#\/?/, "").split("/");
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === section));
  const main = document.getElementById("main");
  if (!main) return;
  main.scrollTop = 0;
  const views = { "": viewHome, requests: viewBrowse, mine: viewMine, helping: viewHelping, chats: viewChats, new: viewNewRequest };
  (views[section] || viewHome)(main, decodeURIComponent(id));
}

function profileNotice(kind) {
  const p = state.profile || {};
  const ok = kind === "request" ? canRequestSeva(p) : canProvideSeva(p);
  if (ok) return "";
  let reason;
  if (p.isBanned === true || p.banned === true) reason = "Your account is restricted at the moment. Contact SayVah Support if you think this is a mistake.";
  else if (missingRequirements(p).length) reason = `Your profile still needs ${missingRequirements(p).join(", ")}. Add ${missingRequirements(p).length > 1 ? "them" : "it"} in the SayVah app, then you can ${kind === "request" ? "post requests" : "offer help"}.`;
  else if (!isVerified(p)) reason = `Your account is waiting for verification by a SayVah admin. Once it's verified you can ${kind === "request" ? "post requests" : "offer help"}.`;
  else reason = kind === "request" ? "Your account role doesn't include asking for help. You can change your role in the SayVah app." : "Your account role doesn't include volunteering. You can change your role in the SayVah app.";
  return `<p class="notice notice-warn">${escapeHtml(reason)}</p>`;
}

/* ---------- Home ---------- */

function viewHome(main) {
  document.title = "Home | SayVah";
  const p = state.profile || {};
  const first = displayName(p).split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const area = pickFirstString(p, ["area", "locationName", "location"]);
  main.innerHTML = `
    <header class="page-head">
      <div><p class="muted">${greeting}</p><h1>Sat Sri Akal, ${escapeHtml(first)}</h1></div>
      <div class="row">
        <a class="btn btn-gold" href="#/new">${icon("plus")} Ask for help</a>
        <a class="btn btn-surface" href="#/requests">${icon("search")} Find someone to help</a>
      </div>
    </header>
    ${!isActiveMember(p) ? profileNotice(roleAllowsRequesting(p) ? "request" : "help") : ""}
    <div class="home-grid">
      <section class="panel">
        <div class="panel-head"><h2>Coming up</h2><span class="muted small">Seva you're part of</span></div>
        <div id="upcoming" class="stack"><p class="muted">Loading…</p></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Open requests${area ? ` in ${escapeHtml(area)}` : ""}</h2><a href="#/requests" class="small">See all</a></div>
        <div id="nearby" class="stack"><p class="muted">Loading…</p></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Your requests</h2><a href="#/mine" class="small">Manage</a></div>
        <div id="home-mine" class="stack"><p class="muted">Loading…</p></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Recent chats</h2><a href="#/chats" class="small">Open chats</a></div>
        <div id="home-chats" class="stack"><p class="muted">Loading…</p></div>
      </section>
    </div>`;

  const uid = state.user.uid;
  const involved = new Map();
  const renderUpcoming = () => {
    const box = document.getElementById("upcoming");
    if (!box) return;
    const rows = [...involved.values()]
      .filter(r => ["accepted", "active", "in_progress", "pending_admin_approval"].includes(r.data.status))
      .sort((a, b) => (requestStart(a.data)?.getTime() ?? Infinity) - (requestStart(b.data)?.getTime() ?? Infinity));
    box.innerHTML = rows.length ? rows.slice(0, 6).map(r => requestRow(r.id, r.data, r.role.startsWith("helper") ? `#/helping/${r.id}` : `#/mine/${r.id}`, r.role.startsWith("helper") ? "You're helping" : "Your request")).join("")
      : `<p class="empty">Nothing booked yet. When someone accepts your request, or you're approved to help, it shows up here.</p>`;
  };
  const track = role => snap => {
    for (const [k, v] of involved) if (v.role === role) involved.delete(k);
    snap.docs.forEach(d => involved.set(d.id, { id: d.id, data: d.data(), role }));
    renderUpcoming();
  };
  listen(query(collection(db, "requests"), where("requesterId", "==", uid)), snap => {
    track("requester")(snap);
    const mine = snap.docs.map(d => ({ id: d.id, data: d.data() }))
      .sort((a, b) => (toDate(b.data.createdAt)?.getTime() ?? 0) - (toDate(a.data.createdAt)?.getTime() ?? 0));
    const box = document.getElementById("home-mine");
    if (box) box.innerHTML = mine.length ? mine.slice(0, 5).map(r => requestRow(r.id, r.data, `#/mine/${r.id}`)).join("")
      : `<p class="empty">You haven't asked for help yet. <a href="#/new">Post your first request</a>.</p>`;
  });
  listen(query(collection(db, "requests"), where("acceptedBy", "==", uid)), track("helper"));
  listen(query(collection(db, "requests"), where("pendingHelperId", "==", uid)), track("helper-pending"));

  listen(query(collection(db, "requests"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(60)), snap => {
    const areaKey = area.toLowerCase();
    const open = snap.docs.map(d => ({ id: d.id, data: d.data() }))
      .filter(r => r.data.requesterId !== uid && !state.blocked.has(r.data.requesterId))
      .filter(r => !areaKey || String(r.data.area || "").toLowerCase().includes(areaKey));
    const box = document.getElementById("nearby");
    if (box) box.innerHTML = open.length ? open.slice(0, 5).map(r => requestRow(r.id, r.data, `#/requests/${r.id}`)).join("")
      : `<p class="empty">No open requests${area ? ` in ${escapeHtml(area)}` : ""} right now. <a href="#/requests">Look further afield</a>.</p>`;
  }, () => { const box = document.getElementById("nearby"); if (box) box.innerHTML = `<p class="empty">Couldn't load requests.</p>`; });

  listen(query(collection(db, "chats"), where("participantIds", "array-contains", uid), orderBy("lastMessageAt", "desc"), limit(5)), snap => {
    const box = document.getElementById("home-chats");
    if (!box) return;
    const chats = snap.docs.filter(d => !(d.data().archivedBy || []).includes(uid));
    box.innerHTML = chats.length ? chats.map(d => chatRow(d.id, d.data())).join("")
      : `<p class="empty">No chats yet. A chat opens once an admin approves a connection.</p>`;
  }, () => { const box = document.getElementById("home-chats"); if (box) box.innerHTML = `<p class="empty">Couldn't load chats.</p>`; });
}

function requestRow(id, data, href, note = "") {
  const start = requestStart(data);
  return `<a class="row-item" href="${href}">
    <div class="row-main"><strong>${escapeHtml(data.title || "Seva request")}</strong>
      <small>${escapeHtml([note, data.area, friendlyDay(start)].filter(Boolean).join(" · "))}</small></div>
    ${statusPill(data.status)}
  </a>`;
}
function chatRow(id, data) {
  const when = toDate(data.lastMessageAt);
  const mineLast = data.lastMessageSenderId === state.user.uid;
  const last = data.lastMessage ? `${mineLast ? "You: " : ""}${data.lastMessage}` : "No messages yet";
  return `<a class="row-item" href="#/chats/${encodeURIComponent(id)}">
    <div class="row-main"><strong>${escapeHtml(data.type === "support" ? "SayVah Support" : data.title || "Chat")}</strong><small>${escapeHtml(last)}</small></div>
    <span class="muted small">${when ? escapeHtml(friendlyDay(when).split(", ")[0]) : ""}</span>
  </a>`;
}

/* ---------- Find requests ---------- */

function viewBrowse(main, selectedId) {
  document.title = "Find requests | SayVah";
  const area = pickFirstString(state.profile, ["area", "locationName", "location"]);
  main.innerHTML = `
    <div class="split ${selectedId ? "has-detail" : ""}">
      <section class="list-pane">
        <header class="pane-head">
          <h1>Find requests</h1>
          <div class="filters">
            <input id="f-search" type="search" placeholder="Search requests" aria-label="Search requests" />
            <div class="chips" role="group" aria-label="Filter">
              <button class="chip active" data-f="all">All</button>
              <button class="chip" data-f="In Person">In person</button>
              <button class="chip" data-f="Online">Online</button>
              <button class="chip" data-f="Urgent">Urgent</button>
              ${area ? `<button class="chip" data-f="area" aria-pressed="false">Only ${escapeHtml(area)}</button>` : ""}
            </div>
          </div>
        </header>
        <div id="browse-list" class="list"><p class="muted pad">Loading requests…</p></div>
      </section>
      <section class="detail-pane" id="detail"></section>
    </div>`;

  let docs = [];
  let filter = "all", areaOnly = false, search = "";
  const listEl = document.getElementById("browse-list");
  const draw = () => {
    const areaKey = area.toLowerCase();
    const rows = docs.filter(d => !state.blocked.has(d.data.requesterId))
      .filter(d => filter === "all" || (filter === "Urgent" ? (d.data.tags || []).includes("Urgent") : d.data.serviceType === filter))
      .filter(d => !areaOnly || String(d.data.area || "").toLowerCase().includes(areaKey))
      .filter(d => !search || `${d.data.title} ${d.data.description} ${d.data.area} ${(d.data.tags || []).join(" ")}`.toLowerCase().includes(search));
    listEl.innerHTML = rows.length ? rows.map(d => browseItem(d.id, d.data, d.id === selectedId)).join("")
      : `<p class="empty pad">No open requests match. Try another filter.</p>`;
  };
  main.querySelectorAll(".chip").forEach(chip => chip.addEventListener("click", () => {
    if (chip.dataset.f === "area") { areaOnly = !areaOnly; chip.classList.toggle("active", areaOnly); }
    else { filter = chip.dataset.f; main.querySelectorAll('.chip:not([data-f="area"])').forEach(c => c.classList.toggle("active", c === chip)); }
    draw();
  }));
  document.getElementById("f-search").addEventListener("input", e => { search = e.target.value.trim().toLowerCase(); draw(); });

  listen(query(collection(db, "requests"), where("status", "==", "open"), orderBy("createdAt", "desc")), snap => {
    docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    draw();
  }, () => { listEl.innerHTML = `<p class="empty pad">Couldn't load requests. Refresh to try again.</p>`; });

  const detail = document.getElementById("detail");
  if (!selectedId) { detail.innerHTML = `<div class="detail-empty"><p>Pick a request to see the details and offer to help.</p></div>`; return; }
  listen(doc(db, "requests", selectedId), snap => renderRequestDetail(detail, snap, "browse"),
    () => { detail.innerHTML = `<div class="detail-empty"><p>Couldn't load this request.</p></div>`; });
}

function browseItem(id, data, active) {
  const start = requestStart(data);
  const mine = data.requesterId === state.user.uid;
  return `<a class="list-item ${active ? "active" : ""}" href="#/requests/${id}">
    ${data.requestPhotoUrl ? `<img src="${escapeHtml(data.requestPhotoUrl)}" alt="" loading="lazy" />` : `<span class="thumb"></span>`}
    <div class="row-main">
      <strong>${escapeHtml(data.title || "Seva request")}</strong>
      <small>${escapeHtml([data.area, data.postcodeArea, data.serviceType].filter(Boolean).join(" · "))}</small>
      <small>${escapeHtml(friendlyDay(start))}${mine ? " · Your request" : ""}</small>
    </div>
    ${(data.tags || []).includes("Urgent") ? `<span class="pill status-pending">Urgent</span>` : ""}
  </a>`;
}

async function renderRequestDetail(detail, snap, mode) {
  if (!snap.exists()) { detail.innerHTML = `<div class="detail-empty"><p>This request has been removed.</p></div>`; return; }
  const id = snap.id;
  const data = snap.data();
  const uid = state.user.uid;
  const isMine = data.requesterId === uid;
  const slots = slotsFromRequest(data);
  const backHref = mode === "browse" ? "#/requests" : mode === "mine" ? "#/mine" : "#/helping";
  const requester = data.isAnonymous && !isMine ? "Anonymous member" : await userName(data.requesterId);

  let actions = "";
  if (mode === "browse") {
    if (isMine) actions = `<p class="notice">This is your request. Manage it under <a href="#/mine/${id}">My requests</a>.</p>`;
    else if (data.status !== "open") actions = `<p class="notice">This request isn't open any more.</p>`;
    else {
      const blocker = profileNotice("help");
      actions = blocker || `
        <form id="offer-form" class="offer">
          <h3>Offer to help</h3>
          <p class="muted small">Pick a time that suits you. An admin checks every connection before you can chat or meet.</p>
          <div class="slot-list">
            ${slots.length ? slots.map((s, i) => `<label class="slot"><input type="radio" name="slot" value="${escapeHtml(s.id)}" ${i === 0 ? "checked" : ""} /><span>${escapeHtml(formatRange(s.startAt, s.endAt))}</span></label>`).join("")
              : `<p class="muted small">No time was given for this request.</p>`}
          </div>
          <button class="btn btn-gold" type="submit" ${slots.length ? "" : "disabled"}>Offer to help</button>
          <p class="form-msg" id="offer-msg" role="alert"></p>
        </form>`;
    }
  } else if (mode === "helping") {
    actions = data.status === "pending_admin_approval" && data.pendingHelperId === uid
      ? `<p class="notice notice-warn">You've offered to help. A SayVah admin is checking the connection; you'll be able to chat once it's approved.</p>`
      : ["accepted", "active", "in_progress"].includes(data.status) && data.acceptedBy === uid
        ? `<div class="row"><a class="btn btn-surface" href="#/chats" data-chat-for="${id}">${icon("chat")} Open chat</a><button class="btn btn-gold" id="complete-btn">Mark as completed</button></div>`
        : data.status === "completed" ? `<p class="notice notice-ok">Seva completed. Thank you.</p>` : "";
  } else if (mode === "mine") {
    actions = {
      open: `<p class="notice">Waiting for a sevadaar to offer help. You'll see it here as soon as someone does.</p>`,
      pending_admin_approval: `<p class="notice notice-warn">A sevadaar has offered to help. For everyone's safety, an admin approves the connection before you can chat.</p>`,
      accepted: `<div class="row"><a class="btn btn-surface" href="#/chats" data-chat-for="${id}">${icon("chat")} Open chat</a></div>`,
      completed: `<p class="notice notice-ok">This request is complete.</p>`,
      rejected: `<p class="notice">This connection wasn't approved. Contact SayVah Support if you have questions.</p>`
    }[data.status] || "";
  }

  let privateBlock = "";
  if (isMine || data.acceptedBy === uid) {
    try {
      const loc = (await getDoc(doc(db, "requests", id, "private", "location"))).data() || {};
      const lines = [loc.locationName, loc.locationAddress, loc.postcode].filter(Boolean);
      if (lines.length || loc.locationNotes) privateBlock = `<div class="kv"><span>Exact location</span><p>${escapeHtml(lines.join(", "))}${loc.locationNotes ? `<br><small class="muted">${escapeHtml(loc.locationNotes)}</small>` : ""}</p></div>`;
    } catch { /* only participants can read it */ }
  }

  detail.innerHTML = `
    <article class="request">
      <a class="back" href="${backHref}">${icon("back")} Back</a>
      ${data.requestPhotoUrl ? `<img class="request-photo" src="${escapeHtml(data.requestPhotoUrl)}" alt="Photo for this request" />` : ""}
      <div class="request-head">${statusPill(data.status)}${(data.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      <h2>${escapeHtml(data.title || "Seva request")}</h2>
      <p class="request-desc">${escapeHtml(data.description || "")}</p>
      <div class="kvs">
        <div class="kv"><span>Asked by</span><p>${escapeHtml(requester)}</p></div>
        <div class="kv"><span>Where</span><p>${escapeHtml([data.area, data.postcodeArea].filter(Boolean).join(", ") || "Not given")} · ${escapeHtml(data.serviceType || "")}</p></div>
        <div class="kv"><span>${data.confirmedStartAt ? "Agreed time" : "Suggested times"}</span><p>${data.confirmedStartAt ? escapeHtml(formatRange(toDate(data.confirmedStartAt), toDate(data.confirmedEndAt))) : slots.map(s => escapeHtml(formatRange(s.startAt, s.endAt))).join("<br>") || "Not given"}</p></div>
        ${privateBlock}
      </div>
      ${actions}
    </article>`;

  detail.querySelectorAll("[data-chat-for]").forEach(a => a.addEventListener("click", async e => {
    e.preventDefault();
    const snapChats = await getDocs(query(collection(db, "chats"), where("participantIds", "array-contains", uid)));
    const chat = snapChats.docs.find(d => d.data().requestId === id);
    location.hash = chat ? `#/chats/${encodeURIComponent(chat.id)}` : "#/chats";
  }));
  detail.querySelector("#offer-form")?.addEventListener("submit", e => offerHelp(e, id, data, slots));
  detail.querySelector("#complete-btn")?.addEventListener("click", () => completeSeva(id, data));
}

// Mirrors SevaRequestsScreen.acceptRequest in the app.
async function offerHelp(event, requestId, shown, slots) {
  event.preventDefault();
  const form = event.currentTarget;
  const msg = form.querySelector("#offer-msg");
  const button = form.querySelector("button[type=submit]");
  const slot = slots.find(s => s.id === form.querySelector("input[name=slot]:checked")?.value);
  if (!slot) { msg.textContent = "Pick a time first."; return; }
  if (!confirm(`Offer to help with "${shown.title || "this request"}" on ${formatRange(slot.startAt, slot.endAt)}?`)) return;
  button.disabled = true; button.textContent = "Sending…"; msg.textContent = "";
  const uid = state.user.uid;
  const requestRef = doc(db, "requests", requestId);
  const connectionRef = doc(collection(db, "help_connections"));
  try {
    await runTransaction(db, async tx => {
      const reqSnap = await tx.get(requestRef);
      const helperSnap = await tx.get(doc(db, "users", uid));
      if (!reqSnap.exists()) throw new Error("This request no longer exists.");
      const data = reqSnap.data();
      if (!canProvideSeva(helperSnap.data() || {})) throw new Error("Complete your profile and verification before offering help.");
      const status = String(data.status || "");
      const requesterId = String(data.requesterId || "");
      const rawTitle = String(data.title || "").trim();
      const safeTitle = (shown.title || "").trim() || rawTitle || "Seva request";
      if (!requesterId) throw new Error("This request is missing requester information.");
      if (requesterId === uid) throw new Error("You cannot offer help on your own request.");
      if (status === "pending_admin_approval") throw new Error("This request is already waiting for admin approval.");
      if (status === "accepted") throw new Error("This request has already been accepted.");
      if (status !== "open") throw new Error("This request is no longer open.");
      const start = Timestamp.fromDate(slot.startAt);
      const end = Timestamp.fromDate(slot.endAt);
      tx.update(requestRef, {
        status: "pending_admin_approval",
        pendingHelperId: uid,
        pendingConnectionId: connectionRef.id,
        pendingApprovalAt: serverTimestamp(),
        confirmedStartAt: start,
        confirmedEndAt: end,
        confirmedTimeSlotId: slot.id
      });
      tx.set(connectionRef, {
        requestId,
        requestTitle: safeTitle,
        description: String(data.description || ""),
        requestPhotoUrl: String(data.requestPhotoUrl || ""),
        requestPhotoStoragePath: String(data.requestPhotoStoragePath || ""),
        requesterId,
        helperId: uid,
        participantIds: [requesterId, uid],
        status: "pending_admin_approval",
        adminApproved: false,
        approvedAt: null,
        approvedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        chatId: null,
        sessionId: null,
        locationSessionId: null,
        serviceType: String(data.serviceType ?? "Not specified"),
        timeFrame: String(data.timeFrame ?? "Not specified"),
        area: String(data.area ?? "Unknown area"),
        dateNeeded: data.dateNeeded ?? null,
        confirmedStartAt: start,
        confirmedEndAt: end,
        confirmedTimeSlotId: slot.id,
        proposedTimeSlots: data.proposedTimeSlots ?? [],
        tags: Array.isArray(data.tags) ? data.tags : [],
        locationName: String(data.locationName ?? ""),
        locationAddress: String(data.locationAddress ?? ""),
        postcode: String(data.postcode ?? ""),
        locationNotes: String(data.locationNotes ?? ""),
        createdAt: serverTimestamp(),
        createdBy: uid
      });
    });
    toast("Offer sent. An admin will check it before you're connected.", "ok");
    location.hash = `#/helping/${requestId}`;
  } catch (err) {
    msg.textContent = friendlyError(err);
    button.disabled = false; button.textContent = "Offer to help";
  }
}

/* ---------- My requests & Helping ---------- */

function viewMine(main, selectedId) { listAndDetail(main, selectedId, "mine"); }
function viewHelping(main, selectedId) { listAndDetail(main, selectedId, "helping"); }

function listAndDetail(main, selectedId, mode) {
  const uid = state.user.uid;
  const isMine = mode === "mine";
  document.title = `${isMine ? "My requests" : "Helping"} | SayVah`;
  main.innerHTML = `
    <div class="split ${selectedId ? "has-detail" : ""}">
      <section class="list-pane">
        <header class="pane-head">
          <h1>${isMine ? "My requests" : "Helping"}</h1>
          ${isMine ? `<a class="btn btn-gold btn-small" href="#/new">${icon("plus")} New request</a>` : `<a class="btn btn-surface btn-small" href="#/requests">${icon("search")} Find requests</a>`}
        </header>
        <div id="ld-list" class="list"><p class="muted pad">Loading…</p></div>
      </section>
      <section class="detail-pane" id="detail"></section>
    </div>`;
  const listEl = document.getElementById("ld-list");
  const order = { pending_admin_approval: 0, accepted: 1, active: 1, in_progress: 1, open: 2, completed: 3 };
  const sets = new Map();
  const draw = () => {
    const rows = [...sets.values()].flat()
      .filter((r, i, all) => all.findIndex(x => x.id === r.id) === i)
      .sort((a, b) => (order[a.data.status] ?? 4) - (order[b.data.status] ?? 4) || (toDate(b.data.createdAt)?.getTime() ?? 0) - (toDate(a.data.createdAt)?.getTime() ?? 0));
    listEl.innerHTML = rows.length ? rows.map(r => `<a class="list-item ${r.id === selectedId ? "active" : ""}" href="#/${mode}/${r.id}">
        ${r.data.requestPhotoUrl ? `<img src="${escapeHtml(r.data.requestPhotoUrl)}" alt="" loading="lazy" />` : `<span class="thumb"></span>`}
        <div class="row-main"><strong>${escapeHtml(r.data.title || "Seva request")}</strong><small>${escapeHtml(friendlyDay(requestStart(r.data)))}</small></div>
        ${statusPill(r.data.status)}</a>`).join("")
      : `<p class="empty pad">${isMine ? `You haven't posted any requests yet. <a href="#/new">Ask for help</a>.` : `You're not helping with anything yet. <a href="#/requests">Find a request</a>.`}</p>`;
  };
  const sub = key => q => listen(q, snap => { sets.set(key, snap.docs.map(d => ({ id: d.id, data: d.data() }))); draw(); },
    () => { listEl.innerHTML = `<p class="empty pad">Couldn't load this list.</p>`; });
  if (isMine) sub("mine")(query(collection(db, "requests"), where("requesterId", "==", uid)));
  else {
    sub("accepted")(query(collection(db, "requests"), where("acceptedBy", "==", uid)));
    sub("pending")(query(collection(db, "requests"), where("pendingHelperId", "==", uid)));
  }
  const detail = document.getElementById("detail");
  if (!selectedId) { detail.innerHTML = `<div class="detail-empty"><p>${isMine ? "Pick one of your requests to see where it's up to." : "Pick a request to see the details."}</p></div>`; return; }
  listen(doc(db, "requests", selectedId), snap => renderRequestDetail(detail, snap, mode),
    () => { detail.innerHTML = `<div class="detail-empty"><p>Couldn't load this request.</p></div>`; });
}

// Mirrors the helper's "mark completed" in MyAcceptedRequestsScreen.
function completeSeva(requestId, data) {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.innerHTML = `
    <form method="dialog" id="rate-form">
      <h2>Mark as completed</h2>
      <p class="muted">How did it go? Your rating helps keep SayVah safe.</p>
      <div class="stars" role="radiogroup" aria-label="Rating">
        ${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="rating" value="${n}" ${n === 5 ? "checked" : ""} /><span>${n}</span></label>`).join("")}
      </div>
      <label class="field"><span>Anything to add? (optional)</span><textarea name="comment" rows="3" maxlength="300"></textarea></label>
      <p class="form-msg" id="rate-msg" role="alert"></p>
      <div class="row end"><button class="btn btn-line" value="cancel">Cancel</button><button class="btn btn-gold" id="rate-submit" value="ok">Mark completed</button></div>
    </form>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("#rate-submit").addEventListener("click", async e => {
    e.preventDefault();
    const btn = e.currentTarget;
    const form = dialog.querySelector("#rate-form");
    const rating = Number(new FormData(form).get("rating"));
    const comment = String(new FormData(form).get("comment") || "").trim();
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const uid = state.user.uid;
      await updateDoc(doc(db, "requests", requestId), {
        status: "completed", completedAt: serverTimestamp(), completedBy: uid, helperRatingSubmitted: true
      });
      await setDoc(doc(db, "ratings", `${requestId}_${uid}`), {
        requestId, fromUserId: uid, toUserId: String(data.requesterId || ""), rating, comment,
        type: "helper_to_requester", createdAt: serverTimestamp()
      });
      dialog.close();
      toast("Seva marked as completed. Thank you.", "ok");
    } catch (err) {
      dialog.querySelector("#rate-msg").textContent = friendlyError(err);
      btn.disabled = false; btn.textContent = "Mark completed";
    }
  });
}

/* ---------- New request ---------- */

function toLocalInput(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function viewNewRequest(main) {
  document.title = "New request | SayVah";
  const p = state.profile || {};
  const blocker = profileNotice("request");
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
  main.innerHTML = `
    <div class="form-page">
      <header class="page-head"><div><a class="back" href="#/mine">${icon("back")} My requests</a><h1>Ask for help</h1>
        <p class="muted">Describe what you need. Only your area and the first part of your postcode are shown to other members; your exact address is only shared with the sevadaar an admin approves.</p></div></header>
      ${blocker}
      <form id="new-form" class="new-form" novalidate ${blocker ? "inert" : ""}>
        <section class="panel">
          <h2>What do you need?</h2>
          <label class="field"><span>Title</span><input name="title" maxlength="80" required placeholder="e.g. Lift to the Gurdwara on Sunday" /></label>
          <label class="field"><span>Description</span><textarea name="description" rows="4" required placeholder="What needs doing, anything the helper should know"></textarea></label>
          <fieldset class="field"><legend>Type of help</legend><div class="chips">${REQUEST_TAGS.map(t => `<label class="chip-check"><input type="checkbox" name="tags" value="${t}" /><span>${t}</span></label>`).join("")}</div></fieldset>
          <fieldset class="field"><legend>In person or online?</legend><div class="chips">${SERVICE_TYPES.map((t, i) => `<label class="chip-check"><input type="radio" name="serviceType" value="${t}" ${i === 0 ? "checked" : ""} /><span>${t}</span></label>`).join("")}</div></fieldset>
        </section>
        <section class="panel">
          <h2>Where?</h2>
          <div class="grid2">
            <label class="field"><span>Area or town</span><input name="area" required value="${escapeHtml(pickFirstString(p, ["area", "locationName", "location"]))}" /></label>
            <label class="field"><span>Place name <small class="muted">(optional)</small></span><input name="locationName" placeholder="e.g. Home, Tesco Camberley" /></label>
            <label class="field in-person"><span>Address</span><input name="locationAddress" autocomplete="street-address" /></label>
            <label class="field in-person"><span>Postcode</span><input name="postcode" autocomplete="postal-code" /></label>
          </div>
          <label class="field"><span>Notes for the helper <small class="muted">(optional, private)</small></span><textarea name="locationNotes" rows="2" maxlength="500"></textarea></label>
        </section>
        <section class="panel">
          <h2>When?</h2>
          <p class="muted small">Suggest up to 4 times. The sevadaar picks one that works for them.</p>
          <div id="slots" class="stack"></div>
          <button type="button" class="btn btn-line btn-small" id="add-slot">${icon("plus")} Add another time</button>
        </section>
        <section class="panel">
          <h2>Photo</h2>
          <p class="muted small">Every request needs a photo, so helpers can see what's involved.</p>
          <label class="photo-drop"><input type="file" name="photo" accept="image/*" required /><span id="photo-label">Choose a photo</span><span id="photo-preview" class="photo-preview"></span></label>
          <label class="check"><input type="checkbox" name="isAnonymous" /><span>Hide my name from other members on this request</span></label>
        </section>
        <div class="submit-bar">
          <p class="form-msg" id="new-msg" role="alert"></p>
          <button class="btn btn-gold" type="submit" id="new-submit">Post request</button>
        </div>
      </form>
    </div>`;

  const form = document.getElementById("new-form");
  const slotsEl = document.getElementById("slots");
  const addSlot = (start = tomorrow) => {
    if (slotsEl.children.length >= 4) return;
    const end = new Date(start.getTime() + 3600000);
    const row = document.createElement("div");
    row.className = "slot-row";
    row.innerHTML = `<label class="field"><span>Starts</span><input type="datetime-local" class="s-start" value="${toLocalInput(start)}" /></label>
      <label class="field"><span>Ends</span><input type="datetime-local" class="s-end" value="${toLocalInput(end)}" /></label>
      <button type="button" class="link-button remove-slot">Remove</button>`;
    row.querySelector(".remove-slot").onclick = () => { if (slotsEl.children.length > 1) row.remove(); };
    row.querySelector(".s-start").addEventListener("change", e => {
      const s = new Date(e.target.value);
      if (!isNaN(s)) row.querySelector(".s-end").value = toLocalInput(new Date(s.getTime() + 3600000));
    });
    slotsEl.append(row);
  };
  addSlot();
  document.getElementById("add-slot").onclick = () => addSlot(new Date(tomorrow.getTime() + slotsEl.children.length * 86400000));

  const inPerson = () => form.serviceType.value === "In Person";
  const syncType = () => form.querySelectorAll(".in-person").forEach(el => el.hidden = !inPerson());
  form.querySelectorAll("input[name=serviceType]").forEach(r => r.addEventListener("change", syncType));
  syncType();

  const photoInput = form.photo;
  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];
    const preview = document.getElementById("photo-preview");
    preview.innerHTML = "";
    if (!file) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.alt = "Your chosen photo";
    preview.append(img);
    document.getElementById("photo-label").textContent = file.name;
  });

  form.addEventListener("submit", e => submitRequest(e, form));
}

// Mirrors CreateRequestScreen.postRequest in the app.
async function submitRequest(event, form) {
  event.preventDefault();
  const msg = document.getElementById("new-msg");
  const button = document.getElementById("new-submit");
  const val = name => String(form[name]?.value || "").trim();
  const title = val("title"), description = val("description"), area = val("area");
  const serviceType = form.serviceType.value;
  const tags = [...form.querySelectorAll("input[name=tags]:checked")].map(i => i.value);
  const file = form.photo.files[0];
  msg.textContent = "";

  if (!title || !description || !area) { msg.textContent = "Please fill in the title, description and area."; return; }
  const slots = [...document.querySelectorAll(".slot-row")].map((row, i) => ({
    id: `slot_${Date.now()}_${i}`,
    startAt: new Date(row.querySelector(".s-start").value),
    endAt: new Date(row.querySelector(".s-end").value)
  }));
  const now = new Date(), seen = new Set();
  for (const s of slots) {
    if (isNaN(s.startAt) || isNaN(s.endAt)) { msg.textContent = "Fill in a start and end for each time."; return; }
    if (s.startAt <= now) { msg.textContent = "Each start time must be in the future."; return; }
    if (s.endAt <= s.startAt) { msg.textContent = "Each end time must be after the start time."; return; }
    const key = `${s.startAt.toISOString()}_${s.endAt.toISOString()}`;
    if (seen.has(key)) { msg.textContent = "Remove duplicate times."; return; }
    seen.add(key);
  }
  if (!slots.length) { msg.textContent = "Add at least one time."; return; }
  if (!file) { msg.textContent = "Please add a photo of what you need help with."; return; }
  if (!file.type.startsWith("image/")) { msg.textContent = "The photo needs to be an image file."; return; }
  if (file.size >= 10 * 1024 * 1024) { msg.textContent = "That photo is too big. Please use one under 10 MB."; return; }
  if (serviceType === "In Person" && (!val("locationAddress") || !val("postcode"))) { msg.textContent = "Please add an address and postcode for in-person help."; return; }
  if (!confirm(`Post "${title}"?\n\nOther members will see the title, description, photo, ${area} and your suggested times.`)) return;

  button.disabled = true; button.textContent = "Posting…";
  try {
    const uid = state.user.uid;
    const fresh = (await getDoc(doc(db, "users", uid))).data() || {};
    if (!canRequestSeva(fresh)) throw new Error("Complete your profile and verification before you can request Seva.");

    const requestRef = doc(collection(db, "requests"));
    const storagePath = `request_images/${requestRef.id}/request_${Date.now()}.jpg`;
    const uploaded = await uploadBytes(storageRef(storage, storagePath), file, {
      contentType: file.type || "image/jpeg",
      customMetadata: { requestId: requestRef.id, ownerId: uid }
    });
    const requestPhotoUrl = await getDownloadURL(uploaded.ref);
    const first = slots[0];

    await setDoc(requestRef, {
      title, description, area,
      postcodeArea: outwardCode(val("postcode")),
      tags,
      dateNeeded: Timestamp.fromDate(first.startAt),
      timeFrame: formatRange(first.startAt, first.endAt),
      proposedTimeSlots: slots.map(s => ({ id: s.id, startAt: Timestamp.fromDate(s.startAt), endAt: Timestamp.fromDate(s.endAt) })),
      serviceType,
      status: "open",
      createdAt: serverTimestamp(),
      requesterId: uid,
      isAnonymous: form.isAnonymous.checked,
      requestPhotoUrl,
      requestPhotoStoragePath: storagePath,
      onBehalfOf: false
    });
    await setDoc(doc(db, "requests", requestRef.id, "private", "location"), {
      locationName: val("locationName"),
      locationAddress: val("locationAddress"),
      postcode: val("postcode"),
      locationNotes: val("locationNotes"),
      updatedAt: serverTimestamp()
    });
    toast("Request posted. Local sevadaars can see it now.", "ok");
    location.hash = `#/mine/${requestRef.id}`;
  } catch (err) {
    msg.textContent = friendlyError(err);
    button.disabled = false; button.textContent = "Post request";
  }
}

/* ---------- Chats ---------- */

function viewChats(main, selectedId) {
  document.title = "Chats | SayVah";
  const uid = state.user.uid;
  main.innerHTML = `
    <div class="split chats ${selectedId ? "has-detail" : ""}">
      <section class="list-pane">
        <header class="pane-head"><h1>Chats</h1><button class="btn btn-surface btn-small" id="support-btn">Message SayVah Support</button></header>
        <div id="chat-list" class="list"><p class="muted pad">Loading chats…</p></div>
      </section>
      <section class="detail-pane chat-pane" id="detail"></section>
    </div>`;
  const listEl = document.getElementById("chat-list");
  listen(query(collection(db, "chats"), where("participantIds", "array-contains", uid), orderBy("lastMessageAt", "desc")), snap => {
    const chats = snap.docs.filter(d => !(d.data().archivedBy || []).includes(uid));
    listEl.innerHTML = chats.length ? chats.map(d => chatRow(d.id, d.data()).replace('class="row-item"', `class="row-item ${d.id === selectedId ? "active" : ""}"`)).join("")
      : `<p class="empty pad">No chats yet. A chat opens once an admin approves a connection between you and someone else.</p>`;
  }, () => { listEl.innerHTML = `<p class="empty pad">Couldn't load chats.</p>`; });

  document.getElementById("support-btn").onclick = async () => {
    try {
      const id = `support_${uid}`;
      await setDoc(doc(db, "chats", id), {
        type: "support", title: "SayVah Support",
        description: "Need help with SayVah? Message the SayVah team directly.",
        supportUserId: uid, participantIds: [uid, "support_team"], requestId: null,
        createdBy: uid, updatedAt: serverTimestamp()
      }, { merge: true });
      location.hash = `#/chats/${encodeURIComponent(id)}`;
    } catch (err) { toast(friendlyError(err), "err"); }
  };

  const detail = document.getElementById("detail");
  if (!selectedId) { detail.innerHTML = `<div class="detail-empty"><p>Pick a chat to read and reply.</p></div>`; return; }
  openChat(detail, selectedId);
}

async function openChat(detail, chatId) {
  const uid = state.user.uid;
  detail.innerHTML = `
    <header class="chat-head"><a class="back" href="#/chats">${icon("back")}</a><div><strong id="chat-title">Chat</strong><small id="chat-sub" class="muted"></small></div></header>
    <div class="gate" id="chat-gate" hidden></div>
    <div class="messages" id="messages"><p class="muted pad">Loading messages…</p></div>
    <form class="composer" id="composer">
      <textarea id="msg-input" rows="1" placeholder="Write a message" aria-label="Message"></textarea>
      <button class="btn btn-gold" type="submit" aria-label="Send">${icon("send")}</button>
    </form>`;
  let unlocked = true;
  listen(doc(db, "chats", chatId), async snap => {
    const data = snap.data() || {};
    document.getElementById("chat-title").textContent = data.type === "support" ? "SayVah Support" : data.title || "Chat";
    const others = (data.participantIds || []).filter(p => p !== uid);
    if (data.type !== "support" && others[0]) userName(others[0]).then(n => { const s = document.getElementById("chat-sub"); if (s) s.textContent = `with ${n}`; });
    if (data.requestId) {
      try {
        const req = (await getDoc(doc(db, "requests", data.requestId))).data() || {};
        const status = String(req.status || "").toLowerCase();
        unlocked = status === "accepted" || status === "completed";
        const gate = document.getElementById("chat-gate");
        if (gate) {
          gate.hidden = unlocked;
          gate.innerHTML = `${icon("lock")} <span>This chat unlocks once a SayVah admin approves the connection.</span>`;
        }
        document.getElementById("composer")?.classList.toggle("locked", !unlocked);
      } catch { unlocked = false; }
    }
  }, () => { detail.innerHTML = `<div class="detail-empty"><p>You don't have access to this chat.</p></div>`; });

  const messagesEl = document.getElementById("messages");
  listen(query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc")), snap => {
    let lastDay = "";
    messagesEl.innerHTML = snap.docs.length ? snap.docs.map(d => {
      const m = d.data();
      const when = toDate(m.createdAt);
      const day = when ? when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";
      const divider = day && day !== lastDay ? `<div class="day">${escapeHtml(day)}</div>` : "";
      lastDay = day || lastDay;
      if (m.type && m.type !== "text") return `${divider}<p class="system">${escapeHtml(m.text || "Update")}</p>`;
      const mine = m.senderId === uid;
      return `${divider}<div class="bubble ${mine ? "mine" : ""}"><p>${escapeHtml(m.text || "")}</p><time>${escapeHtml(formatTime(when))}</time></div>`;
    }).join("") : `<p class="empty pad">No messages yet. Say hello.</p>`;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }, () => { messagesEl.innerHTML = `<p class="empty pad">Couldn't load messages.</p>`; });

  const input = document.getElementById("msg-input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; });
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("composer").requestSubmit(); } });
  let sending = false;
  // Mirrors ChatScreen.sendMessage in the app.
  document.getElementById("composer").addEventListener("submit", async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    if (!unlocked) { toast("This chat is locked until an admin approves the connection.", "err"); return; }
    sending = true;
    const now = Timestamp.now();
    input.value = ""; input.style.height = "auto";
    try {
      await addDoc(collection(db, "chats", chatId, "messages"), { text, senderId: uid, createdAt: now, type: "text" });
      await setDoc(doc(db, "chats", chatId), { lastMessage: text, lastMessageSenderId: uid, lastMessageAt: now }, { merge: true });
    } catch (err) {
      input.value = text;
      toast(`Message not sent. ${friendlyError(err)}`, "err");
    } finally { sending = false; }
  });
}
