import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  addDoc,
  serverTimestamp,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC2gzxxVo1WEHr8_BynpuyvxVry0WwqV7Q",
  authDomain: "seva-app-b6a18.firebaseapp.com",
  projectId: "seva-app-b6a18",
  storageBucket: "seva-app-b6a18.firebasestorage.app",
  messagingSenderId: "1046020854100",
  appId: "1:1046020854100:web:eec028446676e8141178c1",
  measurementId: "G-5FBW6MM28K"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const COLLECTIONS = {
  users: "users",
  requests: "requests",
  chats: "chats",
  reports: "reports",
  ratings: "ratings",
  locations: "locations",
  gurdwaras: "gurdwaras",
  organisations: "organisations",
  helpConnections: "help_connections",
  sessions: "sessions",
  locationSessions: "location_sessions",
  launchSignups: "launchSignups",
  communityQuestions: "community_questions",
  trustProfiles: "trustProfiles",
  audit: "adminAuditLogs"
};

const navItems = [
  ["dashboard", "Dashboard", "◆"],
  ["current-seva", "Current Seva", "●"],
  ["requests", "Requests", "□"],
  ["users", "All Users", "U"],
  ["sevadaars", "Sevadaars", "V"],
  ["requesters", "Requesters", "R"],
  ["both", "Both Roles", "B"],
  ["verification", "Verification", "K"],
  ["chats", "Chats", "✉"],
  ["reports", "Reports & Safety", "!"],
  ["areas", "Areas", "⌖"],
  ["gurdwaras", "Gurdwaras", "⌂"],
  ["organisations", "Organisations", "◇"],
  ["launch", "Launch Signups", "+"],
  ["qa", "Community Q&A", "?"],
  ["system", "System", "⚙"]
];

const state = {
  user: null,
  adminProfile: null,
  page: "dashboard",
  cache: new Map(),
  filters: {}
};

const el = {
  authView: document.getElementById("auth-view"),
  adminApp: document.getElementById("admin-app"),
  loginForm: document.getElementById("login-form"),
  loginButton: document.getElementById("login-button"),
  authMessage: document.getElementById("auth-message"),
  deniedPanel: document.getElementById("denied-panel"),
  deniedSignout: document.getElementById("denied-signout"),
  nav: document.getElementById("admin-nav"),
  content: document.getElementById("content"),
  pageTitle: document.getElementById("page-title"),
  signedInAs: document.getElementById("signed-in-as"),
  signout: document.getElementById("signout-button"),
  menuButton: document.getElementById("menu-button"),
  sidebar: document.getElementById("sidebar"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  detailModal: document.getElementById("detail-modal"),
  modalContent: document.getElementById("modal-content"),
  confirmModal: document.getElementById("confirm-modal"),
  confirmCopy: document.getElementById("confirm-copy"),
  confirmCancel: document.getElementById("confirm-cancel"),
  confirmSubmit: document.getElementById("confirm-submit")
};

await setPersistence(auth, browserLocalPersistence);
renderNav();
bindChrome();

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.adminProfile = null;
  state.cache.clear();
  if (!user) return showLogin();
  showAuthMessage("Checking admin access...", "");
  try {
    const profileSnap = await getDoc(doc(db, COLLECTIONS.users, user.uid));
    const profile = profileSnap.exists() ? { id: profileSnap.id, ...profileSnap.data() } : null;
    if (!profile || profile.role !== "admin") return showDenied();
    state.adminProfile = profile;
    showAdmin();
    await renderPage(state.page);
  } catch (error) {
    showDenied("Unable to verify admin access. Firestore rules may need the admin user read rule.");
    console.error("Admin verification failed", error);
  }
});

el.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.loginButton.disabled = true;
  el.loginButton.textContent = "Signing in...";
  showAuthMessage("Signing in...", "");
  const form = new FormData(el.loginForm);
  try {
    await signInWithEmailAndPassword(auth, String(form.get("email")).trim(), String(form.get("password")));
  } catch (error) {
    showAuthMessage(authError(error), "error");
  } finally {
    el.loginButton.disabled = false;
    el.loginButton.textContent = "Sign in";
  }
});

function bindChrome() {
  el.signout.addEventListener("click", () => signOut(auth));
  el.deniedSignout.addEventListener("click", () => signOut(auth));
  el.menuButton.addEventListener("click", () => toggleDrawer(true));
  el.drawerBackdrop.addEventListener("click", () => toggleDrawer(false));
  document.querySelectorAll("[data-close-modal]").forEach((node) => node.addEventListener("click", closeModal));
  el.confirmCancel.addEventListener("click", closeConfirm);
  document.querySelectorAll("[data-cancel-confirm]").forEach((node) => node.addEventListener("click", closeConfirm));
}

function renderNav() {
  el.nav.innerHTML = navItems.map(([id, label, icon]) => `<button class="nav-item" data-page="${id}" type="button"><span>${icon}</span>${label}</button>`).join("");
  el.nav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.page = button.dataset.page;
      toggleDrawer(false);
      renderPage(state.page);
    });
  });
}

