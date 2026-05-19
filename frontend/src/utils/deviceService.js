const LS_KEY     = 'ss_device_token';
const IDB_DB     = 'ss_device_db';
const IDB_STORE  = 'kv';
const IDB_KEY    = 'device_token';
const COOKIE_KEY = 'ss_dt';

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function detectBrowser(ua) {
  if (/Edg\//.test(ua))          return 'Edge';
  if (/OPR\/|Opera/.test(ua))    return 'Opera';
  if (/Chrome\//.test(ua))       return 'Chrome';
  if (/Firefox\//.test(ua))      return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  return 'Browser';
}

function detectOS(ua) {
  if (/Windows NT 1[01]/.test(ua)) return 'Windows 11/10';
  if (/Windows/.test(ua))          return 'Windows';
  if (/Mac OS X/.test(ua))         return 'macOS';
  if (/Android/.test(ua))          return 'Android';
  if (/iPhone|iPad/.test(ua))      return 'iOS';
  if (/Linux/.test(ua))            return 'Linux';
  return 'Unknown OS';
}

// ── Cookie helpers ───────────────────────────────────────────────────────────
function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name, value, days = 365) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  // SameSite=Strict so it travels with same-origin requests but not cross-site
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${exp};path=/;SameSite=Strict`;
}

// ── IndexedDB helpers ────────────────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = ()  => resolve(null);
  });
}

async function idbGet(db) {
  if (!db) return null;
  return new Promise((resolve) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = (e) => resolve(e.target.result || null);
    req.onerror   = ()  => resolve(null);
  });
}

async function idbSet(db, value) {
  if (!db) return;
  return new Promise((resolve) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, IDB_KEY);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a stable device token.  Checks (in priority order):
 *   1. IndexedDB   — survives cache clears, persists across sessions
 *   2. Cookie      — survives localStorage clears
 *   3. localStorage — fallback
 * If none exist, generates a new UUID and writes to all three.
 */
export async function getOrCreateDeviceToken() {
  let token = null;
  let db    = null;

  try { db = await openIDB(); } catch (_) {}

  // Read from all stores, prefer the one that exists
  const idbToken = await idbGet(db);
  const lsToken  = (() => { try { return localStorage.getItem(LS_KEY); } catch (_) { return null; } })();
  const ckToken  = (() => { try { return readCookie(COOKIE_KEY); } catch (_) { return null; } })();

  token = idbToken || lsToken || ckToken;

  if (!token) {
    token = 'web_' + generateUUID().replace(/-/g, '');
  }

  // Write to all stores so whichever survives a clear wins next time
  try { await idbSet(db, token); }       catch (_) {}
  try { localStorage.setItem(LS_KEY, token); } catch (_) {}
  try { writeCookie(COOKIE_KEY, token); }      catch (_) {}

  return token;
}

// Synchronous fallback for callers that can't await
export function getOrCreateDeviceTokenSync() {
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (ls) return ls;
  } catch (_) {}
  try {
    const ck = readCookie(COOKIE_KEY);
    if (ck) return ck;
  } catch (_) {}
  const token = 'web_' + generateUUID().replace(/-/g, '');
  try { localStorage.setItem(LS_KEY, token); } catch (_) {}
  try { writeCookie(COOKIE_KEY, token); }      catch (_) {}
  return token;
}

export function getDeviceInfo() {
  const ua = navigator.userAgent;
  return {
    label:    `${detectBrowser(ua)} · ${detectOS(ua)}`,
    platform: 'web',
    screen:   `${window.screen?.width ?? '?'}×${window.screen?.height ?? '?'}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
  };
}
