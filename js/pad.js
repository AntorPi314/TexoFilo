// ─────────────────────────────────────────
//  TEXOFILO — Pad Page Logic
//  Features: Notepad, File Share, Admin (read-only, unlimited uploads),
//            Link Copy, QR Code, Linkified text viewer
// ─────────────────────────────────────────

import {
  db, auth, WORKER_URL,
  fmtSize, daysLeft, getFileIcon, isImageFile, isTextFile,
  sanitize, showToast
} from "./config.js";

import {
  ref, set, get, onValue, push, remove
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// ─────────────────────
//  Setup
// ─────────────────────
const params  = new URLSearchParams(location.search);
const padPath = ((params.get("p") || "untitled").trim()
  .replace(/[^a-zA-Z0-9\-_]/g, "") || "untitled").slice(0, 64);

document.title = `${padPath} — Texofilo`;
document.getElementById("path-label").textContent = padPath;

// ─────────────────────
//  Admin detection
// ─────────────────────
const isAdmin    = localStorage.getItem("txf_admin_auth") === "1";
const adminToken = localStorage.getItem("txf_admin_token") || null;

// Admin controls shown after function definitions below

// ─────────────────────
//  Path History (localStorage)
// ─────────────────────
const HISTORY_KEY = "txf_path_history";
const HISTORY_MAX = 7;

function savePathToHistory(path) {
  try {
    let hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    hist = [path, ...hist.filter(p => p !== path)].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch (_) {}
}

function getPathHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (_) { return []; }
}

savePathToHistory(padPath);

function navigateTo(path) {
  path = (path || "").trim().replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 64);
  if (!path) return;
  window.location.href = "pad.html?p=" + encodeURIComponent(path);
}

// ── Path Nav popup ──
const pathGoBtn      = document.getElementById("path-go-btn");
const pathPopup      = document.getElementById("path-popup");
const pathPopupInput = document.getElementById("path-popup-input");
const pathPopupGoBtn = document.getElementById("path-popup-go-btn");
const pathHistory    = document.getElementById("path-history");

function renderHistory() {
  const history = getPathHistory();
  if (history.length === 0) {
    pathHistory.innerHTML = `<div class="path-history-empty">Visit more pads to build history</div>`;
    return;
  }
  pathHistory.innerHTML = `<div class="path-history-label">Recent Pads</div>` +
    history.map(p => {
      const isCurrent = p === padPath;
      return `
        <div class="path-hist-item${isCurrent ? ' is-current' : ''}" data-path="${sanitize(p)}">
          <span class="phi-icon">${isCurrent ? '📍' : '🕐'}</span>
          <span class="phi-name">${sanitize(p)}${isCurrent ? ' <span style="font-size:10px;color:var(--muted2);font-weight:400;">(here)</span>' : ''}</span>
          ${isCurrent ? '' : '<span class="phi-arrow">→</span>'}
        </div>`;
    }).join("");

  pathHistory.querySelectorAll(".path-hist-item:not(.is-current)").forEach(item => {
    item.addEventListener("click", () => navigateTo(item.dataset.path));
  });
}

function openPopup() {
  pathPopup.classList.add("open");
  renderHistory();
  setTimeout(() => pathPopupInput.focus(), 60);
}

function closePopup() {
  pathPopup.classList.remove("open");
  pathPopupInput.value = "";
}

pathGoBtn.addEventListener("click", e => {
  e.stopPropagation();
  pathPopup.classList.contains("open") ? closePopup() : openPopup();
});

pathPopupGoBtn.addEventListener("click", () => navigateTo(pathPopupInput.value));

pathPopupInput.addEventListener("keydown", e => {
  if (e.key === "Enter") navigateTo(pathPopupInput.value);
  if (e.key === "Escape") closePopup();
});

// Close popup when clicking anywhere outside path-nav
document.addEventListener("click", e => {
  if (!document.getElementById("path-nav").contains(e.target)) closePopup();
});

// ─────────────────────
//  DOM refs
// ─────────────────────
const overlay         = document.getElementById("loading-overlay");
const notepad         = document.getElementById("notepad");
const gutterEl        = document.getElementById("gutter-inner");
const gutter          = gutterEl;
const gutterWrap      = gutterEl ? gutterEl.parentElement : null;
const saveDot         = document.getElementById("save-dot");
const saveLabel       = document.getElementById("save-label");
const noteStats       = document.getElementById("note-stats");
const fileCountBadge  = document.getElementById("file-count");
const uploadZone      = document.getElementById("upload-zone");
const fileInputEl     = document.getElementById("file-input");
const progBar         = document.getElementById("upload-prog-bar");
const progFill        = document.getElementById("prog-fill");
const progFilename    = document.getElementById("prog-filename");
const progPct         = document.getElementById("prog-pct");
const limitBanner     = document.getElementById("limit-banner");
const errBanner       = document.getElementById("err-banner");
const fileList        = document.getElementById("file-list");
const readonlyBanner  = document.getElementById("readonly-banner");
const adminMenuBtn    = document.getElementById("btn-admin-menu");

// ─────────────────────
//  Tabs
// ─────────────────────
document.querySelectorAll(".tab-btn").forEach(tab => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("panel-" + target).classList.add("active");
    if (target === "notepad") notepad.focus();
  });
});

// ─────────────────────
//  Save Indicator
// ─────────────────────
function setSaving() {
  saveDot.className = "save-dot saving";
  if (saveLabel) saveLabel.textContent = "Saving…";
}

function setSaved() {
  saveDot.className = "save-dot saved";
  if (saveLabel) saveLabel.textContent = "Saved";
  clearTimeout(setSaved._t);
  setSaved._t = setTimeout(() => {
    saveDot.className = "save-dot";
    if (saveLabel) saveLabel.textContent = "Auto-save";
  }, 2500);
}

function setSaveError() {
  saveDot.className = "save-dot error";
  if (saveLabel) saveLabel.textContent = "Save failed";
}

// ─────────────────────
//  Global + Per-Pad settings state
// ─────────────────────
let isReadOnly     = false;
let padSettings    = {};
let globalSettings = {};

get(ref(db, "admin/settings")).then(snap => {
  if (snap.exists()) globalSettings = snap.val();
}).catch(() => {});

const padSettingsRef = ref(db, `pads/${padPath}/settings`);
onValue(padSettingsRef, snap => {
  padSettings = snap.exists() ? snap.val() : {};
  isReadOnly  = !!(padSettings.readOnly === true);
  applyReadOnlyMode();
  if (isAdmin) updateAdminMenuBtn();
});

function effectiveSetting(key, globalDefault) {
  if (padSettings[key] !== undefined) return padSettings[key];
  if (globalSettings[key] !== undefined) return globalSettings[key];
  return globalDefault;
}

function applyReadOnlyMode() {
  const restrict = isReadOnly && !isAdmin;
  notepad.contentEditable = restrict ? "false" : "true";
  document.body.classList.toggle("readonly-mode", restrict);
  if (readonlyBanner) readonlyBanner.style.display = restrict ? "block" : "none";
  renderFileList();
  const addBtn = document.getElementById("btn-add-gallery-link");
  if (addBtn) {
    addBtn.disabled      = restrict;
    addBtn.style.opacity = restrict ? "0.4" : "";
    addBtn.style.cursor  = restrict ? "not-allowed" : "";
  }
  renderGalleryGrid();
  updateOwnerUI?.();
}

function updateAdminMenuBtn() {
  if (!adminMenuBtn) return;
  if (isReadOnly) {
    adminMenuBtn.textContent = "🔒 ADMIN";
    adminMenuBtn.style.background   = "var(--red-lt)";
    adminMenuBtn.style.color        = "var(--red)";
    adminMenuBtn.style.borderColor  = "#FECACA";
  } else {
    adminMenuBtn.textContent = "⚙ ADMIN";
    adminMenuBtn.style.background   = "var(--amber-lt)";
    adminMenuBtn.style.color        = "#92400E";
    adminMenuBtn.style.borderColor  = "#FDE68A";
  }
}