async function renderPage(page) {
  const item = navItems.find(([id]) => id === page) || navItems[0];
  el.pageTitle.textContent = item[1];
  el.nav.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  setContent(loadingPanel(item[1]));
  try {
    if (page === "dashboard") return renderDashboard();
    if (page === "current-seva") return renderRequestsModule("current-seva");
    if (page === "requests") return renderRequestsModule("requests");
    if (page === "users") return renderUsersModule("users");
    if (page === "sevadaars") return renderUsersModule("sevadaars");
    if (page === "requesters") return renderUsersModule("requesters");
    if (page === "both") return renderUsersModule("both");
    if (page === "verification") return renderVerificationModule();
    if (page === "chats") return renderChats();
    if (page === "reports") return renderReports();
    if (page === "areas") return renderSimpleCollection("areas");
    if (page === "gurdwaras") return renderSimpleCollection("gurdwaras");
    if (page === "organisations") return renderSimpleCollection("organisations");
    if (page === "launch") return renderLaunchSignups();
    if (page === "qa") return renderCommunityQuestions();
    if (page === "system") return renderSystem();
  } catch (error) {
    setContent(errorPanel(error));
  }
}

async function renderDashboard() {
  const [users, requests, reports, locations, gurdwaras, organisations, launchSignups] = await Promise.all([
    safeGet(COLLECTIONS.users, ["createdAt", "desc"], 250),
    safeGet(COLLECTIONS.requests, ["createdAt", "desc"], 250),
    safeGet(COLLECTIONS.reports, ["createdAt", "desc"], 100),
    safeGet(COLLECTIONS.locations, ["name", "asc"], 100),
    safeGet(COLLECTIONS.gurdwaras, ["name", "asc"], 100),
    safeGet(COLLECTIONS.organisations, ["name", "asc"], 100),
    safeGet(COLLECTIONS.launchSignups, ["createdAt", "desc"], 100)
  ]);
  const userRows = users.rows;
  const requestRows = requests.rows;
  const stats = [
    ["Total users", users.count ?? userRows.length],
    ["Verified sevadaars", userRows.filter(isVerifiedSevadaar).length],
    ["Requesters", userRows.filter((u) => roleOf(u).includes("request")).length],
    ["Admins", userRows.filter((u) => u.role === "admin").length],
    ["Open requests", requestRows.filter((r) => statusGroup(r.status) === "open").length],
    ["Accepted / in progress", requestRows.filter((r) => statusGroup(r.status) === "active").length],
    ["Completed seva", requestRows.filter((r) => statusGroup(r.status) === "completed").length],
    ["Pending verification", userRows.filter((u) => verificationState(u) === "pending").length],
    ["Open reports", reports.rows.filter((r) => statusGroup(r.status) === "open").length],
    ["Active areas", locations.rows.filter((l) => l.active !== false).length],
    ["Gurdwaras", gurdwaras.count ?? gurdwaras.rows.length],
    ["Launch signups", launchSignups.count ?? launchSignups.rows.length]
  ];
  setContent(`
    <div class="stats-grid">${stats.map(([label, value]) => statCard(label, value)).join("")}</div>
    <section class="panel">
      <div class="panel-head"><h2>Recent activity</h2><span class="muted">Newest records from supported collections</span></div>
      <div class="record-grid">
        ${activityBlock("New users", userRows.slice(0, 5), displayName)}
        ${activityBlock("New requests", requestRows.slice(0, 5), requestTitle)}
        ${activityBlock("Reports", reports.rows.slice(0, 5), reportTitle)}
        ${activityBlock("Launch signups", launchSignups.rows.slice(0, 5), signupTitle)}
      </div>
    </section>
  `);
}

async function renderRequestsModule(kind) {
  const rows = (await safeGet(COLLECTIONS.requests, ["createdAt", "desc"], 200)).rows;
  const tab = state.filters[kind] || "all";
  const tabs = kind === "current-seva" ? ["open", "active", "completed", "closed", "all"] : ["all", "open", "active", "completed", "closed"];
  const filtered = tab === "all" ? rows : rows.filter((row) => statusGroup(row.status) === tab);
  setContent(`
    ${tabbar(kind, tabs, tab)}
    <section class="panel">
      <div class="panel-head"><h2>${kind === "current-seva" ? "Live operational seva" : "Requests"}</h2><span class="muted">${filtered.length} shown</span></div>
      ${requestTable(filtered)}
      ${cards(filtered, requestCard)}
    </section>
  `);
  bindTabs(kind);
  bindRecordClicks(rows, "request");
}

async function renderUsersModule(mode) {
  const key = mode;
  const useQuickTabs = true;
  let rows = (await safeGet(COLLECTIONS.users, ["createdAt", "desc"], 300)).rows;
  if (mode === "sevadaars") rows = rows.filter(isSevadaar);
  if (mode === "requesters") rows = rows.filter(isRequester);
  if (mode === "both") rows = rows.filter(isBothRole);
  const filters = state.filters[key] || {};
  const filtered = rows.filter((row) => filterUser(row, filters, useQuickTabs));
  setContent(`
    ${userToolbar(key, useQuickTabs)}
    <section class="panel">
      <div class="panel-head"><h2>${mode === "users" ? "All Users" : mode === "both" ? "Both Roles" : mode === "requesters" ? "Requesters" : "Sevadaars"}</h2><span class="muted">${filtered.length} shown</span></div>
      ${userTable(filtered)}
      ${cards(filtered, userCard)}
    </section>
  `);
  bindUserToolbar(key);
  bindRecordClicks(rows, "user");
}

