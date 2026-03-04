// ─────────────────────────────────────────
//  TEXOFILO — Pad Page Logic
//  Features: Notepad, File Share, Admin (read-only, unlimited uploads),
//            Link Copy, QR Code, Linkified text viewer
// ─────────────────────────────────────────

import {
  db, WORKER_URL, THIRTY_DAYS, MAX_FILES,
  fmtSize, daysLeft, getFileIcon, isImageFile, isTextFile,
  sanitize, showToast
} from "./config.js";

import {
  ref, set, get, onValue, push, remove
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

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
const isAdmin    = sessionStorage.getItem("txf_admin_auth") === "1";
const adminToken = sessionStorage.getItem("txf_admin_token") || null;

if (isAdmin) {
  const adminControls = document.getElementById("admin-controls");
  if (adminControls) adminControls.style.display = "flex";
}

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
const readonlyBtn     = document.getElementById("btn-readonly-toggle");

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
//  Read-Only state
// ─────────────────────
let isReadOnly = false;

const padSettingsRef = ref(db, `pads/${padPath}/settings`);

onValue(padSettingsRef, snap => {
  isReadOnly = !!(snap.exists() && snap.val().readOnly === true);
  applyReadOnlyMode();
  if (isAdmin) updateReadOnlyButton();
});

function applyReadOnlyMode() {
  const restrict = isReadOnly && !isAdmin;

  // Notepad
  notepad.disabled = restrict;
  document.body.classList.toggle("readonly-mode", restrict);

  // Banner
  if (readonlyBanner) readonlyBanner.style.display = restrict ? "block" : "none";

  // Upload zone
  if (restrict) {
    uploadZone.classList.add("disabled");
  } else {
    // Let renderFileList decide based on file count
    renderFileList();
  }

  // Re-render file list to show/hide delete buttons
  renderFileList();
}

function updateReadOnlyButton() {
  if (!readonlyBtn) return;
  if (isReadOnly) {
    readonlyBtn.textContent = "🔒 Read Only: ON";
    readonlyBtn.className   = "btn btn-sm btn-danger";
  } else {
    readonlyBtn.textContent = "🔓 Read Only: OFF";
    readonlyBtn.className   = "btn btn-sm btn-ghost";
  }
}

// Admin read-only toggle
readonlyBtn?.addEventListener("click", async () => {
  if (!isAdmin) return;
  const token = sessionStorage.getItem("txf_admin_token");
  if (!token) { showToast("Admin session expired — please log in again", "error"); return; }

  const newVal = !isReadOnly;
  readonlyBtn.disabled = true;
  try {
    const res  = await fetch(`${WORKER_URL}admin/pad`, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ token, padPath, settings: { readOnly: newVal } }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed");
    showToast(newVal ? "🔒 Read Only enabled for this pad" : "🔓 Read Only disabled", newVal ? "info" : "success");
  } catch (e) {
    showToast("Failed to toggle: " + e.message, "error");
  } finally {
    readonlyBtn.disabled = false;
  }
});

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

function updateGutter() {
  if (!gutter) return;
  const lines = notepad.value.split("\n").length;
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
    notepad.value = snap.val().content || "";
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
  if (remote !== notepad.value) {
    const pos = notepad.selectionStart;
    isRemote = true;
    notepad.value = remote;
    isRemote = false;
    try { notepad.selectionStart = notepad.selectionEnd = pos; } catch (_) {}
    updateStats();
    updateGutter();
  }
});

function doSave() {
  set(noteRef, { content: notepad.value, updatedAt: Date.now() })
    .then(setSaved)
    .catch(setSaveError);
}

notepad.addEventListener("input", () => {
  if (isRemote) return;
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
    const s = notepad.selectionStart, end = notepad.selectionEnd;
    notepad.value = notepad.value.slice(0, s) + "  " + notepad.value.slice(end);
    notepad.selectionStart = notepad.selectionEnd = s + 2;
    notepad.dispatchEvent(new Event("input"));
  }
});

function updateStats() {
  const v = notepad.value;
  const c = v.length;
  const l = v ? v.split("\n").length : 0;
  const w = v.trim() ? v.trim().split(/\s+/).length : 0;
  if (noteStats) noteStats.textContent = `${c.toLocaleString()} chars · ${l} lines · ${w} words`;
}

document.getElementById("btn-copy-all")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(notepad.value);
    showToast("Copied to clipboard", "success");
  } catch {
    notepad.select();
    document.execCommand("copy");
    showToast("Copied!", "success");
  }
});

document.getElementById("btn-clear")?.addEventListener("click", () => {
  if (!notepad.value.trim()) return;
  if (!confirm("Clear all text in this notepad?")) return;
  notepad.value = "";
  doSave();
  updateStats();
  updateGutter();
  showToast("Cleared");
});