if (isAdmin) {
  const adminControls = document.getElementById("admin-controls");
  if (adminControls) adminControls.style.display = "flex";
  updateAdminMenuBtn();
}

// ─────────────────────
//  Admin Settings Dialog
// ─────────────────────
adminMenuBtn?.addEventListener("click", openAdminDialog);

function openAdminDialog() {
  const curReadOnly   = isReadOnly;
  const curMaxFiles   = effectiveSetting("maxFiles",      9999);
  const curMaxSizeMB  = effectiveSetting("maxFileSizeMB", 9999);
  const curExpireDays = effectiveSetting("expireDays",    9999);
  const curNotepadKB  = effectiveSetting("maxNotepadKB",  10);
  const curGalleryMax = effectiveSetting("maxGalleryLinks", 20);

  const dlg = createDialogOverlay();
  dlg.innerHTML = `
    <div class="dialog-box" role="dialog" aria-modal="true" style="max-width:460px;">
      <div class="dialog-header">
        <div class="dialog-icon">⚙️</div>
        <div class="dialog-title-wrap">
          <div class="dialog-title">Admin — Pad Settings</div>
          <div class="dialog-subtitle">/${sanitize(padPath)} — overrides apply to this pad only</div>
        </div>
        <button class="btn-icon" id="adlg-close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="dialog-body" style="padding:20px; display:flex; flex-direction:column; gap:14px; overflow-y:auto; max-height:60vh;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:var(--radius);background:${curReadOnly?"var(--red-lt)":"var(--surface2)"};border:1.5px solid ${curReadOnly?"#FECACA":"var(--border)"};gap:12px;" id="readonly-row">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text);">Read Only</div>
            <div style="font-size:11.5px;color:var(--muted);">Users can view & download, but cannot edit or upload</div>
          </div>
          <button id="adlg-readonly-btn" class="btn btn-sm ${curReadOnly?"btn-danger":"btn-ghost"}" style="flex-shrink:0;min-width:90px;">
            ${curReadOnly?"🔒 ON":"🔓 OFF"}
          </button>
        </div>
        <div style="font-size:10px;font-weight:800;color:var(--muted2);text-transform:uppercase;letter-spacing:0.1em;padding-top:4px;">Per-Pad Overrides</div>
        ${numRow("adlg-max-files",   "Max files",        "Override global file limit for this pad",  curMaxFiles,   1, 9999)}
        ${numRow("adlg-max-size",    "Max file size MB", "Override global file size limit",           curMaxSizeMB,  1, 9999)}
        ${numRow("adlg-expire-days", "Expiry days",      "Override global file expiry for this pad",  curExpireDays, 1, 9999)}
        ${numRow("adlg-note-kb",     "Notepad max KB",   "Override global notepad size limit",        curNotepadKB,  1, 9999)}
        ${numRow("adlg-gallery-max", "Max gallery links","Override max image/video links in gallery",  curGalleryMax, 1, 9999)}
      </div>
      <div class="dialog-footer" style="justify-content:space-between;">
        <button class="btn btn-danger btn-sm" id="adlg-logout-btn">← Logout Admin</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" id="adlg-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="adlg-save">Save Settings</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(dlg);

  let localReadOnly = curReadOnly;
  const roBtn = dlg.querySelector("#adlg-readonly-btn");
  const roRow = dlg.querySelector("#readonly-row");
  roBtn.addEventListener("click", () => {
    localReadOnly = !localReadOnly;
    roBtn.textContent  = localReadOnly ? "🔒 ON" : "🔓 OFF";
    roBtn.className    = `btn btn-sm ${localReadOnly ? "btn-danger" : "btn-ghost"}`;
    roRow.style.background  = localReadOnly ? "var(--red-lt)" : "var(--surface2)";
    roRow.style.borderColor = localReadOnly ? "#FECACA"       : "var(--border)";
  });

  dlg.querySelectorAll(".adlg-num-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = dlg.querySelector(`#${btn.dataset.target}`);
      const dir   = parseInt(btn.dataset.dir);
      const min   = parseInt(input.dataset.min) || 1;
      const max   = parseInt(input.dataset.max) || 9999;
      input.value = Math.min(max, Math.max(min, (parseInt(input.value) || 0) + dir));
    });
  });

  dlg.querySelector("#adlg-save").addEventListener("click", async () => {
    const token = localStorage.getItem("txf_admin_token");
    if (!token) { showToast("Session expired", "error"); return; }
    const saveBtn = dlg.querySelector("#adlg-save");
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    const settings = {
      readOnly     : localReadOnly,
      maxFiles     : parseInt(dlg.querySelector("#adlg-max-files").value)   || 9999,
      maxFileSizeMB: parseInt(dlg.querySelector("#adlg-max-size").value)    || 9999,
      expireDays   : parseInt(dlg.querySelector("#adlg-expire-days").value) || 9999,
      maxNotepadKB : parseInt(dlg.querySelector("#adlg-note-kb").value)     || 10,
        maxGalleryLinks: parseInt(dlg.querySelector("#adlg-gallery-max").value) || 20,
    };
    try {
      const res  = await fetch(`${WORKER_URL}admin/pad`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, padPath, settings }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed");
      showToast("Pad settings saved!", "success");
      closeDialog(dlg);
    } catch (e) {
      showToast("Save failed: " + e.message, "error");
      saveBtn.disabled = false; saveBtn.textContent = "Save Settings";
    }
  });

  dlg.querySelector("#adlg-logout-btn").addEventListener("click", () => {
    localStorage.removeItem("txf_admin_auth");
    localStorage.removeItem("txf_admin_token");
    const controls = document.getElementById("admin-controls");
    if (controls) controls.style.display = "none";
    closeDialog(dlg);
    showToast("Logged out of Admin", "info");
    setTimeout(() => location.reload(), 800);
  });

  dlg.querySelector("#adlg-close").addEventListener("click",  () => closeDialog(dlg));
  dlg.querySelector("#adlg-cancel").addEventListener("click", () => closeDialog(dlg));
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDialog(dlg); });
}