async function renderVerificationModule() {
  const rows = (await safeGet(COLLECTIONS.users, ["createdAt", "desc"], 300)).rows;
  const tab = state.filters.verification || "pending";
  const filtered = tab === "all" ? rows : rows.filter((row) => verificationState(row) === tab);
  setContent(`
    ${tabbar("verification", ["pending", "verified", "denied", "unverified", "all"], tab)}
    <section class="panel">
      <div class="panel-head"><h2>Verification Hub</h2><span class="muted">${filtered.length} shown</span></div>
      ${userTable(filtered)}
      ${cards(filtered, userCard)}
    </section>
  `);
  bindTabs("verification");
  bindRecordClicks(rows, "user");
}
async function renderChats() {
  const rows = (await safeGet(COLLECTIONS.chats, ["updatedAt", "desc"], 150)).rows;
  setContent(`
    ${tabbar("chats", ["all", "personal", "community", "active", "archived"], state.filters.chats || "all")}
    <section class="panel">
      <div class="panel-head"><h2>Chat oversight</h2><span class="muted">Read-only moderation view</span></div>
      ${genericTable(filterChats(rows), ["Chat", "Participants", "Linked request", "Last activity"], chatCells)}
      ${cards(filterChats(rows), chatCard)}
    </section>
  `);
  bindTabs("chats");
  bindRecordClicks(rows, "chat");
}

async function renderReports() {
  const rows = (await safeGet(COLLECTIONS.reports, ["createdAt", "desc"], 150)).rows;
  const tab = state.filters.reports || "all";
  const filtered = tab === "all" ? rows : rows.filter((row) => statusGroup(row.status) === tab || String(row.status || "").toLowerCase() === tab);
  setContent(`
    ${tabbar("reports", ["open", "under review", "resolved", "dismissed", "all"], tab)}
    <section class="panel">
      <div class="panel-head"><h2>Reports & Safety</h2><span class="muted">${filtered.length} shown</span></div>
      ${genericTable(filtered, ["Report", "Reporter", "Reported", "Status", "Date"], reportCells)}
      ${cards(filtered, reportCard)}
    </section>
  `);
  bindTabs("reports");
  bindRecordClicks(rows, "report");
}

async function renderSimpleCollection(kind) {
  const map = {
    areas: [COLLECTIONS.locations, "Areas"],
    gurdwaras: [COLLECTIONS.gurdwaras, "Gurdwaras"],
    organisations: [COLLECTIONS.organisations, "Organisations"]
  };
  const [collectionName, title] = map[kind];
  const rows = (await safeGet(collectionName, ["name", "asc"], 150)).rows;
  setContent(`
    <section class="panel">
      <div class="panel-head"><h2>${title}</h2><span class="muted">${rows.length} records</span></div>
      ${genericTable(rows, ["Name", "Area / Location", "Status", "Admins", "Updated"], orgCells)}
      ${cards(rows, orgCard)}
    </section>
  `);
  bindRecordClicks(rows, kind === "areas" ? "area" : kind.slice(0, -1));
}

async function renderLaunchSignups() {
  const rows = (await safeGet(COLLECTIONS.launchSignups, ["createdAt", "desc"], 250)).rows;
  const tab = state.filters.launch || "All";
  const search = state.filters.launchSearch || "";
  const filtered = (tab === "All" ? rows : rows.filter((row) => row.interest === tab))
    .filter((row) => `${row.name || ""} ${row.email || ""} ${row.area || ""}`.toLowerCase().includes(search.toLowerCase()));
  setContent(`
    ${tabbar("launch", ["Volunteer / Sevadaar", "I may use SayVah for support", "Gurdwara / Organisation", "Keep me updated", "All"], tab)}
    <div class="toolbar"><input id="launch-search" value="${escapeAttr(search)}" placeholder="Search launch signups" /></div>
    <section class="panel">
      <div class="panel-head"><h2>Launch Signups</h2><span class="muted">${filtered.length} shown, newest first</span></div>
      ${genericTable(filtered, ["Name", "Email", "Area", "Interest", "Notification"], signupCells)}
      ${cards(filtered, signupCard)}
    </section>
  `);
  bindTabs("launch");
  document.getElementById("launch-search")?.addEventListener("input", (event) => {
    state.filters.launchSearch = event.target.value;
    renderPage(state.page);
  });
  bindCopyEmail();
}

async function renderCommunityQuestions() {
  const rows = (await safeGet(COLLECTIONS.communityQuestions, ["createdAt", "desc"], 150)).rows;
  setContent(`
    <section class="panel">
      <div class="panel-head"><h2>Community Q&A</h2><span class="muted">Read-only until schema-backed moderation is confirmed</span></div>
      ${genericTable(rows, ["Question", "Submitter", "Status", "Response"], qaCells)}
      ${cards(rows, qaCard)}
    </section>
  `);
  bindRecordClicks(rows, "question");
}