document.getElementById("btn-download-txt")?.addEventListener("click", () => {
  const blob = new Blob([notepad.value], { type: "text/plain;charset=utf-8" });
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
const filesRef      = ref(db, `pads/${padPath}/files`);
let currentFiles    = {};
let adminMaxFiles   = 5;
let adminMaxSizeMB  = 100;
let adminExpireDays = 30;

get(ref(db, "admin/settings")).then(snap => {
  if (snap.exists()) {
    const s = snap.val();
    if (s.maxFiles)      adminMaxFiles   = s.maxFiles;
    if (s.maxFileSizeMB) adminMaxSizeMB  = s.maxFileSizeMB;
    if (s.expireDays)    adminExpireDays = s.expireDays;
  }
}).catch(() => {});

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

function renderFileList() {
  const entries = Object.entries(currentFiles).sort((a, b) => b[1].uploadedAt - a[1].uploadedAt);
  const count   = entries.length;
  const restrict = isReadOnly && !isAdmin;

  fileCountBadge.textContent = count;

  if (!restrict) {
    limitBanner.classList.toggle("show", !isAdmin && count >= adminMaxFiles);
    uploadZone.classList.toggle("disabled", !isAdmin && count >= adminMaxFiles);
  } else {
    limitBanner.classList.remove("show");
    uploadZone.classList.add("disabled");
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
    const exp      = daysLeft(f.expiresAt);
    const icon     = getFileIcon(f.type, f.name);
    const canView  = isImageFile(f.type, f.name) || isTextFile(f.type, f.name);
    const showDel  = !restrict || isAdmin;

    const thumbHtml = isImageFile(f.type, f.name)
      ? `<div class="fc-thumb"><img src="${sanitize(f.url)}" alt="" loading="lazy" /></div>`
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
          <a href="${sanitize(f.url)}" download="${sanitize(f.name)}" class="btn btn-sm btn-ghost">↓</a>
          ${deleteBtn}
        </div>
      </div>`;
  }).join("");
}

window.deleteFile = async (id) => {
  if (!confirm("Delete this file permanently?")) return;
  try {
    await remove(ref(db, `pads/${padPath}/files/${id}`));
    showToast("File deleted", "success");
  } catch (e) {
    showToast("Delete failed: " + e.message, "error");
  }
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
async function uploadFile(file) {
  // Admin bypasses all limits
  if (!isAdmin && Object.keys(currentFiles).length >= adminMaxFiles) {
    showErrBanner(`Maximum ${adminMaxFiles} files reached. Delete one first.`);
    return;
  }

  const maxBytes = adminMaxSizeMB * 1024 * 1024;
  if (!isAdmin && file.size > maxBytes) {
    showErrBanner(`File too large. Max allowed: ${adminMaxSizeMB} MB`);
    showToast(`File too large (max ${adminMaxSizeMB} MB)`, "error");
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

    // Admin uploads: no expiry (set far future); others use admin setting
    const expiry = isAdmin
      ? Date.now() + (9999 * 24 * 60 * 60 * 1000)
      : Date.now() + (adminExpireDays * 24 * 60 * 60 * 1000);

    const newRef = push(filesRef);
    await set(newRef, {
      name      : file.name,
      type      : file.type || "application/octet-stream",
      size      : file.size,
      url       : data.secure_url,
      uploadedAt: Date.now(),
      expiresAt : expiry,
      byAdmin   : isAdmin || undefined,
    });

    showToast(`"${file.name}" uploaded!`, "success");

  } catch (err) {
    clearInterval(ticker);
    showErrBanner("Upload failed: " + err.message);
    showToast("Upload failed", "error");
  } finally {
    setTimeout(() => {
      progBar.classList.remove("show");
      progFill.style.width = "0%";
    }, 700);
    fileInputEl.value = "";
  }
}

function showErrBanner(msg) {
  errBanner.textContent = "⚠ " + msg;
  errBanner.classList.add("show");
  clearTimeout(showErrBanner._t);
  showErrBanner._t = setTimeout(() => errBanner.classList.remove("show"), 5000);
}

// Drag & drop
uploadZone.addEventListener("dragover",  e => { e.preventDefault(); if (!uploadZone.classList.contains("disabled")) uploadZone.classList.add("over"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("over"));
uploadZone.addEventListener("drop", e => {
  e.preventDefault();
  uploadZone.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) uploadFile(f);
});
uploadZone.addEventListener("click", () => { if (!uploadZone.classList.contains("disabled")) fileInputEl.click(); });
fileInputEl.addEventListener("change", () => { if (fileInputEl.files[0]) uploadFile(fileInputEl.files[0]); });

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
        <a href="${sanitize(file.url)}" download="${sanitize(file.name)}" class="btn btn-ghost btn-sm">↓ Download</a>
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
  // Escape HTML then wrap URLs in anchor tags
  const esc = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return esc.replace(/https?:\/\/[^\s<>"&]+/g, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-link">${url}</a>`
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
        <pre id="text-content" style="color:var(--muted2);font-style:italic;">Loading…</pre>
      </div>
      <div class="dialog-footer">
        <button id="btn-copy-text" class="btn btn-ghost btn-sm">Copy Text</button>
        <div style="flex:1;"></div>
        <a href="${sanitize(file.url)}" download="${sanitize(file.name)}" class="btn btn-ghost btn-sm">↓ Download</a>
        <button class="btn btn-primary btn-sm" id="dialog-close-btn">Close</button>
      </div>
    </div>`;

  document.body.appendChild(dlg);
  dlg.querySelector("#dialog-close").addEventListener("click",     () => closeDialog(dlg));
  dlg.querySelector("#dialog-close-btn").addEventListener("click", () => closeDialog(dlg));
  dlg.addEventListener("click", e => { if (e.target === dlg) closeDialog(dlg); });

  const pre = dlg.querySelector("#text-content");
  let rawText = "";
  try {
    const res  = await fetch(file.url);
    rawText     = await res.text();
    pre.style.color     = "";
    pre.style.fontStyle = "";
    // Use innerHTML with linkified text so URLs become clickable links
    pre.innerHTML = linkifyText(rawText);

    dlg.querySelector("#btn-copy-text").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(rawText); showToast("Text copied!", "success"); }
      catch { showToast("Copy failed", "error"); }
    });
  } catch (err) {
    pre.textContent  = "Failed to load file: " + err.message;
    pre.style.color  = "var(--red)";
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