function numRow(id, label, hint, val, min, max) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:140px;">
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;">${label}</div>
        <div style="font-size:11.5px;color:var(--muted);">${hint}</div>
      </div>
      <div style="display:flex;align-items:center;border:1.5px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--surface);flex-shrink:0;">
        <button class="adlg-num-btn" data-target="${id}" data-dir="-1" style="width:32px;height:32px;border:none;background:var(--surface2);font-size:16px;font-weight:600;cursor:pointer;">−</button>
        <input type="number" id="${id}" value="${val}" data-min="${min}" data-max="${max}" style="width:58px;text-align:center;border:none;outline:none;font-family:var(--ff-mono);font-size:13px;font-weight:700;color:var(--accent);background:transparent;padding:0 4px;" />
        <button class="adlg-num-btn" data-target="${id}" data-dir="1" style="width:32px;height:32px;border:none;background:var(--surface2);font-size:16px;font-weight:600;cursor:pointer;">+</button>
      </div>
    </div>`;
}

// ─────────────────────
//  AUTH SYSTEM
// ─────────────────────
let currentUser   = null;
let isOwner       = false;
let padMeta       = {};   // { owner, ownerName, createdAt }
const padMetaRef  = ref(db, `pads/${padPath}/meta`);
const googleProvider = new GoogleAuthProvider();

const btnSignIn        = document.getElementById("btn-sign-in");
const btnUserMenu      = document.getElementById("btn-user-menu");
const userAvatar       = document.getElementById("user-avatar");
const userNameShort    = document.getElementById("user-name-short");
const btnOwnerReadonly = document.getElementById("btn-owner-readonly");
const authModal        = document.getElementById("auth-modal");
const userMenuPopup    = document.getElementById("user-menu-popup");

// Watch pad meta for owner info
onValue(padMetaRef, snap => {
  padMeta = snap.exists() ? snap.val() : {};
  checkOwnership();
});

function checkOwnership() {
  isOwner = !!(currentUser && padMeta.owner && padMeta.owner === currentUser.uid);
  updateOwnerUI();
}

function updateOwnerUI() {
  if (!btnOwnerReadonly) return;
  // Show owner readonly toggle only if owner and NOT admin
  if (isOwner && !isAdmin) {
    btnOwnerReadonly.style.display = "flex";
    btnOwnerReadonly.textContent   = isReadOnly ? "🔒 Read Only: ON" : "🔓 Read Only: OFF";
    btnOwnerReadonly.className     = isOwner ? `btn btn-sm ${isReadOnly ? "btn-danger" : "btn-ghost"}` : "";
  } else {
    btnOwnerReadonly.style.display = "none";
  }
}

// Auth state change
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (user) {
    // Logged in — show user button
    btnSignIn.style.display   = "none";
    btnUserMenu.style.display = "flex";
    const initials = (user.displayName || user.email || "?").slice(0,2).toUpperCase();
    userAvatar.textContent       = initials;
    userNameShort.textContent    = user.displayName || user.email.split("@")[0];
    document.getElementById("user-menu-name").textContent  = user.displayName || "User";
    document.getElementById("user-menu-email").textContent = user.email || "";

    checkOwnership();
  } else {
    btnSignIn.style.display   = "flex";
    btnUserMenu.style.display = "none";
    btnOwnerReadonly.style.display = "none";
    currentUser = null;
    isOwner     = false;
    checkOwnership();
  }
});

// Claim ownership on first edit (not on login)
let _claimAttempted = false;
async function claimPadOwnership() {
  if (_claimAttempted) return;
  if (!currentUser) return;
  if (padMeta.owner) return; // already has an owner
  _claimAttempted = true;
  try {
    const snapMeta = await get(padMetaRef);
    if (!snapMeta.exists()) {
      await set(padMetaRef, {
        owner    : currentUser.uid,
        ownerName: currentUser.displayName || currentUser.email,
        createdAt: Date.now(),
      });
      showToast("🔑 Pad claimed — you can now toggle Read Only", "success");
    }
  } catch(e) {
    _claimAttempted = false; // allow retry on error
  }
}

// Owner readonly toggle
btnOwnerReadonly?.addEventListener("click", async () => {
  if (!isOwner || isAdmin) return;
  const newVal = !isReadOnly;
  btnOwnerReadonly.disabled = true;
  try {
    await set(ref(db, `pads/${padPath}/settings/readOnly`), newVal);
    showToast(newVal ? "🔒 Read Only enabled" : "🔓 Read Only disabled", newVal ? "info" : "success");
  } catch (e) {
    showToast("Failed: " + e.message, "error");
  } finally {
    btnOwnerReadonly.disabled = false;
  }
});

// Sign-in button → open modal
btnSignIn?.addEventListener("click", () => {
  authModal.style.display = "flex";
  setTimeout(() => document.getElementById("auth-email")?.focus(), 80);
});

document.getElementById("auth-modal-close")?.addEventListener("click", () => {
  authModal.style.display = "none";
});
authModal?.addEventListener("click", e => {
  if (e.target === authModal) authModal.style.display = "none";
});

// Google sign-in
document.getElementById("auth-google-btn")?.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
    authModal.style.display = "none";
    showToast("Signed in with Google!", "success");
  } catch (e) {
    document.getElementById("auth-err").textContent = e.message;
  }
});

// Email sign-in
document.getElementById("auth-login-btn")?.addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  const pass  = document.getElementById("auth-pass").value;
  const errEl = document.getElementById("auth-err");
  errEl.textContent = "";
  if (!email || !pass) { errEl.textContent = "Enter email and password."; return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    authModal.style.display = "none";
    showToast("Signed in!", "success");
  } catch (e) {
    errEl.textContent = e.code === "auth/invalid-credential" ? "Wrong email or password." : e.message;
  }
});

// Email register
document.getElementById("auth-register-btn")?.addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  const pass  = document.getElementById("auth-pass").value;
  const errEl = document.getElementById("auth-err");
  errEl.textContent = "";
  if (!email || !pass) { errEl.textContent = "Enter email and password."; return; }
  if (pass.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    authModal.style.display = "none";
    showToast("Account created & signed in!", "success");
  } catch (e) {
    errEl.textContent = e.code === "auth/email-already-in-use" ? "Email already registered. Try Sign In." : e.message;
  }
});

// Enter key in auth inputs
["auth-email","auth-pass"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("auth-login-btn")?.click();
  });
});

// User menu popup
btnUserMenu?.addEventListener("click", e => {
  e.stopPropagation();
  const isOpen = userMenuPopup.style.display === "block";
  userMenuPopup.style.display = isOpen ? "none" : "block";
});

document.addEventListener("click", e => {
  if (!userMenuPopup.contains(e.target) && e.target !== btnUserMenu) {
    userMenuPopup.style.display = "none";
  }
});

document.getElementById("user-menu-signout")?.addEventListener("click", async () => {
  userMenuPopup.style.display = "none";
  await signOut(auth);
  showToast("Signed out", "info");
});

// User pad settings — view-only dialog showing current effective settings
document.getElementById("user-menu-pad-settings")?.addEventListener("click", () => {
  userMenuPopup.style.display = "none";
  openUserSettingsDialog();
});

function openUserSettingsDialog() {
  const dlg = createDialogOverlay();
  const maxFiles    = effectiveSetting("maxFiles",      9999);
  const maxSizeMB   = effectiveSetting("maxFileSizeMB", 9999);
  const expireDays  = effectiveSetting("expireDays",    9999);
  const notepadKB   = effectiveSetting("maxNotepadKB",  10);
  const galleryMax  = effectiveSetting("maxGalleryLinks", 20);
  const readOnlyNow = isReadOnly;
  const ownerStr    = padMeta.ownerName || padMeta.owner || "—";

  dlg.innerHTML = `
    <div class="dialog-box" role="dialog" aria-modal="true" style="max-width:420px;">
      <div class="dialog-header">
        <div class="dialog-icon">📋</div>
        <div class="dialog-title-wrap">
          <div class="dialog-title">Pad Settings</div>
          <div class="dialog-subtitle">/${sanitize(padPath)} — view only, admin can change these</div>
        </div>
        <button class="btn-icon" id="usettings-close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="dialog-body" style="padding:20px; display:flex; flex-direction:column; gap:10px;">
        ${settingRow("Owner",            ownerStr,                    "Who claimed this pad")}
        ${settingRow("Read Only",        readOnlyNow ? "🔒 ON" : "🔓 OFF", "Current read-only state")}
        ${settingRow("Max files",        maxFiles + " files",         "Per-pad file limit")}
        ${settingRow("Max file size",    maxSizeMB + " MB",           "Single file size cap")}
        ${settingRow("File expiry",      expireDays + " days",        "Days before files auto-delete")}
        ${settingRow("Notepad size",     notepadKB + " KB",           "Max notepad content size")}
        ${settingRow("Max gallery links",galleryMax + " links",       "Gallery image/video link limit")}
      </div>
      <div class="dialog-footer" style="justify-content:flex-end;">
        <div style="font-size:11.5px;color:var(--muted);flex:1;">Settings can only be changed by the admin</div>
        <button class="btn btn-ghost btn-sm" id="usettings-ok">Close</button>
      </div>
    </div>`;

  document.body.appendChild(dlg);
  dlg.querySelector("#usettings-close").addEventListener("click", () => closeDialog(dlg));
  dlg.querySelector("#usettings-ok").addEventListener("click",    () => closeDialog(dlg));
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDialog(dlg); });
}

function settingRow(label, value, hint) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text);">${label}</div>
        <div style="font-size:11.5px;color:var(--muted);">${hint}</div>
      </div>
      <div style="font-family:var(--ff-mono);font-size:12.5px;font-weight:700;color:var(--accent);white-space:nowrap;">${value}</div>
    </div>`;
}