async function renderSystem() {
  const checks = await Promise.allSettled([
    getCountFromServer(collection(db, COLLECTIONS.locations)),
    getCountFromServer(collection(db, COLLECTIONS.launchSignups)),
    getCountFromServer(collection(db, COLLECTIONS.users))
  ]);
  setContent(`
    <section class="panel">
      <div class="panel-head"><h2>System</h2><span class="status green">Firebase connected</span></div>
      <div class="detail-grid">
        ${detailSection("Environment", {
          "Public website": "https://sayvah.co.uk/",
          "Admin route": "https://sayvah.co.uk/admin/",
          "Firebase project ID": firebaseConfig.projectId,
          "Launch date": "1 September 2026",
          "Hosting model": "Static GitHub Pages"
        })}
        ${detailSection("Authenticated admin", {
          "UID": state.user.uid,
          "Email": state.user.email || "Not recorded",
          "Name": displayName(state.adminProfile),
          "Role": state.adminProfile.role
        })}
        ${detailSection("Collection access checks", {
          "locations": checkText(checks[0]),
          "launchSignups": checkText(checks[1]),
          "users": checkText(checks[2]),
          "Cloud Function notifications": "Inferred from launchSignups notificationEmailStatus fields"
        })}
      </div>
    </section>
  `);
}

async function safeGet(collectionName, order, max) {
  const cacheKey = `${collectionName}:${order?.join(":")}:${max}`;
  if (state.cache.has(cacheKey)) return state.cache.get(cacheKey);
  let rows = [];
  let count = null;
  try {
    const base = collection(db, collectionName);
    const q = order ? query(base, orderBy(order[0], order[1]), limit(max)) : query(base, limit(max));
    const [snapshot, countSnap] = await Promise.all([getDocs(q), getCountFromServer(base).catch(() => null)]);
    rows = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
    count = countSnap?.data().count ?? null;
  } catch (error) {
    if (String(error?.code || "").includes("failed-precondition") && order) {
      const snapshot = await getDocs(query(collection(db, collectionName), limit(max)));
      rows = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
    } else {
      throw error;
    }
  }
  const value = { rows, count };
  state.cache.set(cacheKey, value);
  return value;
}

