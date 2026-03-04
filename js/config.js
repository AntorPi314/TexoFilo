// ─────────────────────────────────────────
//  TEXOFILO — Firebase Config & Shared Utils
// ─────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getDatabase }   from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";

// ── Firebase ──
const firebaseConfig = {
  apiKey           : "AIzaSyCRAK__mcw0s37EmQHmwKWAP1LWdlbvH-g",
  authDomain       : "texofilo.firebaseapp.com",
  databaseURL      : "https://texofilo-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId        : "texofilo",
  storageBucket    : "texofilo.firebasestorage.app",
  messagingSenderId: "758190119913",
  appId            : "1:758190119913:web:a9cdfcc2b7876f27b44978"
};

export const app = initializeApp(firebaseConfig);
export const db  = getDatabase(app);

// ── Constants ──
export const WORKER_URL   = "https://texofilo.antornslm.workers.dev/";
export const THIRTY_DAYS  = 30 * 24 * 60 * 60 * 1000;
export const MAX_FILES    = 5;

// ── Helpers ──
export function fmtSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024)       return bytes + " B";
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(1) + " GB";
}

export function daysLeft(expiresAt) {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return { label: "Expired", cls: "expired" };
  const days = Math.ceil(diff / 86400000);
  return {
    label: days === 1 ? "1 day left" : `${days} days left`,
    cls  : days <= 5 ? "expiry" : ""
  };
}

export function getFileIcon(type, name) {
  const t   = (type || "").toLowerCase();
  const ext = ((name || "").split(".").pop() || "").toLowerCase();
  if (t.startsWith("image/"))  return "🖼️";
  if (t.startsWith("video/"))  return "🎬";
  if (t.startsWith("audio/"))  return "🎵";
  if (t === "application/pdf") return "📕";
  const zipExts  = ["zip","rar","7z","tar","gz","bz2"];
  const codeExts = ["js","ts","jsx","tsx","py","rb","php","html","css","xml","yaml","yml","sh","bash","sql","java","c","cpp","h","cs","go","rs","swift","kt","json","toml","ini","env"];
  const docExts  = ["doc","docx","pdf","odt"];
  const sheetExts= ["xls","xlsx","csv"];
  if (zipExts.includes(ext))   return "📦";
  if (codeExts.includes(ext))  return "💾";
  if (docExts.includes(ext))   return "📄";
  if (sheetExts.includes(ext)) return "📊";
  if (["txt","md","log"].includes(ext)) return "📝";
  return "📄";
}

export function isImageFile(type, name) {
  if ((type || "").startsWith("image/")) return true;
  const ext = ((name || "").split(".").pop() || "").toLowerCase();
  return ["jpg","jpeg","png","gif","webp","svg","bmp","ico","avif"].includes(ext);
}

export function isTextFile(type, name) {
  const t = (type || "").toLowerCase();
  if (t.startsWith("text/")) return true;
  const ext = ((name || "").split(".").pop() || "").toLowerCase();
  const textExts = [
    "txt","md","json","js","ts","jsx","tsx","py","rb","php","html","css",
    "xml","yaml","yml","sh","bash","sql","java","c","cpp","h","cs","go",
    "rs","swift","kt","toml","ini","cfg","env","gitignore","log","htaccess",
    "r","lua","pl","hs","ex","exs","scala","vb","bat","ps1","fish","zsh",
  ];
  return textExts.includes(ext);
}

export function sanitize(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Toast ──
const toastContainer = (() => {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  return el;
})();

export function showToast(msg, type = "default") {
  const item = document.createElement("div");
  item.className = "toast-item";

  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const icon  = icons[type] || "";

  item.innerHTML = icon
    ? `<span style="opacity:.7;font-size:12px;">${icon}</span> ${sanitize(msg)}`
    : sanitize(msg);

  if (type === "error") item.style.background = "#DC2626";
  if (type === "success") item.style.background = "#16A34A";

  toastContainer.appendChild(item);

  setTimeout(() => {
    item.classList.add("removing");
    item.addEventListener("animationend", () => item.remove());
  }, 3000);
}