// Update owner UI whenever readOnly changes too
// (readOnly changes call updateOwnerUI via applyReadOnlyMode → renderFileList chain)

// ─────────────────────
//  Link Copy + QR Code
// ─────────────────────
document.getElementById("btn-copy-link")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast("Link copied to clipboard!", "success");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = window.location.href;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("Link copied!", "success");
  }
});

document.getElementById("btn-qr-code")?.addEventListener("click", () => {
  const url    = window.location.href;
  const qrSrc  = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}&bgcolor=FFFFFF&color=18181B&margin=3&qzone=1`;

  const dlg = createDialogOverlay();
  dlg.innerHTML = `
    <div class="dialog-box" role="dialog" aria-modal="true" aria-label="QR Code" style="max-width:380px;">
      <div class="dialog-header">
        <div class="dialog-icon">📲</div>
        <div class="dialog-title-wrap">
          <div class="dialog-title">Scan to open this pad</div>
          <div class="dialog-subtitle">${sanitize(padPath)}</div>
        </div>
        <button class="btn-icon" id="dialog-close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="dialog-body" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:28px 24px;">
        <div style="background:#fff;padding:12px;border-radius:var(--radius);border:1.5px solid var(--border);box-shadow:var(--shadow);">
          <img src="${qrSrc}" width="220" height="220" alt="QR Code" style="display:block;border-radius:4px;" />
        </div>
        <div style="font-family:var(--ff-mono);font-size:11px;color:var(--muted);word-break:break-all;text-align:center;max-width:260px;">${sanitize(url)}</div>
      </div>
      <div class="dialog-footer">
        <button id="qr-copy-btn" class="btn btn-ghost btn-sm">Copy Link</button>
        <div style="flex:1;"></div>
        <button class="btn btn-primary btn-sm" id="dialog-close-btn">Close</button>
      </div>
    </div>`;

  document.body.appendChild(dlg);
  dlg.querySelector("#dialog-close").addEventListener("click",     () => closeDialog(dlg));
  dlg.querySelector("#dialog-close-btn").addEventListener("click", () => closeDialog(dlg));
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDialog(dlg); });
  dlg.querySelector("#qr-copy-btn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); showToast("Link copied!", "success"); }
    catch { showToast("Copy failed", "error"); }
  });
});

// ─────────────────────
//  NOTEPAD
// ─────────────────────
const noteRef = ref(db, `pads/${padPath}/notepad`);
let isRemote  = false;
let saveTimer = null;
let LINE_HEIGHT_PX = 23;

function measureLineHeight() {
  const cs = getComputedStyle(notepad);
  const lh = parseFloat(cs.lineHeight);
  if (!isNaN(lh) && lh > 0) LINE_HEIGHT_PX = lh;
}

// ── contenteditable helpers ──
const URL_REGEX = /https?:\/\/[^\s<>"&]+/g;

function getNoteValue() {
  return notepad.innerText.replace(/\n$/, "");
}

function renderNoteLinks() {
  // Save caret
  const offset = getCaretOffset();
  const raw = getNoteValue();

  // Build safe HTML with clickable links
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = esc.replace(URL_REGEX, url =>
    '<a class="live-link" href="' + url + '" target="_blank" rel="noopener noreferrer" tabindex="-1">' + url + "</a>"
  );
  notepad.innerHTML = html.replace(/\n/g, "<br>") + "<br>";

  // Restore caret
  try { restoreCaretOffset(offset); } catch(_) {}
}

function getCaretOffset() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(notepad);
  range.setEnd(sel.anchorNode, sel.anchorOffset);
  return range.toString().length;
}

function restoreCaretOffset(offset) {
  const sel = window.getSelection();
  if (!sel) return;
  const walk = document.createTreeWalker(notepad, NodeFilter.SHOW_TEXT, null);
  let chars = 0, node;
  while ((node = walk.nextNode())) {
    const len = node.textContent.length;
    if (chars + len >= offset) {
      const range = document.createRange();
      range.setStart(node, Math.min(offset - chars, len));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    chars += len;
  }
}

function updateGutter() {
  if (!gutter) return;
  const lines = getNoteValue().split("\n").length;
  const fragment = document.createDocumentFragment();
  for (let i = 1; i <= lines; i++) {
    const div = document.createElement("div");
    div.className = "gutter-line";
    div.style.height     = LINE_HEIGHT_PX + "px";
    div.style.lineHeight = LINE_HEIGHT_PX + "px";
    div.textContent = i;
    fragment.appendChild(div);
  }
  gutter.innerHTML = "";
  gutter.appendChild(fragment);
  syncGutterScroll();
}

function syncGutterScroll() {
  if (gutterWrap) gutterWrap.scrollTop = notepad.scrollTop;
}

get(noteRef).then(snap => {
  measureLineHeight();
  if (snap.exists()) {
    isRemote = true;
    const text = snap.val().content || "";
    // Set initial content with links
    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    notepad.innerHTML = esc.replace(URL_REGEX, url =>
      '<a class="live-link" href="' + url + '" target="_blank" rel="noopener noreferrer" tabindex="-1">' + url + "</a>"
    ).replace(/\n/g, "<br>") + "<br>";
    isRemote = false;
  }
  updateStats();
  updateGutter();
  overlay.classList.add("hidden");
  setTimeout(() => overlay.remove(), 400);
}).catch(() => {
  measureLineHeight();
  updateGutter();
  overlay.classList.add("hidden");
  setTimeout(() => overlay.remove(), 400);
});

onValue(noteRef, snap => {
  if (isRemote || !snap.exists()) return;
  const remote = snap.val().content || "";
  if (remote !== getNoteValue()) {
    isRemote = true;
    const esc = remote.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    notepad.innerHTML = esc.replace(URL_REGEX, url =>
      '<a class="live-link" href="' + url + '" target="_blank" rel="noopener noreferrer" tabindex="-1">' + url + "</a>"
    ).replace(/\n/g, "<br>") + "<br>";
    isRemote = false;
    updateStats();
    updateGutter();
  }
});

function doSave() {
  const val    = getNoteValue();
  const maxKB  = effectiveSetting("maxNotepadKB", 10);
  const maxB   = maxKB * 1024;
  if (val.length > maxB) {
    setSaveError();
    showToast("Notepad limit reached (max " + maxKB + " KB). Text not saved.", "error");
    return;
  }
  set(noteRef, { content: val, updatedAt: Date.now() })
    .then(() => { setSaved(); recordActivity(); })
    .catch(setSaveError);
}

// ── Record last activity timestamp (resets view counter) ──
function recordActivity() {
  set(ref(db, `pads/${padPath}/stats/lastActivityAt`), Date.now()).catch(() => {});
}

// Intercept paste — strip HTML, only plain text
notepad.addEventListener("paste", e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
});

let renderTimer = null;
notepad.addEventListener("input", () => {
  if (isRemote) return;
  claimPadOwnership();
  // Debounce link rendering to avoid cursor jump on every keystroke
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderNoteLinks();
    updateGutter();
  }, 400);
  clearTimeout(saveTimer);
  setSaving();
  saveTimer = setTimeout(doSave, 600);
  updateStats();
  updateGutter();
});

notepad.addEventListener("scroll", syncGutterScroll);

notepad.addEventListener("keydown", e => {
  if (e.key === "Tab") {
    e.preventDefault();
    document.execCommand("insertText", false, "  ");
  }
  // Prevent Enter from creating <div> blocks — use <br> via execCommand
  if (e.key === "Enter") {
    e.preventDefault();
    document.execCommand("insertLineBreak");
  }
});

function updateStats() {
  const v = getNoteValue();
  const ch = v.length;
  const ln = v ? v.split("\n").length : 0;
  const wd = v.trim() ? v.trim().split(/\s+/).length : 0;
  const chEl = document.getElementById("note-stats");
  const wdEl = document.getElementById("note-words");
  const lnEl = document.getElementById("note-lines");
  if (chEl) chEl.textContent = ch.toLocaleString() + " chars";
  if (wdEl) wdEl.textContent = wd.toLocaleString() + " words";
  if (lnEl) lnEl.textContent = ln.toLocaleString() + " lines";
  // legacy fallback
  if (noteStats && !chEl) noteStats.textContent = ch.toLocaleString() + " chars · " + ln + " lines · " + wd + " words";
}

document.getElementById("btn-copy-all")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(getNoteValue());
    showToast("Copied to clipboard", "success");
  } catch {
    showToast("Copy failed", "error");
  }
});

document.getElementById("btn-download-txt")?.addEventListener("click", () => {
  const blob = new Blob([getNoteValue()], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = padPath + ".txt";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Download started");
});

// ─────────────────────
//  FILE SHARE
// ─────────────────────
const filesRef = ref(db, `pads/${padPath}/files`);
let currentFiles = {};

onValue(filesRef, async snap => {
  currentFiles = {};
  if (snap.exists()) {
    const now = Date.now();
    for (const [id, f] of Object.entries(snap.val())) {
      if (f.expiresAt && f.expiresAt < now) {
        remove(ref(db, `pads/${padPath}/files/${id}`));
      } else {
        currentFiles[id] = f;
      }
    }
  }
  renderFileList();
});

// Force-download a file via blob fetch (bypasses cross-origin download block)
window.forceDownload = async function forceDownload(url, filename) {
  try {
    showToast("Downloading…");
    const res  = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const burl = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = burl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(burl); a.remove(); }, 2000);
  } catch (e) {
    window.open(url, "_blank", "noopener,noreferrer");
    showToast("Could not download directly — opened in new tab", "info");
  }
}

function renderFileList() {
  const entries = Object.entries(currentFiles).sort((a, b) => b[1].uploadedAt - a[1].uploadedAt);
  const count   = entries.length;
  const restrict = isReadOnly && !isAdmin;

  const maxFiles = effectiveSetting("maxFiles", 9999);
  fileCountBadge.textContent = count;

  if (!restrict) {
    const atLimit = !isAdmin && count >= maxFiles;
    limitBanner.classList.toggle("show", atLimit);
    uploadZone.classList.toggle("disabled", atLimit);
    fileInputEl.disabled = atLimit;
  } else {
    limitBanner.classList.remove("show");
    uploadZone.classList.add("disabled");
    fileInputEl.disabled = true;
  }

  if (count === 0) {
    fileList.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">📂</div>
        <div class="es-title">No files yet</div>
        <div class="es-desc">${restrict ? "Read Only mode is active" : "Drop a file above to share it on this pad"}</div>
      </div>`;
    return;
  }

  fileList.innerHTML = entries.map(([id, f]) => {
    const exp      = f.byAdmin ? { label: "Never expires", cls: "" } : daysLeft(f.expiresAt);
    const icon     = getFileIcon(f.type, f.name);
    const canView  = isImageFile(f.type, f.name) || isTextFile(f.type, f.name);
    const showDel  = !restrict || isAdmin;

    const thumbHtml = isImageFile(f.type, f.name)
      ? `<div class="fc-thumb">
           <div class="fc-thumb-shimmer" id="shim-${id}"></div>
           <img src="${sanitize(f.url)}" alt="" loading="lazy"
             onload="this.removeAttribute('data-loading'); const s=document.getElementById('shim-${id}'); if(s)s.remove();"
             onerror="this.style.display='none'; const s=document.getElementById('shim-${id}'); if(s)s.remove(); this.parentElement.textContent='🖼️';"
             data-loading="1" />
         </div>`
      : `<div class="fc-thumb">${icon}</div>`;

    const viewBtn   = canView ? `<button class="btn btn-sm btn-view" onclick="viewFile('${id}')">View</button>` : "";
    const deleteBtn = showDel ? `<button class="btn btn-sm btn-danger" onclick="deleteFile('${id}')">✕</button>` : "";

    return `
      <div class="file-card" id="fc-${id}">
        ${thumbHtml}
        <div class="fc-info">
          <div class="fc-name" title="${sanitize(f.name)}">${sanitize(f.name)}</div>
          <div class="fc-meta">
            <span class="fc-chip">${fmtSize(f.size)}</span>
            <span class="fc-chip">${(f.type || "file").split("/")[0]}</span>
            <span class="fc-chip ${exp.cls}">${exp.label}</span>
          </div>
        </div>
        <div class="fc-actions">
          ${viewBtn}
          <button class="btn btn-sm btn-ghost" onclick="forceDownload('${sanitize(f.url)}', '${sanitize(f.name)}')">↓</button>
          ${deleteBtn}
        </div>
      </div>`;
  }).join("");
}