function showLogin() {
  el.authView.hidden = false;
  el.adminApp.hidden = true;
  el.deniedPanel.hidden = true;
  el.loginForm.hidden = false;
  showAuthMessage("", "");
}
function showDenied(message = "") {
  el.authView.hidden = false;
  el.adminApp.hidden = true;
  el.loginForm.hidden = true;
  el.deniedPanel.hidden = false;
  showAuthMessage(message, "error");
}
function showAdmin() {
  el.authView.hidden = true;
  el.adminApp.hidden = false;
  el.signedInAs.textContent = `Signed in as ${displayName(state.adminProfile) || state.user.email}`;
}
function showAuthMessage(message) { el.authMessage.textContent = message; }
function setContent(html) { el.content.innerHTML = html; }
function toggleDrawer(open) { el.sidebar.classList.toggle("open", open); el.drawerBackdrop.classList.toggle("open", open); }
function loadingPanel(label) { return `<section class="panel"><div class="empty">Loading ${escapeHtml(label)}...</div></section>`; }
function errorPanel(error) { return `<section class="panel"><div class="error">Unable to load this admin module. ${escapeHtml(error?.code || error?.message || "Check Firestore rules and indexes.")}</div></section>`; }
function statCard(label, value) { return `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></article>`; }
function activityBlock(title, rows, titleFn) {
  return `<article class="record-card"><h3>${escapeHtml(title)}</h3>${rows.length ? rows.map((row) => `<p><strong>${escapeHtml(titleFn(row))}</strong><br><span class="muted">${formatDate(row.createdAt || row.updatedAt || row.timestamp)}</span></p>`).join("") : `<p class="muted">No recent records found.</p>`}</article>`;
}
function tabbar(key, tabs, current) { return `<div class="tabbar">${tabs.map((tab) => `<button type="button" data-filter-key="${escapeHtml(key)}" data-filter-value="${escapeHtml(tab)}" class="${tab === current ? "active" : ""}">${escapeHtml(tab)}</button>`).join("")}</div>`; }
function bindTabs(key) {
  document.querySelectorAll(`[data-filter-key="${CSS.escape(key)}"]`).forEach((button) => button.addEventListener("click", () => {
    state.filters[key] = button.dataset.filterValue;
    renderPage(state.page);
  }));
}
function userToolbar(key, sevadaarsOnly) {
  const f = state.filters[key] || {};
  return `<div class="toolbar">
    <input data-user-filter="${key}" data-field="search" value="${escapeAttr(f.search || "")}" placeholder="Search name or email" />
    <select data-user-filter="${key}" data-field="role"><option value="">All roles</option>${["admin","requester","sevadaar","user"].map((v) => option(v, f.role)).join("")}</select>
    <select data-user-filter="${key}" data-field="verification"><option value="">All verification</option>${["verified","pending","denied","unverified"].map((v) => option(v, f.verification)).join("")}</select>
    <select data-user-filter="${key}" data-field="state"><option value="">All states</option>${["hidden","banned","active"].map((v) => option(v, f.state)).join("")}</select>
  </div>${sevadaarsOnly ? tabbar(key, ["verified","pending","denied","unverified","hidden","banned","all"], f.quick || "all") : ""}`;
}
function option(value, selected) { return `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`; }
function bindUserToolbar(key) {
  document.querySelectorAll(`[data-user-filter="${CSS.escape(key)}"]`).forEach((node) => node.addEventListener("input", () => {
    state.filters[key] = { ...(state.filters[key] || {}), [node.dataset.field]: node.value };
    renderPage(state.page);
  }));
  document.querySelectorAll(`[data-filter-key="${CSS.escape(key)}"]`).forEach((button) => button.addEventListener("click", () => {
    state.filters[key] = { ...(state.filters[key] || {}), quick: button.dataset.filterValue };
    renderPage(state.page);
  }));
}
function requestTable(rows) { return genericTable(rows, ["Request", "Requester", "Area", "Status", "Created"], requestCells); }
function userTable(rows) { return genericTable(rows, ["User", "UID", "Role", "Area", "Verification"], userCells); }
function genericTable(rows, headers, cellFn) {
  if (!rows.length) return `<div class="empty">No records found.</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr data-record-id="${escapeAttr(row.id)}">${cellFn(row)}</tr>`).join("")}</tbody></table></div>`;
}
function cards(rows, cardFn) { return `<div class="record-grid mobile-cards">${rows.map(cardFn).join("")}</div>`; }
function bindRecordClicks(rows, type) {
  document.querySelectorAll("[data-record-id]").forEach((node) => node.addEventListener("click", () => openDetail(type, rows.find((row) => row.id === node.dataset.recordId))));
}
function requestCells(r) { return `<td>${escapeHtml(requestTitle(r))}<br><span class="muted">${r.id}</span></td><td>${escapeHtml(nameOrId(r.requesterName || r.requesterId || r.userId))}</td><td>${escapeHtml(areaOf(r))}</td><td>${statusPill(r.status)}</td><td>${formatDate(r.createdAt)}</td>`; }
function userCells(u) { return `<td><div class="person-cell">${avatar(u)}<div>${escapeHtml(displayName(u))}<br><span class="muted">${escapeHtml(u.email || "")}</span></div></div></td><td>${escapeHtml(u.id)}</td><td>${escapeHtml(u.role || u.userType || u.accountType || "user")}</td><td>${escapeHtml(areaOf(u))}</td><td>${statusPill(verificationState(u))}<br><span class="muted">Approved: ${u.isApproved === true ? "Yes" : u.isApproved === false ? "No" : "Not recorded"}</span><br><span class="muted">Evidence: ${evidenceFor(u).length ? evidenceFor(u).length + " field(s)" : "none"}</span></td>`; }
function chatCells(c) { return `<td>${escapeHtml(c.title || c.id)}</td><td>${escapeHtml(list(c.participants || c.participantIds || c.users))}</td><td>${escapeHtml(c.requestId || c.linkedRequestId || "Not linked")}</td><td>${formatDate(c.lastMessageAt || c.updatedAt || c.createdAt)}<br><span class="muted">${escapeHtml(c.lastMessagePreview || c.lastMessage || "")}</span></td>`; }
function reportCells(r) { return `<td>${escapeHtml(r.reason || r.type || r.id)}<br><span class="muted">${escapeHtml(r.description || "")}</span></td><td>${escapeHtml(nameOrId(r.reporterName || r.reporterId))}</td><td>${escapeHtml(nameOrId(r.reportedUserName || r.reportedUserId || r.userId))}</td><td>${statusPill(r.status)}</td><td>${formatDate(r.createdAt || r.timestamp)}</td>`; }
function orgCells(o) { return `<td>${escapeHtml(o.name || o.title || o.id)}</td><td>${escapeHtml(areaOf(o) || o.location || "")}</td><td>${statusPill(o.active === false ? "inactive" : (o.status || "active"))}</td><td>${escapeHtml(list(o.admins || o.adminIds || o.managedBy))}</td><td>${formatDate(o.updatedAt || o.createdAt)}</td>`; }
function signupCells(s) { return `<td>${escapeHtml(s.name || "Not provided")}</td><td><a href="mailto:${escapeAttr(s.email || "")}">${escapeHtml(s.email || "")}</a><br><button class="soft-button" type="button" data-copy-email="${escapeAttr(s.email || "")}">Copy email</button></td><td>${escapeHtml(s.area || "")}</td><td>${escapeHtml(s.interest || "")}</td><td>${statusPill(s.notificationEmailStatus || (s.notificationEmailSent ? "sent" : "pending"))}<br><span class="muted">${formatDate(s.notificationEmailSentAt)}</span></td>`; }
function qaCells(q) { return `<td>${escapeHtml(q.question || q.title || q.id)}</td><td>${escapeHtml(nameOrId(q.submitterName || q.userId || q.uid))}</td><td>${statusPill(q.status || (q.approved ? "approved" : "pending"))}</td><td>${escapeHtml(q.answer || q.response || "")}</td>`; }
function requestCard(r) { return recordCard(r, requestTitle(r), { ID: r.id, Requester: nameOrId(r.requesterName || r.requesterId || r.userId), Area: areaOf(r), Status: r.status || "unknown", Created: formatDate(r.createdAt) }); }
function userCard(u) { return recordCard(u, displayName(u), { UID: u.id, Email: u.email || "", Role: u.role || u.userType || u.accountType || "user", Area: areaOf(u), Verification: verificationState(u), Approved: u.isApproved === true ? "Yes" : u.isApproved === false ? "No" : "Not recorded", Evidence: evidenceFor(u).length ? evidenceFor(u).length + " field(s)" : "No ID verification document is currently stored for this user.", Joined: formatDate(u.createdAt) }); }
function chatCard(c) { return recordCard(c, c.title || c.id, { Participants: list(c.participants || c.participantIds || c.users), Request: c.requestId || "Not linked", Updated: formatDate(c.lastMessageAt || c.updatedAt) }); }
function reportCard(r) { return recordCard(r, r.reason || r.type || r.id, { Reporter: nameOrId(r.reporterName || r.reporterId), Reported: nameOrId(r.reportedUserName || r.reportedUserId || r.userId), Status: r.status || "unknown", Date: formatDate(r.createdAt || r.timestamp) }); }
function orgCard(o) { return recordCard(o, o.name || o.title || o.id, { Area: areaOf(o) || o.location || "", Status: o.active === false ? "inactive" : (o.status || "active"), Admins: list(o.admins || o.adminIds || o.managedBy) }); }
function signupCard(s) { return `<article class="record-card"><h3>${escapeHtml(s.name || "Signup")}</h3><dl><div><dt>Email</dt><dd><a href="mailto:${escapeAttr(s.email || "")}">${escapeHtml(s.email || "")}</a></dd></div><div><dt>Area</dt><dd>${escapeHtml(s.area || "")}</dd></div><div><dt>Interest</dt><dd>${escapeHtml(s.interest || "")}</dd></div><div><dt>Notification</dt><dd>${escapeHtml(s.notificationEmailStatus || (s.notificationEmailSent ? "sent" : "pending"))}</dd></div></dl><div class="action-row"><button class="soft-button" type="button" data-copy-email="${escapeAttr(s.email || "")}">Copy email</button></div></article>`; }
function qaCard(q) { return recordCard(q, q.question || q.title || q.id, { Submitter: nameOrId(q.submitterName || q.userId || q.uid), Status: q.status || (q.approved ? "approved" : "pending"), Response: q.answer || q.response || "" }); }
function recordCard(row, title, fields) {
  return `<article class="record-card" data-record-id="${escapeAttr(row.id)}"><h3>${escapeHtml(title)}</h3><dl>${Object.entries(fields).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "Not recorded")}</dd></div>`).join("")}</dl></article>`;
}
async function openDetail(type, row) {
  if (!row) return;
  const actions = actionButtons(type, row);
  el.modalContent.innerHTML = `<h1 id="modal-title">${escapeHtml(detailTitle(type, row))}</h1><div class="detail-grid">${type === "user" ? userDetailSections(row) : detailSection("Overview", flatten(row))}${actions}</div>`;
  el.detailModal.hidden = false;
  bindActions(type, row);
  if (type === "chat") await appendChatMessages(row.id);
}
function closeModal() { el.detailModal.hidden = true; }
function actionButtons(type, row) {
  if (type === "area") return `<div class="panel"><h2>Admin actions</h2><div class="action-row"><button class="soft-button" data-action="toggle-area">${row.active === false ? "Activate area" : "Deactivate area"}</button></div></div>`;
  if (type === "user") return `<div class="panel"><h2>Admin actions</h2><div class="field"><label for="review-message">Review message</label><textarea id="review-message"></textarea></div><div class="action-row"><button class="soft-button" data-action="approve-verification">Approve verification</button><button class="danger-button" data-action="deny-verification">Deny verification</button><button class="danger-button" data-action="toggle-hidden">${row.hidden ? "Unhide user" : "Hide user"}</button><button class="danger-button" data-action="toggle-banned">${row.banned ? "Unban user" : "Ban user"}</button></div></div>`;
  if (type === "report") return `<div class="panel"><h2>Admin actions</h2><div class="action-row"><button class="soft-button" data-action="resolve-report">Resolve report</button><button class="soft-button" data-action="dismiss-report">Dismiss report</button></div></div>`;
  return `<div class="panel"><h2>Admin actions</h2><p class="muted">No safe write actions are enabled for this record until the production app schema is confirmed.</p></div>`;
}
function bindActions(type, row) {
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => confirmAction(button.dataset.action, type, row)));
}
function confirmAction(action, type, row) {
  const labels = {
    "toggle-area": row.active === false ? "activate this area" : "deactivate this area",
    "approve-verification": "approve this user's verification",
    "deny-verification": "deny this user's verification",
    "toggle-hidden": row.hidden ? "unhide this user" : "hide this user",
    "toggle-banned": row.banned ? "unban this user" : "ban this user",
    "resolve-report": "mark this report resolved",
    "dismiss-report": "dismiss this report"
  };
  el.confirmCopy.textContent = `Please confirm you want to ${labels[action]}: ${detailTitle(type, row)}. This will create an admin audit log.`;
  el.confirmModal.hidden = false;
  el.confirmSubmit.onclick = () => runAction(action, type, row);
}
function closeConfirm() { el.confirmModal.hidden = true; }
async function runAction(action, type, row) {
  const reviewMessage = document.getElementById("review-message")?.value?.trim() || "";
  const refs = { user: COLLECTIONS.users, area: COLLECTIONS.locations, report: COLLECTIONS.reports };
  const updates = {
    "toggle-area": { active: row.active === false },
    "approve-verification": { isVerified: true, isApproved: true, verificationStatus: "approved", verificationReviewedAt: serverTimestamp(), verificationReviewedBy: state.user.uid, verificationReviewMessage: reviewMessage },
    "deny-verification": { isVerified: false, isApproved: false, verificationStatus: "denied", verificationReviewedAt: serverTimestamp(), verificationReviewedBy: state.user.uid, verificationReviewMessage: reviewMessage },
    "toggle-hidden": { hidden: !row.hidden },
    "toggle-banned": { banned: !row.banned },
    "resolve-report": { status: "resolved", resolvedAt: serverTimestamp(), resolvedBy: state.user.uid },
    "dismiss-report": { status: "dismissed", resolvedAt: serverTimestamp(), resolvedBy: state.user.uid }
  };
  await updateDoc(doc(db, refs[type], row.id), updates[action]);
  await addDoc(collection(db, COLLECTIONS.audit), {
    adminUid: state.user.uid,
    action: auditName(action, row),
    targetType: type,
    targetId: row.id,
    timestamp: serverTimestamp(),
    summary: `${auditName(action, row)} on ${detailTitle(type, row)}`
  });
  state.cache.clear();
  closeConfirm();
  closeModal();
  renderPage(state.page);
}
async function appendChatMessages(chatId) {
  const shell = el.modalContent.querySelector(".detail-grid");
  if (!shell) return;
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = "<h2>Message history</h2><div class=\"empty\">Loading messages...</div>";
  shell.appendChild(panel);
  try {
    const snap = await getDocs(query(collection(db, COLLECTIONS.chats, chatId, "messages"), orderBy("createdAt", "asc"), limit(100)));
    const messages = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    panel.innerHTML = `<h2>Message history</h2>${messages.length ? messages.map((message) => `<article class="record-card"><p><strong>${escapeHtml(nameOrId(message.senderName || message.senderId || message.uid))}</strong> <span class="muted">${formatDate(message.createdAt || message.timestamp)}</span></p><p>${escapeHtml(message.text || message.message || message.body || "")}</p></article>`).join("") : `<div class="empty">No message documents found in chats/${escapeHtml(chatId)}/messages.</div>`}`;
  } catch (error) {
    panel.innerHTML = `<h2>Message history</h2><div class="error">Messages could not be loaded. Admin rules may need explicit access to chat message subcollections.</div>`;
  }
}
function bindCopyEmail() {
  document.querySelectorAll("[data-copy-email]").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const email = button.dataset.copyEmail;
    if (!email) return;
    await navigator.clipboard?.writeText(email);
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy email"; }, 1200);
  }));
}
function auditName(action, row) {
  const map = { "approve-verification": "verification_approved", "deny-verification": "verification_denied", "resolve-report": "report_resolved", "dismiss-report": "report_dismissed" };
  if (action === "toggle-area") return row.active === false ? "area_activated" : "area_deactivated";
  if (action === "toggle-hidden") return row.hidden ? "user_unhidden" : "user_hidden";
  if (action === "toggle-banned") return row.banned ? "user_unbanned" : "user_banned";
  return map[action] || action;
}
function detailSection(title, fields) { return `<section class="panel"><h2>${escapeHtml(title)}</h2><dl>${Object.entries(fields).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl></section>`; }
function evidenceFor(u) { const fields = ["idDocumentUrl","idDocumentURL","identityDocumentUrl","verificationDocumentUrl","verificationImageUrl","selfieUrl","proofUrl","documentUrl","idDocumentPath","identityDocumentPath","verificationDocumentPath","verificationImagePath","selfiePath","proofPath","documentPath","gurdwaraEvidenceUrl","organisationEvidenceUrl"]; return fields.filter((key) => u && u[key]).map((key) => ({ key, value: u[key] })); }
function userDetailSections(u) { const evidence = evidenceFor(u); return detailSection("Identity", { Name: displayName(u), Email: u.email || "Not recorded", UID: u.id, Role: u.role || u.userType || u.accountType || "Not recorded", Area: areaOf(u), Phone: u.phoneNumber || u.phone || "Not recorded", Joined: formatDate(u.createdAt), Gurdwara: u.gurdwaraName || u.gurdwaraId || list(u.managedGurdwaraIds), Organisation: u.organisationName || u.organisationId || u.organizationName || u.organizationId || "Not recorded" }) + detailSection("Verification", { isVerified: String(u.isVerified ?? "Not recorded"), verificationStatus: u.verificationStatus || verificationState(u), isApproved: String(u.isApproved ?? "Not recorded"), verificationReviewMessage: u.verificationReviewMessage || "Not recorded", verificationReviewedAt: formatDate(u.verificationReviewedAt), verificationReviewedBy: u.verificationReviewedBy || "Not recorded" }) + `<section class="panel"><h2>ID / verification evidence</h2>${evidence.length ? evidence.map((item) => `<article class="record-card"><h3>${escapeHtml(item.key)}</h3><a class="soft-button" href="${escapeAttr(item.value)}" target="_blank" rel="noopener noreferrer">Open evidence</a></article>`).join("") : `<div class="empty">No ID verification document is currently stored for this user.</div>`}</section>` + detailSection("Community status", { Banned: String((u.banned || u.isBanned) ?? "Not recorded"), BanReason: u.banReason || "Not recorded", BanUntil: formatDate(u.banUntil), Hidden: String((u.hidden || u.isHidden) ?? "Not recorded"), HiddenReason: u.hiddenReason || "Not recorded", TempleAdmin: String(u.isTempleAdmin ?? "Not recorded"), ManagedGurdwaras: list(u.managedGurdwaraIds || u.managedGurdwaras) }); }
function flatten(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !String(key).toLowerCase().includes("fcmtoken")).map(([k, v]) => [k, valueText(v)]));
}
function filterUser(row, filters, sevadaarsOnly) {
  const text = `${displayName(row)} ${row.email || ""} ${row.id || ""} ${areaOf(row)}`.toLowerCase();
  if (filters.search && !text.includes(filters.search.toLowerCase())) return false;
  if (filters.role && row.role !== filters.role) return false;
  if (filters.verification && verificationState(row) !== filters.verification) return false;
  if (filters.state === "hidden" && !row.hidden) return false;
  if (filters.state === "banned" && !row.banned) return false;
  if (filters.state === "active" && (row.hidden || row.banned)) return false;
  if (sevadaarsOnly && filters.quick && filters.quick !== "all") {
    if (["hidden", "banned"].includes(filters.quick)) return Boolean(row[filters.quick]);
    return verificationState(row) === filters.quick;
  }
  return true;
}
function filterChats(rows) {
  const tab = state.filters.chats || "all";
  if (tab === "all") return rows;
  if (tab === "personal") return rows.filter((c) => !c.isCommunity && !c.public);
  if (tab === "community") return rows.filter((c) => c.isCommunity || c.public || c.type === "community");
  if (tab === "active") return rows.filter((c) => c.archived !== true && c.status !== "archived");
  if (tab === "archived") return rows.filter((c) => c.archived === true || c.status === "archived");
  return rows;
}
function displayName(u = {}) { return u.displayName || u.name || u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id || "Unknown user"; }
function requestTitle(r = {}) { return r.title || r.requestTitle || r.category || r.id || "Untitled request"; }
function reportTitle(r = {}) { return r.reason || r.type || r.id || "Report"; }
function signupTitle(s = {}) { return `${s.name || "Signup"}${s.area ? `, ${s.area}` : ""}`; }
function detailTitle(type, row) { if (type === "user") return displayName(row); if (type === "request") return requestTitle(row); if (type === "report") return reportTitle(row); return row.name || row.title || row.id; }
function roleOf(u) { return String(u.role || u.userType || u.accountType || "").toLowerCase(); }
function isSevadaar(u) { const role = roleOf(u); return role.includes("sevadaar") || role.includes("helper") || role.includes("volunteer") || role.includes("both") || u.isSevadaar === true || u.canHelp === true; }
function isRequester(u) { const role = roleOf(u); return role.includes("requester") || role.includes("support") || role.includes("both") || u.isRequester === true || u.canRequest === true; }
function isBothRole(u) { return roleOf(u).includes("both") || (isSevadaar(u) && isRequester(u)); }
function isVerifiedSevadaar(u) { return isSevadaar(u) && (u.isVerified === true || verificationState(u) === "verified" || verificationState(u) === "approved"); }
function verificationState(u) {
  const raw = String(u.verificationStatus || "").toLowerCase();
  if (u.isVerified === true || raw === "approved") return "verified";
  if (["pending", "pending_review", "review"].includes(raw)) return "pending";
  if (["denied", "rejected"].includes(raw)) return "denied";
  return "unverified";
}
function statusGroup(status) {
  const value = String(status || "").toLowerCase();
  if (["open", "pending", "new"].includes(value)) return "open";
  if (["accepted", "in_progress", "in progress", "active", "helping"].includes(value)) return "active";
  if (["completed", "complete", "resolved", "done"].includes(value)) return "completed";
  if (["cancelled", "canceled", "closed", "dismissed", "inactive"].includes(value)) return "closed";
  return value || "open";
}
function areaOf(row) { return row.area || row.locationName || row.location || row.town || row.city || "Not recorded"; }
function nameOrId(value) { return value || "Not recorded"; }
function list(value) { return Array.isArray(value) ? value.join(", ") : (value && typeof value === "object" ? Object.keys(value).join(", ") : value || "Not recorded"); }
function avatar(u) { return u.photoURL || u.photoUrl || u.profilePhotoUrl ? `<span class="avatar"><img src="${escapeAttr(u.photoURL || u.photoUrl || u.profilePhotoUrl)}" alt="" /></span>` : `<span class="avatar">${escapeHtml(displayName(u).charAt(0).toUpperCase())}</span>`; }
function statusPill(value) {
  const group = statusGroup(value);
  const color = group === "completed" || group === "resolved" || group === "verified" || group === "approved" || value === true ? "green" : group === "closed" || group === "denied" || group === "banned" ? "red" : group === "active" || group === "pending" ? "orange" : "";
  return `<span class="status ${color}">${escapeHtml(value === undefined || value === null ? "unknown" : value)}</span>`;
}
function checkText(result) { return result.status === "fulfilled" ? `Allowed (${result.value.data().count} records)` : "Blocked or unavailable"; }
function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not recorded";
}
function valueText(value) {
  if (value?.toDate) return formatDate(value);
  if (Array.isArray(value)) return value.map(valueText).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === undefined || value === null || value === "" ? "Not recorded" : String(value);
}
function authError(error) {
  if (error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password") return "Invalid email or password.";
  if (error?.code === "auth/user-not-found") return "No admin account found for that email.";
  return "Sign-in failed. Check the credentials and try again.";
}
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function escapeAttr(value) { return escapeHtml(value); }




