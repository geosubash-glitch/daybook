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

// Daily reminder notification, kept on this phone only.
const KEY = 'daybook.reminder', ID = 4100;
export function reminderPrefs() { try { return JSON.parse(localStorage.getItem(KEY)) || { on: false, time: '21:00' }; } catch (e) { return { on: false, time: '21:00' }; } }
export async function setReminder(on, time) {
  if (!C()) throw new Error('Reminders work in the Android app.');
  await call('LocalNotifications', 'cancel', { notifications: [{ id: ID }] }).catch(() => {});
  if (on) {
    let p = await call('LocalNotifications', 'checkPermissions');
    if (!p || p.display !== 'granted') p = await call('LocalNotifications', 'requestPermissions');
    if (!p || p.display !== 'granted') throw new Error('Notifications are turned off for Daybook. Allow them in Android settings.');
    const [hour, minute] = time.split(':').map(Number);
    await call('LocalNotifications', 'schedule', { notifications: [{
      id: ID, title: 'Daybook', body: 'A few lines about today?',
      schedule: { on: { hour, minute }, allowWhileIdle: false }, smallIcon: 'ic_stat_daybook', iconColor: '#0F0F10'
    }] });
  }
  try { localStorage.setItem(KEY, JSON.stringify({ on, time })); } catch (e) {}
}