window.deleteFile = (id) => {
  const card = document.getElementById(`fc-${id}`);
  if (!card) return;
  // Prevent double confirm
  if (card.querySelector(".fc-delete-confirm")) return;

  const confirm = document.createElement("div");
  confirm.className = "fc-delete-confirm";
  confirm.innerHTML = `
    <span class="fc-confirm-msg">🗑️ Delete this file?</span>
    <div class="fc-confirm-btns">
      <button class="btn btn-ghost btn-sm" id="fc-cancel-${id}">Cancel</button>
      <button class="btn btn-danger btn-sm" id="fc-confirm-${id}">Delete</button>
    </div>`;
  card.appendChild(confirm);

  // Focus confirm button
  setTimeout(() => confirm.querySelector(`#fc-confirm-${id}`)?.focus(), 50);

  confirm.querySelector(`#fc-cancel-${id}`).addEventListener("click", () => {
    confirm.style.animation = "slideIn 0.15s ease reverse both";
    setTimeout(() => confirm.remove(), 150);
  });

  confirm.querySelector(`#fc-confirm-${id}`).addEventListener("click", async () => {
    confirm.querySelector(`#fc-confirm-${id}`).disabled = true;
    confirm.querySelector(`#fc-confirm-${id}`).textContent = "…";
    try {
      await remove(ref(db, `pads/${padPath}/files/${id}`));
      card.style.animation = "fadeUp 0.2s ease reverse both";
      setTimeout(() => card.remove(), 200);
      showToast("File deleted", "success");
    } catch (e) {
      showToast("Delete failed: " + e.message, "error");
      confirm.remove();
    }
  });
};

window.viewFile = (id) => {
  const f = currentFiles[id];
  if (!f) return;
  if (isImageFile(f.type, f.name)) openImageDialog(f);
  else if (isTextFile(f.type, f.name)) openTextDialog(f);
};

// ─────────────────────
//  File Upload
// ─────────────────────
// Tracks concurrent uploads so progress bar doesn't hide prematurely
let _uploadActive = 0;

