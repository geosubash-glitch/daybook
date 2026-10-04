// Android-only extras, reached through the app's built-in bridge. On the web every function is a quiet no-op.
const C = () => { const c = window.Capacitor; return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() && typeof c.nativePromise === 'function' ? c : null; };
export const isNative = () => !!C();
const call = (plugin, method, opts) => { const c = C(); return c ? c.nativePromise(plugin, method, opts || {}) : Promise.resolve(null); };

// A light tap of vibration, like system apps give on key actions.
export function haptic(kind) {
  if (!C()) return;
  (kind === 'success' ? call('Haptics', 'notification', { type: 'SUCCESS' }) : call('Haptics', 'impact', { style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' })).catch(() => {});
}

// The Android back button. The handler returns true when it handled the press (closed a panel).
export function onBack(handler) {
  const c = C(); if (!c || typeof c.addListener !== 'function') return;
  c.addListener('App', 'backButton', () => { if (!handler()) call('App', 'minimizeApp').catch(() => {}); });
}

// ---- Privacy helpers (fingerprint unlock, recent-apps screen) ----
export const bioAvailable = () => call('DaybookNative', 'biometricAvailable').then((r) => !!(r && r.available)).catch(() => false);
export const bioAuth = (title) => call('DaybookNative', 'biometricAuth', { title: title || 'Unlock Daybook' }).then(() => true).catch(() => false);
export const setRecentsPrivacy = (on) => call('DaybookNative', 'setRecentsPrivacy', { on: !!on }).catch(() => {});

// Settings that belong to this phone only (not synced): when to lock, fingerprint, recent-apps privacy.
const DKEY = 'daybook.device';
const DDEF = { lockAfter: 120, bio: false, recents: true };
export function devicePrefs() { try { return Object.assign({}, DDEF, JSON.parse(localStorage.getItem(DKEY))); } catch (e) { return Object.assign({}, DDEF); } }
export function saveDevicePrefs(p) { try { localStorage.setItem(DKEY, JSON.stringify(p)); } catch (e) {} }

// ---- Daily reminder notification, kept on this phone only. The text is always generic: it never shows journal content. ----
const KEY = 'daybook.reminder', ID = 4100, SNOOZE_ID = 4101;
export function reminderPrefs() {
  let r = {}; try { r = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  return { on: !!r.on, time: r.time || '21:00' };
}
function saveReminder(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} }
export function saveReminderTime(time) { saveReminder({ on: reminderPrefs().on, time }); }
const LN = (m, o) => call('LocalNotifications', m, o);
async function allowed() {
  let p = await LN('checkPermissions');
  if (!p || p.display !== 'granted') p = await LN('requestPermissions');
  return !!p && p.display === 'granted';
}
const ACTIONS = { id: 'REMINDER', actions: [{ id: 'snooze', title: 'Snooze 1 hour' }, { id: 'dismiss', title: 'Dismiss', destructive: true }] };
const GENERIC = { title: 'Daybook', body: 'A few lines about today?', actionTypeId: 'REMINDER', smallIcon: 'ic_stat_daybook', iconColor: '#0F0F10' };

// Snooze and Dismiss buttons on the notification.
export function initNotificationActions() {
  const c = C(); if (!c || typeof c.addListener !== 'function') return;
  LN('registerActionTypes', { types: [ACTIONS] }).catch(() => {});
  c.addListener('LocalNotifications', 'localNotificationActionPerformed', (ev) => {
    const id = ev && ev.actionId;
    if (id === 'dismiss') { LN('cancel', { notifications: [{ id: SNOOZE_ID }] }).catch(() => {}); return; }
    if (id !== 'snooze') return;
    const at = new Date(Date.now() + 3600000);
    LN('schedule', { notifications: [Object.assign({ id: SNOOZE_ID, schedule: { at, allowWhileIdle: true } }, GENERIC)] }).catch(() => {});
  });
}

export async function setReminder(on, time) {
  if (!C()) throw new Error('Reminders work in the Android app.');
  if (on && !(await allowed())) throw new Error('Notifications are turned off for Daybook. Allow them in Android settings.');
  await LN('cancel', { notifications: [{ id: ID }, { id: SNOOZE_ID }] }).catch(() => {});
  if (on) {
    const [hour, minute] = time.split(':').map(Number);
    await LN('schedule', { notifications: [Object.assign({ id: ID, schedule: { on: { hour, minute }, allowWhileIdle: false } }, GENERIC)] });
  }
  saveReminder({ on, time });
}

// Data for the home-screen widget: the dates you have written on (about the last 400 days).
export function setWidgetDays(days) {
  return call('Preferences', 'set', { key: 'daybook.widget', value: JSON.stringify({ days, updated: Date.now() }) }).catch(() => {});
}
export function clearWidget() { return call('Preferences', 'remove', { key: 'daybook.widget' }).catch(() => {}); }
