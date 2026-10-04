// Anonymous health data: crashes and speed only. Never journal text, titles, photos, passcodes or your account.
// Each phone gets a random install id (not linked to your sign-in). Turn it off in Settings.
const OKEY = 'daybook.telemetry', IKEY = 'daybook.iid';
let store = null, sent = 0;
const MAX_PER_SESSION = 25;

export const telemetryOn = () => { try { return localStorage.getItem(OKEY) !== '0'; } catch (e) { return true; } };
export const setTelemetry = (on) => { try { localStorage.setItem(OKEY, on ? '1' : '0'); } catch (e) {} };

function iid() {
  try {
    let v = localStorage.getItem(IKEY);
    if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).slice(0, 36); localStorage.setItem(IKEY, v); }
    return v;
  } catch (e) { return 'unknown'; }
}
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

function device() {
  const ua = navigator.userAgent || '';
  const a = /Android\s([\d.]+)/.exec(ua), m = /;\s([^;)]+)\sBuild\//.exec(ua) || /;\s([A-Za-z0-9\- _]+)\)\sAppleWebKit/.exec(ua);
  return clip((a ? 'Android ' + a[1] : 'Other') + (m ? ' · ' + m[1] : ''), 60);
}
const platform = () => (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform() ? 'app' : 'web');

export function track(ev, extra) {
  if (!store || !store.logTelemetry || !telemetryOn() || sent >= MAX_PER_SESSION) return;
  sent++;
  const doc = Object.assign({ iid: iid(), t: Date.now(), ev: clip(ev, 30), v: '1.0', plat: platform(), os: device() }, extra || {});
  Promise.resolve(store.logTelemetry(doc)).catch(() => {});
}

export function initTelemetry(s) {
  if (store) return; store = s;
  window.addEventListener('error', (e) => {
    // Only where it broke, never page content. Message text is cut short.
    track('error', { msg: clip(e && e.message, 160), at: clip(((e && e.filename) || '').split('/').pop() + ':' + ((e && e.lineno) || 0), 80) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason; track('error', { msg: clip(r && r.message || r, 160), at: 'promise' });
  });
}
