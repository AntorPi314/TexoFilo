/**
 * TEXOFILO — Cloudflare Worker
 *
 * ─────────────────────────────────────────────────────────────
 *  SETUP: All secrets are loaded from Cloudflare Worker
 *  Environment Variables — never hardcode them here.
 *
 *  Set these in: Cloudflare Dashboard → Workers → Your Worker
 *                → Settings → Variables and Secrets
 *
 *  Required variables:
 *
 *  CLOUD_NAME           - Your Cloudinary cloud name (public uploads)
 *  API_KEY              - Your Cloudinary API key (public uploads)
 *  API_SECRET           - Your Cloudinary API secret (public uploads)
 *
 *  ADMIN_CLOUD_NAME     - Admin Cloudinary cloud name (admin uploads)
 *  ADMIN_API_KEY        - Admin Cloudinary API key
 *  ADMIN_API_SECRET     - Admin Cloudinary API secret
 *
 *  ADMIN_PASSWORD       - Password for the admin panel
 *
 *  FIREBASE_DB_URL      - e.g. https://your-project-default-rtdb.region.firebasedatabase.app
 *  FIREBASE_DB_SECRET   - Firebase Realtime Database secret (legacy auth)
 *
 * ─────────────────────────────────────────────────────────────
 *
 * Routes:
 *   POST /              → Cloudinary upload proxy
 *   POST /admin/auth    → Verify password → returns session token
 *   POST /admin/save    → Save global settings to Firebase (token required)
 *   POST /admin/pad     → Set per-pad settings e.g. readOnly (token required)
 */

const sessions = new Map();
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 hours

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Only POST allowed' }, 405);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    // ── POST /admin/auth ──
    if (path === '/admin/auth') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

      if (!body?.password) return json({ ok: false, error: 'Missing password' }, 400);

      if (!timingSafeEqual(body.password, env.ADMIN_PASSWORD)) {
        await sleep(400);
        return json({ ok: false, error: 'Wrong password' }, 401);
      }

      const token = await makeToken();
      sessions.set(token, Date.now() + TOKEN_TTL);
      purgeExpiredTokens();
      return json({ ok: true, token });
    }

    // ── POST /admin/save ──
    if (path === '/admin/save') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

      const expiry = sessions.get(body?.token);
      if (!expiry || expiry < Date.now()) {
        return json({ ok: false, error: 'Session expired. Please log in again.' }, 401);
      }

      const s = body?.settings;
      if (!s || typeof s.maxFiles !== 'number' || typeof s.maxFileSizeMB !== 'number') {
        return json({ ok: false, error: 'Invalid settings' }, 400);
      }

      const payload = {
        maxFiles       : clamp(Math.round(s.maxFiles),                  1, 9999),
        maxFileSizeMB  : clamp(Math.round(s.maxFileSizeMB),             1, 9999),
        expireDays     : clamp(Math.round(s.expireDays     || 9999),    1, 9999),
        maxNotepadKB   : clamp(Math.round(s.maxNotepadKB   || 10),      1, 9999),
        maxGalleryLinks: clamp(Math.round(s.maxGalleryLinks || 20),     1, 9999),
        updatedAt      : Date.now(),
      };

      const fbUrl = `${env.FIREBASE_DB_URL}/admin/settings.json?auth=${env.FIREBASE_DB_SECRET}`;
      let fbRes;
      try {
        fbRes = await fetch(fbUrl, {
          method : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(payload),
        });
      } catch (e) {
        return json({ ok: false, error: 'Firebase unreachable: ' + e.message }, 502);
      }

      if (!fbRes.ok) {
        const msg = await fbRes.text().catch(() => '');
        return json({ ok: false, error: `Firebase ${fbRes.status}: ${msg}` }, 502);
      }

      return json({ ok: true, saved: payload });
    }

    // ── POST /admin/pad ──
    if (path === '/admin/pad') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

      const expiry = sessions.get(body?.token);
      if (!expiry || expiry < Date.now()) {
        return json({ ok: false, error: 'Session expired. Please log in again.' }, 401);
      }

      const padPath = (body?.padPath || '').replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
      if (!padPath) return json({ ok: false, error: 'Invalid padPath' }, 400);

      const settings = body?.settings;
      if (!settings) return json({ ok: false, error: 'Invalid settings payload' }, 400);

      const patch = { updatedAt: Date.now() };
      if (typeof settings.readOnly        === 'boolean') patch.readOnly        = settings.readOnly;
      if (typeof settings.maxFiles        === 'number')  patch.maxFiles        = clamp(Math.round(settings.maxFiles),        1, 9999);
      if (typeof settings.maxFileSizeMB   === 'number')  patch.maxFileSizeMB   = clamp(Math.round(settings.maxFileSizeMB),   1, 9999);
      if (typeof settings.expireDays      === 'number')  patch.expireDays      = clamp(Math.round(settings.expireDays),      1, 9999);
      if (typeof settings.maxNotepadKB    === 'number')  patch.maxNotepadKB    = clamp(Math.round(settings.maxNotepadKB),    1, 9999);
      if (typeof settings.maxGalleryLinks === 'number')  patch.maxGalleryLinks = clamp(Math.round(settings.maxGalleryLinks), 1, 9999);

      const fbUrl = `${env.FIREBASE_DB_URL}/pads/${padPath}/settings.json?auth=${env.FIREBASE_DB_SECRET}`;
      let fbRes;
      try {
        fbRes = await fetch(fbUrl, {
          method : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(patch),
        });
      } catch (e) {
        return json({ ok: false, error: 'Firebase unreachable: ' + e.message }, 502);
      }

      if (!fbRes.ok) {
        const msg = await fbRes.text().catch(() => '');
        return json({ ok: false, error: `Firebase ${fbRes.status}: ${msg}` }, 502);
      }

      return json({ ok: true, saved: patch });
    }

    // ── POST / — Cloudinary upload proxy ──
    let formData;
    try { formData = await request.formData(); }
    catch (e) { return json({ error: 'Bad form data: ' + e.message }, 400); }

    const file = formData.get('file');
    if (!file) return json({ error: 'No file provided' }, 400);

    // Admin upload: validate token → use admin Cloudinary account
    const adminToken    = formData.get('adminToken') || '';
    const adminExpiry   = sessions.get(adminToken);
    const isAdminUpload = !!(adminToken && adminExpiry && adminExpiry > Date.now());

    const cloudName = isAdminUpload ? env.ADMIN_CLOUD_NAME : env.CLOUD_NAME;
    const apiKey    = isAdminUpload ? env.ADMIN_API_KEY    : env.API_KEY;
    const apiSecret = isAdminUpload ? env.ADMIN_API_SECRET : env.API_SECRET;

    const ts        = String(Math.round(Date.now() / 1000));
    const signature = await sha1(`timestamp=${ts}` + apiSecret);

    const upload = new FormData();
    upload.append('file',          file);
    upload.append('api_key',       apiKey);
    upload.append('timestamp',     ts);
    upload.append('signature',     signature);
    upload.append('resource_type', 'auto');

    let cloudRes;
    try {
      cloudRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        { method: 'POST', body: upload }
      );
    } catch (e) {
      return json({ error: 'Cloudinary unreachable: ' + e.message }, 502);
    }

    const result = await cloudRes.json();
    return new Response(JSON.stringify(result), {
      status : cloudRes.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
};

// ── Helpers ─────────────────────────────────────────────────

function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    diff |= ((a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0));
  }
  return diff === 0;
}

async function makeToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return buf.reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
}

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
}

async function sha1(msg) {
  const data = new TextEncoder().encode(msg);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}