async function uploadFile(file) {
  _uploadActive++;
  claimPadOwnership();
  const maxFiles  = effectiveSetting("maxFiles", 9999);
  const maxSizeMB = effectiveSetting("maxFileSizeMB", 9999);

  if (!isAdmin && Object.keys(currentFiles).length >= maxFiles) {
    showErrBanner(`Maximum ${maxFiles} files reached. Delete one first.`);
    return;
  }

  const maxBytes = maxSizeMB * 1024 * 1024;
  if (!isAdmin && file.size > maxBytes) {
    showErrBanner(`File too large. Max allowed: ${maxSizeMB} MB`);
    showToast(`File too large (max ${maxSizeMB} MB)`, "error");
    return;
  }

  errBanner.classList.remove("show");
  progBar.classList.add("show");
  progFilename.textContent = file.name;
  progPct.textContent      = "0%";
  progFill.style.width     = "0%";

  let fakeP  = 0;
  const ticker = setInterval(() => {
    fakeP = Math.min(88, fakeP + Math.random() * 14);
    progFill.style.width = fakeP + "%";
    progPct.textContent  = Math.round(fakeP) + "%";
  }, 240);

  try {
    const form = new FormData();
    form.append("file", file);
    // Admin uploads use admin Cloudinary (validated server-side)
    if (isAdmin && adminToken) form.append("adminToken", adminToken);

    const res  = await fetch(WORKER_URL, { method: "POST", body: form });
    const data = await res.json();

    clearInterval(ticker);
    if (data.error || !data.secure_url) throw new Error(data.error || data.message || "Upload failed");

    progFill.style.width = "100%";
    progPct.textContent  = "100%";

    const expireDays = effectiveSetting("expireDays", 30);
    const expiry = isAdmin
      ? Date.now() + (9999 * 24 * 60 * 60 * 1000)
      : Date.now() + (expireDays * 24 * 60 * 60 * 1000);

    const newRef = push(filesRef);
    await set(newRef, {
      name      : file.name,
      type      : file.type || "application/octet-stream",
      size      : file.size,
      url       : data.secure_url,
      uploadedAt: Date.now(),
      expiresAt : expiry,
      ...(isAdmin ? { byAdmin: true } : {}),
    });

    showToast(`"${file.name}" uploaded!`, "success");
    recordActivity();

  } catch (err) {
    clearInterval(ticker);
    showErrBanner("Upload failed: " + err.message);
    showToast("Upload failed", "error");
  } finally {
    // Only hide progress bar if no other upload will immediately follow
    // The caller (multi-file loop) manages final hide via uploadQueue
    _uploadActive--;
    if (_uploadActive <= 0) {
      _uploadActive = 0;
      setTimeout(() => {
        if (_uploadActive === 0) {
          progBar.classList.remove("show");
          progFill.style.width = "0%";
        }
      }, 700);
    }
    fileInputEl.value = "";
  }
}

function showErrBanner(msg) {
  errBanner.textContent = "⚠ " + msg;
  errBanner.classList.add("show");
  clearTimeout(showErrBanner._t);
  showErrBanner._t = setTimeout(() => errBanner.classList.remove("show"), 5000);
}

// ── Page-wide drag & drop ──
const pageDragOverlay = document.getElementById("page-drag-overlay");
let dragCounter = 0; // track enter/leave properly

document.addEventListener("dragenter", e => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  dragCounter++;
  if (dragCounter === 1) {
    pageDragOverlay.style.display = "flex";
  }
});

document.addEventListener("dragleave", e => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    pageDragOverlay.style.display = "none";
  }
});

document.addEventListener("dragover", e => {
  e.preventDefault(); // allow drop
});

document.addEventListener("drop", e => {
  e.preventDefault();
  dragCounter = 0;
  pageDragOverlay.style.display = "none";

  const restrict = isReadOnly && !isAdmin;
  if (restrict) { showToast("This pad is read-only", "error"); return; }

  // Switch to Files tab if not already there
  const filesTab = document.querySelector('.tab-btn[data-tab="files"]');
  if (filesTab && !filesTab.classList.contains("active")) filesTab.click();

  const files = Array.from(e.dataTransfer.files);
  if (files.length) {
    (async () => { for (const f of files) await uploadFile(f); })();
  }
});

// Upload zone — file input covers the zone, click fires natively
// Keep change handler for multiple files
fileInputEl.addEventListener("change", async () => {
  const files = Array.from(fileInputEl.files || []);
  if (!files.length) return;
  for (const f of files) await uploadFile(f);
  fileInputEl.value = "";
});

// ─────────────────────
//  DIALOG — Image Viewer
// ─────────────────────
function openImageDialog(file) {
  const dlg = createDialogOverlay();
  dlg.innerHTML = `
    <div class="dialog-box" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div class="dialog-header">
        <div class="dialog-icon">🖼️</div>
        <div class="dialog-title-wrap">
          <div class="dialog-title">${sanitize(file.name)}</div>
          <div class="dialog-subtitle">${fmtSize(file.size)} · ${file.type || "image"}</div>
        </div>
        <button class="btn-icon" id="dialog-close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="dialog-body">
        <div class="dialog-img-wrap">
          <img src="${sanitize(file.url)}" alt="${sanitize(file.name)}" id="dialog-img" />
        </div>
      </div>
      <div class="dialog-footer">
        <span style="font-size:12px;color:var(--muted);">Click image to zoom</span>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-sm" onclick="forceDownload('${sanitize(file.url)}', '${sanitize(file.name)}')">↓ Download</button>
        <button class="btn btn-primary btn-sm" id="dialog-close-btn">Close</button>
      </div>
    </div>`;

  document.body.appendChild(dlg);
  dlg.querySelector("#dialog-img").addEventListener("click", e => e.target.classList.toggle("zoomed"));
  dlg.querySelector("#dialog-close").addEventListener("click",     () => closeDialog(dlg));
  dlg.querySelector("#dialog-close-btn").addEventListener("click", () => closeDialog(dlg));
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDialog(dlg); });
}

// ─────────────────────
//  DIALOG — Text Viewer (with linkified URLs)
// ─────────────────────
function linkifyText(raw) {
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return esc.replace(/https?:\/\/[^\s<>"&]+/g, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-link" style="color:var(--accent);text-decoration:underline;cursor:pointer;pointer-events:auto;">${url}</a>`
  );
}

async function openTextDialog(file) {
  const dlg = createDialogOverlay();
  dlg.innerHTML = `
    <div class="dialog-box" role="dialog" aria-modal="true" aria-label="Text viewer">
      <div class="dialog-header">
        <div class="dialog-icon">📝</div>
        <div class="dialog-title-wrap">
          <div class="dialog-title">${sanitize(file.name)}</div>
          <div class="dialog-subtitle">${fmtSize(file.size)} · ${file.type || "text"}</div>
        </div>
        <button class="btn-icon" id="dialog-close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="dialog-body dialog-text-wrap">
        <div id="text-content" style="color:var(--muted2);font-style:italic;font-family:var(--ff-mono);font-size:13px;line-height:1.7;padding:20px 24px;white-space:pre-wrap;word-break:break-word;max-height:65vh;overflow-y:auto;background:#FAFAF8;">Loading…</div>
      </div>
      <div class="dialog-footer">
        <button id="btn-copy-text" class="btn btn-ghost btn-sm">Copy Text</button>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-sm" onclick="forceDownload('${sanitize(file.url)}', '${sanitize(file.name)}')">↓ Download</button>
        <button class="btn btn-primary btn-sm" id="dialog-close-btn">Close</button>
      </div>
    </div>`;

  document.body.appendChild(dlg);
  dlg.querySelector("#dialog-close").addEventListener("click",     () => closeDialog(dlg));
  dlg.querySelector("#dialog-close-btn").addEventListener("click", () => closeDialog(dlg));
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDialog(dlg); });

  const contentEl = dlg.querySelector("#text-content");
  let rawText = "";
  try {
    const res  = await fetch(file.url);
    rawText     = await res.text();
    contentEl.style.color     = "";
    contentEl.style.fontStyle = "";
    contentEl.innerHTML = linkifyText(rawText);

    dlg.querySelector("#btn-copy-text").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(rawText); showToast("Text copied!", "success"); }
      catch { showToast("Copy failed", "error"); }
    });
  } catch (err) {
    contentEl.textContent = "Failed to load file: " + err.message;
    contentEl.style.color = "var(--red)";
  }
}

// ─────────────────────
//  Dialog helpers
// ─────────────────────
function createDialogOverlay() {
  const el = document.createElement("div");
  el.className = "dialog-overlay";
  return el;
}

function closeDialog(el) {
  el.style.animation = "fadeIn 0.18s ease reverse both";
  const box = el.querySelector(".dialog-box");
  if (box) box.style.animation = "dialogIn 0.2s cubic-bezier(0.4,0,1,1) reverse both";
  setTimeout(() => el.remove(), 200);
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const dlg = document.querySelector(".dialog-overlay");
    if (dlg) closeDialog(dlg);
    else closePopup();
  }
});

// ─────────────────────
//  GALLERY
// ─────────────────────
const galleryRef   = ref(db, `pads/${padPath}/gallery`);
const galleryGrid  = document.getElementById("gallery-grid");
const galleryEmpty = document.getElementById("gallery-empty");
const galleryCount = document.getElementById("gallery-count");
const galleryLimitBanner = document.getElementById("gallery-limit-banner");
let currentGallery = {};

// Detect link type
function detectMediaType(url) {
  const ext = url.split("?")[0].split(".").pop().toLowerCase();
  if (["jpg","jpeg","png","gif","webp","avif","svg","bmp"].includes(ext)) return "image";
  if (["mp4","webm","ogg","mov","avi","mkv"].includes(ext)) return "video";
  // Heuristic: youtube, vimeo, etc.
  if (/youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv/.test(url)) return "video";
  // Try to treat unknown as image and let onerror handle it
  return "image";
}

// Generate a unique gradient from a URL string
function urlToGradient(url) {
  // Simple hash
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = Math.imul(31, h) + url.charCodeAt(i) | 0;
  }
  const abs = Math.abs(h);
  // Pick two hues spread 60-130 degrees apart
  const hue1 = abs % 360;
  const hue2 = (hue1 + 60 + (abs % 70)) % 360;
  // Angle from hash
  const angle = (abs >> 4) % 360;
  // Saturation/lightness kept nice: sat 45-70%, light 32-48%
  const sat1  = 45 + (abs % 26);
  const sat2  = 48 + ((abs >> 3) % 22);
  const lit1  = 32 + ((abs >> 6) % 16);
  const lit2  = 38 + ((abs >> 9) % 16);
  return `linear-gradient(${angle}deg, hsl(${hue1},${sat1}%,${lit1}%) 0%, hsl(${hue2},${sat2}%,${lit2}%) 100%)`;
}

// Get a contrasting accent color (light) from the same hash
function urlToAccent(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = Math.imul(31, h) + url.charCodeAt(i) | 0;
  }
  const abs = Math.abs(h);
  const hue = (abs + 180) % 360;
  return `hsl(${hue},90%,80%)`;
}

function renderGalleryGrid() {
  const items    = Object.entries(currentGallery).sort((a,b) => (b[1].addedAt||0) - (a[1].addedAt||0));
  const count    = items.length;
  const maxLinks = effectiveSetting("maxGalleryLinks", 20);
  const restrict = isReadOnly && !isAdmin;

  galleryCount.textContent = count;
  galleryEmpty.style.display   = count === 0 ? "block" : "none";
  galleryGrid.style.display    = count === 0 ? "none"  : "";

  const atLimit = !isAdmin && count >= maxLinks;
  galleryLimitBanner.style.display = (atLimit && !restrict) ? "" : "none";

  const addBtn = document.getElementById("btn-add-gallery-link");
  if (addBtn) {
    addBtn.disabled = restrict || (atLimit && !isAdmin);
    addBtn.title    = restrict ? "Read Only — adding links is disabled" : "";
    addBtn.style.opacity = restrict ? "0.4" : "";
    addBtn.style.cursor  = restrict ? "not-allowed" : "";
  }

  galleryGrid.innerHTML = "";

  for (const [id, item] of items) {
    const type = detectMediaType(item.url);
    const el = document.createElement("div");
    el.className = "gallery-item";
    el.dataset.id = id;

    if (type === "image") {
      el.innerHTML = `
        <img src="${sanitize(item.url)}" alt="" loading="lazy" onerror="this.parentElement.querySelector('.gallery-img-error').style.display='flex'; this.style.display='none';" />
        <div class="gallery-img-error" style="display:none;">
          <span style="font-size:24px;">🖼️</span>
          <span>Could not load</span>
        </div>`;
    } else {
      // Video placeholder with URL-derived gradient
      const domain = (() => { try { return new URL(item.url).hostname.replace("www.",""); } catch { return "video"; } })();
      const grad   = urlToGradient(item.url);
      const accent = urlToAccent(item.url);
      el.innerHTML = `
        <div class="gallery-video-thumb" style="background:${grad};">
          <div class="gallery-video-play" style="color:${accent};">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor"><circle cx="14" cy="14" r="14" fill="rgba(0,0,0,0.28)"/><polygon points="11,8 22,14 11,20" fill="currentColor"/></svg>
          </div>
          <div class="gallery-video-meta">
            <span class="gallery-video-domain">${sanitize(domain)}</span>
          </div>
        </div>`;
    }

    // Actions overlay — hide delete when restricted
    const showDel = !restrict || isAdmin;
    el.innerHTML += `
      <div class="gallery-item-actions">
        <button class="gallery-action-btn gallery-action-open" title="Open link" data-url="${sanitize(item.url)}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 3H3v10h10V9M10 2h4v4M6 10L14 2"/></svg>
        </button>
        ${showDel ? `<button class="gallery-action-btn gallery-action-del" title="Remove" data-id="${id}">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
        </button>` : ""}
      </div>`;

    // Click image to lightbox
    if (type === "image") {
      el.addEventListener("click", e => {
        if (e.target.closest(".gallery-action-btn")) return;
        openLightbox(item.url);
      });
    } else {
      el.addEventListener("click", e => {
        if (e.target.closest(".gallery-action-btn")) return;
        window.open(item.url, "_blank", "noopener,noreferrer");
      });
    }

    galleryGrid.appendChild(el);
  }

  // Event delegation for action buttons
  galleryGrid.querySelectorAll(".gallery-action-open").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      window.open(btn.dataset.url, "_blank", "noopener,noreferrer");
    });
  });

  galleryGrid.querySelectorAll(".gallery-action-del").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      remove(ref(db, `pads/${padPath}/gallery/${btn.dataset.id}`))
        .then(() => showToast("Link removed", "success"))
        .catch(() => showToast("Delete failed", "error"));
    });
  });
}

onValue(galleryRef, snap => {
  currentGallery = snap.exists() ? snap.val() : {};
  renderGalleryGrid();
});

// ── Lightbox ──
function openLightbox(url) {
  const lb = document.createElement("div");
  lb.className = "gallery-lightbox";
  lb.innerHTML = `
    <img src="${sanitize(url)}" alt="" />
    <button class="gallery-lightbox-close" aria-label="Close">✕</button>`;
  document.body.appendChild(lb);
  lb.addEventListener("click", e => {
    if (e.target === lb || e.target.classList.contains("gallery-lightbox-close")) lb.remove();
  });
  document.addEventListener("keydown", function handler(e) {
    if (e.key === "Escape") { lb.remove(); document.removeEventListener("keydown", handler); }
  });
}

// ── Add Link Dialog ──
document.getElementById("btn-add-gallery-link")?.addEventListener("click", () => {
  const restrict = isReadOnly && !isAdmin;
  if (restrict) { showToast("Read Only — adding links is disabled", "error"); return; }
  const maxLinks = effectiveSetting("maxGalleryLinks", 20);
  if (!isAdmin && Object.keys(currentGallery).length >= maxLinks) {
    showToast(`Gallery limit (${maxLinks}) reached`, "error");
    return;
  }

  const dlg = createDialogOverlay();
  dlg.innerHTML = `
    <div class="dialog-box" role="dialog" aria-modal="true" style="max-width:440px;">
      <div class="dialog-header">
        <div class="dialog-icon">🖼️</div>
        <div class="dialog-title-wrap">
          <div class="dialog-title">Add to Gallery</div>
          <div class="dialog-subtitle">Paste a direct image or video URL</div>
        </div>
        <button class="btn-icon" id="glg-close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14 4L4 14M4 4l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="dialog-body" style="padding:20px; display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:12px; color:var(--muted); line-height:1.6;">
          Supports direct image links (<code>.jpg</code>, <code>.png</code>, <code>.gif</code>, <code>.webp</code>, etc.) and video links (YouTube, Vimeo, direct <code>.mp4</code>, etc.)
        </div>
        <input type="url" id="glg-url" class="gallery-url-input" placeholder="https://example.com/image.jpg" autocomplete="off" />
        <div id="glg-preview" style="display:none; border:1.5px solid var(--border); border-radius:var(--radius); overflow:hidden; max-height:200px; text-align:center; background:var(--surface2);">
          <img id="glg-preview-img" src="" alt="" style="max-width:100%; max-height:200px; object-fit:contain;" />
          <div id="glg-preview-video" style="display:none; padding:20px; color:var(--muted); font-size:13px;">
            <div style="font-size:28px; margin-bottom:6px;">▶️</div>
            <div>Video link detected</div>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-ghost btn-sm" id="glg-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="glg-add" disabled>Add to Gallery</button>
      </div>
    </div>`;

  document.body.appendChild(dlg);

  const urlInput  = dlg.querySelector("#glg-url");
  const addBtn    = dlg.querySelector("#glg-add");
  const preview   = dlg.querySelector("#glg-preview");
  const prevImg   = dlg.querySelector("#glg-preview-img");
  const prevVideo = dlg.querySelector("#glg-preview-video");

  let previewTimer = null;
  urlInput.addEventListener("input", () => {
    const val = urlInput.value.trim();
    addBtn.disabled = !val;
    urlInput.classList.remove("error");
    clearTimeout(previewTimer);
    if (!val) { preview.style.display = "none"; return; }
    previewTimer = setTimeout(() => {
      const type = detectMediaType(val);
      preview.style.display = "";
      if (type === "image") {
        prevImg.style.display = "";
        prevVideo.style.display = "none";
        prevImg.src = val;
        prevImg.onerror = () => { preview.style.display = "none"; };
      } else {
        prevImg.style.display = "none";
        prevVideo.style.display = "";
      }
    }, 400);
  });

  urlInput.addEventListener("keydown", e => { if (e.key === "Enter" && !addBtn.disabled) addBtn.click(); });

  addBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    addBtn.disabled = true; addBtn.textContent = "Adding…";
    try {
      const newGalleryRef = push(ref(db, `pads/${padPath}/gallery`));
      await set(newGalleryRef, {
        url,
        type   : detectMediaType(url),
        addedAt: Date.now(),
      });
      showToast("Added to gallery!", "success");
      recordActivity();
      closeDialog(dlg);
    } catch (e) {
      showToast("Failed: " + e.message, "error");
      addBtn.disabled = false; addBtn.textContent = "Add to Gallery";
    }
  });

  dlg.querySelector("#glg-close").addEventListener("click",  () => closeDialog(dlg));
  dlg.querySelector("#glg-cancel").addEventListener("click", () => closeDialog(dlg));
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDialog(dlg); });

  setTimeout(() => urlInput.focus(), 50);
});

// ─────────────────────
//  VIEW COUNT — viewers since last edit/upload/gallery add
// ─────────────────────
(async () => {
  try {
    // Per-browser, per-pad session ID — persists across reloads so one browser = one view
    const storageKey = `txf_sid_${padPath}`;
    let sessionId = localStorage.getItem(storageKey);
    if (!sessionId) {
      sessionId = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(storageKey, sessionId);
    }
    const viewLogRef  = ref(db, `pads/${padPath}/viewLog/${sessionId}`);
    const allLogsRef  = ref(db, `pads/${padPath}/viewLog`);
    const statsRef    = ref(db, `pads/${padPath}/stats`);

    // Write this visit
    const writeView = () => set(viewLogRef, { at: Date.now() }).catch(() => {});
    writeView();
    // Refresh every 90s so active viewers stay counted after activity
    setInterval(writeView, 90_000);

    let _lastActivityAt = 0;
    let _logSnap = null;

    function recount() {
      if (!_logSnap) { updateViewCountUI(0); return; }
      let count = 0;
      _logSnap.forEach(child => {
        const at = child.val()?.at || 0;
        if (at >= _lastActivityAt) count++;
      });
      updateViewCountUI(count);
    }

    onValue(statsRef, snap => {
      _lastActivityAt = snap.exists() ? (snap.val()?.lastActivityAt || 0) : 0;
      recount();
    });

    onValue(allLogsRef, snap => {
      _logSnap = snap.exists() ? snap : null;
      recount();
    });

    // Rename statsRef2 to statsRef (cleaner) — already declared above as statsRef2
    // Cleanup viewLog entries older than 7 days (runs once, 5s after load)
    setTimeout(async () => {
      try {
        const snap   = await get(allLogsRef);
        if (!snap.exists()) return;
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        snap.forEach(child => {
          if ((child.val()?.at || 0) < cutoff) {
            remove(ref(db, `pads/${padPath}/viewLog/${child.key}`)).catch(() => {});
          }
        });
      } catch (_) {}
    }, 5000);

  } catch(e) {
    console.debug("View count error:", e);
  }
})();

function updateViewCountUI(count) {
  const pill  = document.getElementById("presence-pill");
  const label = document.getElementById("presence-count");
  if (!pill || !label) return;
  label.textContent = count;
  const dot = pill.querySelector(".presence-dot");
  if (count > 1) {
    pill.title = `${count} people viewed since last edit`;
    pill.style.background  = "rgba(85,72,224,0.12)";
    pill.style.borderColor = "rgba(85,72,224,0.28)";
    pill.style.color       = "var(--accent)";
    if (dot) dot.style.background = "var(--accent)";
  } else {
    pill.title = count === 1 ? "1 person viewed since last edit" : "No views since last edit";
    pill.style.background  = "rgba(22,163,74,0.08)";
    pill.style.borderColor = "rgba(22,163,74,0.2)";
    pill.style.color       = "#16A34A";
    if (dot) dot.style.background = "#22C55E";
  }
}

// ─────────────────────
//  VIRTUAL KEYBOARD — resize editor
// ─────────────────────
if ("visualViewport" in window) {
  function applyVVHeight() {
    const header = document.querySelector(".app-header");
    const HEADER_H = header ? header.offsetHeight : 96;
    const vvh = window.visualViewport.height;
    const panelsWrap = document.querySelector(".panels-wrap");
    if (panelsWrap) panelsWrap.style.height = (vvh - HEADER_H) + "px";
  }

  window.visualViewport.addEventListener("resize", applyVVHeight);
  window.visualViewport.addEventListener("scroll", applyVVHeight);
}
