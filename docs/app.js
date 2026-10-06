import { config, links } from './config.js';
import { correct, fixError } from './grammar.js';
import { initTelemetry, track, telemetryOn, setTelemetry } from './telemetry.js';
import { isNative, haptic, onBack, reminderPrefs, setReminder, saveReminderTime, initNotificationActions, bioAvailable, bioAuth, setRecentsPrivacy, devicePrefs, saveDevicePrefs, setWidgetDays, clearWidget } from './native.js';

const $ = (s) => document.querySelector(s);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const RECENT_DAYS = 45; // days kept live on screen; older days are fetched when you open them

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const todayKey = () => keyOf(new Date());
const longDate = (k) => { const d = parseKey(k); return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = (t) => { t = (t || '').trim(); return t ? t.split(/\s+/).length : 0; };
const hasContent = (e) => !!(e && (((e.body || '').trim()) || ((e.title || '').trim()) || (e.photos && e.photos.length)));
const fmt = (n) => n.toLocaleString();
const dayNumber = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
const icon = (id) => '<svg class="ic"><use href="#i-' + id + '"/></svg>';
const timeNow = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const isDate = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k || '') && keyOf(parseKey(k)) === k;
const hasCrypto = !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);

let store = null;
let entries = {};              // date -> entry or null (known to be empty)
let monthsLoaded = new Set();
let recentFrom = '';
let cur = todayKey();
let calM = { y: 0, m: 0 };
let photos = [];
let photoCache = {};
let dirty = false, timer = null, writing = Promise.resolve();
let loaded = false, editable = false, started = false, unwatch = null, navToken = 0;
let lockData = null, prefs = {}, hiddenAt = 0, failCount = 0, blockedUntil = 0;
let totalCount = null, firstDate = null, allLoaded = false;
let pending = 0;
let syncFailed = false; const failedWrites = {};
function renderSync() {
  const el = $('#sync'); if (!el) return;
  let t, st;
  if (syncFailed) { t = "Couldn't sync · Tap to retry"; st = 'bad'; }
  else if (!navigator.onLine && (pending || dirty)) { t = 'Saved on this device · Waiting to sync'; st = 'wait'; }
  else if (pending) { t = 'Syncing…'; st = 'busy'; }
  else if (dirty) { t = 'Saving…'; st = 'busy'; }
  else { t = 'Synced'; st = 'ok'; }
  if (el.textContent !== t) el.textContent = t;
  el.dataset.state = st; el.disabled = st !== 'bad';
}
async function retrySync() {
  const dates = Object.keys(failedWrites); syncFailed = false; renderSync();
  for (const d of dates) {
    const data = failedWrites[d]; delete failedWrites[d]; pending++; renderSync();
    store.setEntry(d, data).then(() => { pending--; renderSync(); })
      .catch(() => { pending--; failedWrites[d] = data; syncFailed = true; renderSync(); });
  }
}
let autoFix = false, fixBusy = false, fixTimer = null, undoInfo = null, lastFixed = '';

/* ---------- screens ---------- */
function gate(name) {
  ['#setup', '#signin', '#lock'].forEach((s) => { $(s).hidden = s !== name; });
  $('#shell').hidden = name !== null && name !== '#shell';
  if (name === '#shell') ['#setup', '#signin', '#lock'].forEach((s) => { $(s).hidden = true; });
}
function setStatus(t) {
  const s = $('#status');
  if (t === 'saved') { s.innerHTML = icon('check'); s.setAttribute('aria-label', 'Saved'); s.title = 'Saved'; }
  else { s.textContent = t; s.removeAttribute('aria-label'); s.title = ''; }
}
const setMsg = (t) => { $('#msg').textContent = t; $('#lpMsg').textContent = t; };
function showBanner(t) { const b = $('#banner'); b.textContent = t; b.hidden = !t; }

/* ---------- boot and sign-in ---------- */
async function boot() {
  if (config.backend === 'firebase' && /PASTE_/.test(JSON.stringify(config.firebase))) { gate('#setup'); return; }
  try {
    const mod = await import(config.backend === 'memory' ? './store-memory.js' : './store-firebase.js');
    store = mod.createStore(config);
  } catch (e) { gate('#signin'); $('#siErr').textContent = 'Could not load the database. Check your connection and reload.'; return; }
  store.onAuth(onAuth);
}
let acctProvider = 'password';
async function onAuth(user) {
  if (!user) { teardown(); gate('#signin'); return; }
  $('#acct').textContent = user.email;
  acctProvider = user.provider || 'password';
  try {
    lockData = await store.getSetting('lock');
    prefs = (await store.getSetting('prefs')) || {};
  } catch (e) {
    teardown(); gate('#signin');
    $('#siErr').textContent = 'Signed in, but the journal could not be reached. Check your connection and that the Firestore rules were published.';
    return;
  }
  autoFix = !!prefs.autoFix && grammarOk(); setAutoUi();
  if (lockData && lockData.hash && hasCrypto) showLock(); else start();
}
function teardown() {
  if (widgetDays) { widgetDays = null; clearWidget(); }
  if (unwatch) { try { unwatch(); } catch (e) {} unwatch = null; }
  clearTimeout(timer); clearTimeout(fixTimer);
  entries = {}; monthsLoaded = new Set(); photoCache = {}; photos = [];
  loaded = editable = started = dirty = allLoaded = false; pending = 0; syncFailed = false; for (const k in failedWrites) delete failedWrites[k]; renderSync();
  lockData = null; prefs = {}; totalCount = null; firstDate = null; undoInfo = null;
  $('#body').value = ''; $('#title').value = ''; $('#results').textContent = ''; $('#q').value = '';
  $('#lockPanel').hidden = true; $('#browse').hidden = true; $('#exportPanel').hidden = true;
  $('#siPass').value = '';
}
$('#signinForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('#siEmail').value.trim(), pass = $('#siPass').value;
  if (!email || !pass) { $('#siErr').textContent = 'Enter your email and password.'; return; }
  $('#siErr').textContent = 'Signing in…';
  try { await store.signIn(email, pass); $('#siErr').textContent = ''; }
  catch (e) {
    const c = e && e.code || '';
    $('#siErr').textContent = /too-many/.test(c) ? 'Too many attempts. Wait a few minutes.' : /network/.test(c) ? 'No connection.' : 'That email or password is not right.';
  }
});
$('#siGoogle').addEventListener('click', async () => {
  $('#siErr').textContent = '';
  try { await store.signInGoogle(); }
  catch (e) {
    const c = e && e.code || '', m = String(e && e.message || '');
    if (/popup-closed|cancel/i.test(c + m)) return;
    $('#siErr').textContent = /network/.test(c) ? 'No connection.' : /popup-blocked/.test(c) ? 'Your browser blocked the Google window. Allow pop-ups for this page and try again.' : /unauthorized-domain/.test(c) ? 'This web address is not approved in Firebase yet.' : 'Google sign-in did not complete. ' + (String(e && (e.code || e.message) || '').slice(0, 90)) + ' Try again.';
  }
});
$('#siReset').addEventListener('click', async () => {
  const email = $('#siEmail').value.trim();
  if (!email) { $('#siErr').textContent = 'Type your email above first.'; return; }
  try { await store.resetPassword(email); $('#siErr').textContent = 'If that account exists, a reset email is on its way.'; }
  catch (e) { $('#siErr').textContent = 'Could not send the email right now.'; }
});
function resetDelete() { $('#delBox').hidden = true; $('#delOpen').hidden = false; $('#delPass').value = ''; }
$('#delOpen').addEventListener('click', () => {
  $('#delOpen').hidden = true; $('#delBox').hidden = false;
  const pw = acctProvider === 'password';
  $('#delPass').hidden = !pw; $('#delGoogle').hidden = pw;
  $('#lpMsg').textContent = '';
});
$('#delCancel').addEventListener('click', resetDelete);
$('#delGo').addEventListener('click', async () => {
  if (!navigator.onLine) { $('#lpMsg').textContent = 'Connect to the internet to delete your account.'; return; }
  const btn = $('#delGo'); btn.disabled = true; $('#lpMsg').textContent = 'Checking it is you…';
  try {
    clearTimeout(timer); dirty = false; pending = 0;
    await store.deleteAccount($('#delPass').value, (n) => { $('#lpMsg').textContent = 'Erasing ' + n + '…'; });
    $('#lpMsg').textContent = '';
  } catch (e) {
    const c = e && e.code || '';
    $('#lpMsg').textContent = /wrong-password|invalid-credential/.test(c) ? 'That password is not right.' : /popup-closed|cancel/i.test(c + (e && e.message || '')) ? 'Cancelled. Nothing was deleted.' : /network/.test(c) ? 'No connection. Try again.' : 'Could not finish. Some data may have been erased. Sign in and try again.';
    btn.disabled = false;
  }
});
$('#signOut').addEventListener('click', async () => {
  await flush();
  if (pending && !navigator.onLine) { $('#lpMsg').textContent = 'You have writing that has not uploaded yet. Connect to the internet first.'; return; }
  if (pending) { $('#lpMsg').textContent = 'Uploading your writing first…'; try { await store.sync(); } catch (e) {} }
  try { await store.signOut(); } catch (e) {}
});

/* ---------- live data ---------- */
function start() {
  if (started) return;
  started = true;
  initTelemetry(store);
  gate('#shell');
  const d = new Date(); d.setDate(d.getDate() - RECENT_DAYS);
  recentFrom = keyOf(d);
  const t = parseKey(cur); calM = { y: t.getFullYear(), m: t.getMonth() };
  lockEditor('Loading…');
  netState();
  unwatch = store.watchRecent(recentFrom, (rows) => {
    const seen = new Set();
    rows.forEach((e) => { if (isDate(e.date)) { entries[e.date] = e; seen.add(e.date); } });
    Object.keys(entries).forEach((k) => { if (k >= recentFrom && !seen.has(k) && !(dirty && k === cur)) delete entries[k]; });
    if (!loaded) { loaded = true; goto(cur); refreshMeta(); track('app_open', { ms: Math.round(performance.now()) }); }
    else afterEntriesChanged();
  }, () => goOffline('Lost the connection to your journal. Check your internet and reload.'));
}
// Home-screen widget (Android): keep its list of written days current.
let widgetDays = null;
async function loadWidgetDays() {
  if (!isNative() || widgetDays) return;
  try {
    const d = new Date(); d.setDate(d.getDate() - 400);
    const rows = await store.getRange(keyOf(d), todayKey());
    widgetDays = new Set(rows.filter(hasContent).map((e) => e.date));
    setWidgetDays([...widgetDays].sort());
  } catch (e) { /* the widget can wait */ }
}
function noteWidget(date, has) {
  if (!widgetDays) return;
  const before = widgetDays.has(date);
  if (has) widgetDays.add(date); else widgetDays.delete(date);
  if (before !== has) setWidgetDays([...widgetDays].sort());
}
async function refreshMeta() {
  setTimeout(loadWidgetDays, 2500);
  try {
    totalCount = await store.count();
    firstDate = await store.firstDate();
    renderCount(); renderOTD(); renderExport();
  } catch (e) { /* the count is a nicety */ }
}
function lockEditor(ph) { editable = false; $('#body').readOnly = true; $('#title').readOnly = true; $('#body').placeholder = ph || ''; }
function unlockEditor() { editable = true; $('#body').readOnly = false; $('#title').readOnly = false; $('#body').placeholder = 'Start writing…'; if (navigator.onLine) showBanner(''); else showBanner(OFFLINE_MSG); }
function goOffline(msg) { lockEditor('Not connected'); showBanner(msg); }
function afterEntriesChanged() {
  renderCal(); renderCount(); renderExport();
  const e = entries[cur] || {};
  const ed = readEditor();
  const same = ed.body === (e.body || '') && ed.title === (e.title || '') && ed.photos.join(',') === (e.photos || []).join(',');
  if (!dirty && editable && !same) loadEditor();
}
async function ensureMonth(y, m) {
  const a = y + '-' + pad(m + 1) + '-01', last = new Date(y, m + 1, 0).getDate();
  const b = y + '-' + pad(m + 1) + '-' + pad(last);
  if (a >= recentFrom) return;
  const key = y + '-' + m;
  if (monthsLoaded.has(key)) return;
  monthsLoaded.add(key);
  try {
    const rows = await store.getRange(a, b);
    for (let d = 1; d <= last; d++) { const k = y + '-' + pad(m + 1) + '-' + pad(d); if (k < recentFrom && !(k in entries)) entries[k] = null; }
    rows.forEach((e) => { if (e.date < recentFrom && !(dirty && e.date === cur)) entries[e.date] = e; });
    renderCal();
  } catch (e) { monthsLoaded.delete(key); }
}
async function ensureAll() {
  if (allLoaded) return;
  $('#qInfo').textContent = 'Loading your whole journal to search it…';
  const rows = await store.getAll();
  rows.forEach((e) => { if (isDate(e.date) && !(dirty && e.date === cur)) entries[e.date] = e; });
  allLoaded = true; $('#qInfo').textContent = '';
}

/* ---------- passcode ---------- */
const rnd = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join(''); };
async function hashOf(secret, salt) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, km, 256);
  return btoa(String.fromCharCode.apply(null, new Uint8Array(bits)));
}
function showLock() {
  gate('#lock');
  $('#lockForm').hidden = false; $('#recForm').hidden = true;
  $('#lockPin').value = ''; $('#lockErr').textContent = '';
  setTimeout(() => $('#lockPin').focus(), 50);
  tryBio(true);
}
async function bioReady() { return isNative() && devicePrefs().bio && await bioAvailable(); }
async function tryBio(auto) {
  const btn = $('#lockBio');
  if (!(await bioReady())) { btn.hidden = true; return; }
  btn.hidden = false;
  if (auto === false || auto === true) { /* prompt below */ }
  if (await bioAuth('Unlock Daybook')) { failCount = 0; $('#lockPin').value = ''; hideLock(); }
}
$('#lockBio').addEventListener('click', () => tryBio(false));
function hideLock() { gate('#shell'); start(); }
async function lockNow() {
  if (!lockData || !started) return;
  await flush(); closeLightbox();
  closePanel(); showLock();
}
$('#lockForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (Date.now() < blockedUntil) { $('#lockErr').textContent = 'Too many tries. Wait a few seconds.'; return; }
  const h = await hashOf($('#lockPin').value, lockData.salt);
  if (h === lockData.hash) { failCount = 0; $('#lockPin').value = ''; hideLock(); }
  else {
    failCount++;
    if (failCount >= 5) { blockedUntil = Date.now() + 30000; failCount = 0; $('#lockErr').textContent = 'Too many tries. Wait 30 seconds.'; }
    else $('#lockErr').textContent = 'That is not the passcode.';
    $('#lockPin').value = '';
  }
});
$('#forgot').addEventListener('click', () => { $('#lockForm').hidden = true; $('#recForm').hidden = false; $('#recErr').textContent = ''; $('#recWord').focus(); });
$('#recBack').addEventListener('click', () => { $('#recForm').hidden = true; $('#lockForm').hidden = false; $('#lockPin').focus(); });
$('#recForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const np = $('#newPin').value, word = $('#recWord').value.trim().toLowerCase();
  if (np.length < 4) { $('#recErr').textContent = 'Choose a passcode of 4 or more characters.'; return; }
  if (Date.now() < blockedUntil) { $('#recErr').textContent = 'Too many tries. Wait a few seconds.'; return; }
  const rh = await hashOf(word, lockData.salt + 'r');
  if (rh !== lockData.rhash) {
    failCount++;
    if (failCount >= 5) { blockedUntil = Date.now() + 30000; failCount = 0; }
    $('#recErr').textContent = 'That is not the recovery word.'; return;
  }
  try {
    const salt = rnd();
    const nd = { salt, hash: await hashOf(np, salt), rhash: await hashOf(word, salt + 'r') };
    await store.setSetting('lock', nd); lockData = nd;
    $('#recWord').value = ''; $('#newPin').value = '';
    hideLock();
  } catch (e) { $('#recErr').textContent = 'Could not save the new passcode. Check your connection.'; }
});
function renderLockPanel() {
  $('#lpOff').hidden = !hasCrypto || !!lockData;
  $('#lpOnBox').hidden = !hasCrypto || !lockData;
  $('#lpMsg').textContent = !hasCrypto ? 'A passcode is not available in this browser.' : '';
}
function closePanel() { resetDelete(); $('#lockPanel').hidden = true; $('#lockBtn').setAttribute('aria-expanded', 'false'); }
$('#lockBtn').addEventListener('click', () => {
  const p = $('#lockPanel'); p.hidden = !p.hidden;
  $('#lockBtn').setAttribute('aria-expanded', String(!p.hidden));
  if (!p.hidden) { closeExport(); closeBrowse(); renderLockPanel(); renderReminder(); renderDevice(); }
});
$('#lpClose').addEventListener('click', closePanel);
function renderTelemetry() {
  const on = telemetryOn();
  $('#telToggle').setAttribute('aria-checked', String(on));
}
$('#telToggle').addEventListener('click', () => { setTelemetry(!telemetryOn()); renderTelemetry(); });
async function renderDevice() {
  renderTelemetry();
  const d = devicePrefs();
  $('#lockAfter').value = String(d.lockAfter);
  $('#privSection').hidden = !isNative();
  $('#recToggle').setAttribute('aria-checked', String(d.recents));
  const bio = isNative() && await bioAvailable();
  $('#bioRow').hidden = !bio;
  $('#bioToggle').setAttribute('aria-checked', String(!!(d.bio && bio)));
}
$('#lockAfter').addEventListener('change', () => { const d = devicePrefs(); d.lockAfter = Number($('#lockAfter').value); saveDevicePrefs(d); $('#lpMsg').textContent = 'Saved.'; });
$('#recToggle').addEventListener('click', () => { const d = devicePrefs(); d.recents = !d.recents; saveDevicePrefs(d); setRecentsPrivacy(d.recents); renderDevice(); });
$('#bioToggle').addEventListener('click', async () => {
  const d = devicePrefs();
  if (!d.bio) { if (!(await bioAuth('Turn on fingerprint unlock'))) { $('#lpMsg').textContent = 'Fingerprint was not confirmed.'; return; } }
  d.bio = !d.bio; saveDevicePrefs(d); renderDevice();
});
if (isNative()) { setRecentsPrivacy(devicePrefs().recents); initNotificationActions(); }
const niceTime = (t) => { const [h, m] = String(t).split(':').map(Number); return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm'); };
function renderReminder() {
  $('#remSection').hidden = !isNative();
  const r = reminderPrefs(); $('#remTime').value = r.time;
  $('#remStatus').textContent = r.on ? 'On: every day at ' + niceTime(r.time) : 'Off';
  $('#remStatus').dataset.on = String(r.on);
  $('#remToggle').setAttribute('aria-checked', String(r.on));
}
async function applyReminder(on) {
  const msg = $('#remMsg'); msg.textContent = ''; $('#remToggle').disabled = true;
  try { await setReminder(on, $('#remTime').value || '21:00'); haptic(); msg.textContent = on ? 'Done. You will get a reminder at ' + niceTime($('#remTime').value || '21:00') + ' every day.' : 'Reminder turned off.'; }
  catch (e) { msg.textContent = String(e && e.message || 'Could not change the reminder.'); }
  $('#remToggle').disabled = false;
  renderReminder();
}
$('#remToggle').addEventListener('click', () => applyReminder(!reminderPrefs().on));
$('#remTime').addEventListener('change', () => { const t = $('#remTime').value || '21:00'; if (reminderPrefs().on) applyReminder(true); else { saveReminderTime(t); renderReminder(); } });
// Android back button: close whatever is open first, then go back to today, then leave the app.
onBack(() => {
  if (!$('#lightbox').hidden) { closeLightbox(); return true; }
  if (!$('#lockPanel').hidden) { closePanel(); return true; }
  if (!$('#exportPanel').hidden) { closeExport(); return true; }
  if (!$('#browse').hidden) { closeBrowse(); return true; }
  if (!$('#shell').hidden && cur !== todayKey()) { goto(todayKey()); return true; }
  return false;
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#lockPanel').hidden) closePanel(); else if (!$('#exportPanel').hidden) closeExport(); else if (!$('#browse').hidden) closeBrowse();
});
$('#lpOn').addEventListener('click', async () => {
  if (!navigator.onLine) { $('#lpMsg').textContent = 'Connect to the internet to change settings.'; return; }
  const pin = $('#setPin').value, rec = $('#setRec').value.trim().toLowerCase();
  if (pin.length < 4) { $('#lpMsg').textContent = 'Use a passcode of 4 or more characters.'; return; }
  if (rec.length < 3) { $('#lpMsg').textContent = 'Choose a recovery word of 3 or more characters.'; return; }
  try {
    const salt = rnd();
    const nd = { salt, hash: await hashOf(pin, salt), rhash: await hashOf(rec, salt + 'r') };
    await store.setSetting('lock', nd); lockData = nd;
    $('#setPin').value = ''; $('#setRec').value = '';
    renderLockPanel(); $('#lpMsg').textContent = 'Passcode is on. It will ask the next time you open the journal.';
  } catch (e) { $('#lpMsg').textContent = 'Could not turn on the passcode. Check your connection.'; }
});
$('#lpTurnOff').addEventListener('click', async () => {
  if (!navigator.onLine) { $('#lpMsg').textContent = 'Connect to the internet to change settings.'; return; }
  try {
    const h = await hashOf($('#offPin').value, lockData.salt);
    if (h !== lockData.hash) { $('#lpMsg').textContent = 'That is not the passcode.'; return; }
    await store.deleteSetting('lock'); lockData = null; $('#offPin').value = '';
    renderLockPanel(); $('#lpMsg').textContent = 'Passcode is off.';
  } catch (e) { $('#lpMsg').textContent = 'Could not turn off the passcode. Check your connection.'; }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); flush(); }
  else if (lockData && hasCrypto && hiddenAt) { const la = devicePrefs().lockAfter; if (la >= 0 && Date.now() - hiddenAt >= la * 1000) lockNow(); }
});

/* ---------- editor ---------- */
function readEditor() { return { date: cur, title: $('#title').value.trim(), body: $('#body').value.replace(/\s+$/, ''), photos: photos.slice() }; }
// Grow the editor with its text. Collapsing to 'auto' shrinks the whole page for a moment, which
// makes the browser clamp the scroll to the top (the jump seen while typing), so the scroll
// position is restored in the same frame, before anything is painted.
function autosize() {
  const ta = $('#body');
  if (!ta.clientWidth) return;                       // hidden or not laid out yet: measuring now would give a wrong, too-short height
  const y = window.scrollY, x = window.scrollX;
  ta.style.height = 'auto';
  const h = Math.max(320, ta.scrollHeight + 8) + 'px';
  if (ta.style.height !== h) ta.style.height = h;
  if (window.scrollY !== y) window.scrollTo(x, y);
}
function updateWc() { const n = words($('#body').value); $('#wc').textContent = fmt(n) + (n === 1 ? ' word' : ' words'); }
async function photoData(id) {
  if (photoCache[id] !== undefined) return photoCache[id];
  try { photoCache[id] = await store.getPhoto(id); } catch (e) { return null; }
  return photoCache[id];
}
function renderPhotos() {
  const box = $('#photos');
  box.textContent = ''; box.hidden = !photos.length;
  photos.forEach((id) => {
    const w = document.createElement('div'); w.className = 'photo';
    const im = document.createElement('img'); im.alt = 'Photo of a handwritten page'; im.style.minWidth = '72px'; im.style.minHeight = '96px';
    im.addEventListener('click', () => { if (im.src) openLightbox(im.src); });
    photoData(id).then((u) => { if (u) im.src = u; });
    const x = document.createElement('button'); x.type = 'button'; x.innerHTML = icon('x'); x.setAttribute('aria-label', 'Remove this photo'); x.dataset.id = id;
    w.appendChild(im); w.appendChild(x); box.appendChild(w);
  });
}
function openLightbox(src) { $('#lbImg').src = src; $('#lightbox').hidden = false; }
function closeLightbox() { $('#lightbox').hidden = true; $('#lbImg').removeAttribute('src'); }
$('#lbClose').addEventListener('click', closeLightbox);
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

function loadEditor() {
  const e = entries[cur] || {};
  $('#title').value = e.title || '';
  $('#body').value = e.body || '';
  photos = (e.photos || []).slice();
  undoInfo = null; $('#undo').hidden = true; lastFixed = ''; clearTimeout(fixTimer);
  renderPhotos(); autosize(); updateWc();
  setStatus('');
}
function touch() {
  if (!editable) return;
  dirty = true; setStatus(''); renderSync();
  clearTimeout(timer); timer = setTimeout(flush, 900);
}
function flush() {
  clearTimeout(timer);
  if (!dirty) return writing;
  const e = readEditor();
  dirty = false;
  writing = writing.then(() => persist(e));
  return writing;
}
async function persist(e) {
  const prev = entries[e.date];
  if (!hasContent(e) && !hasContent(prev)) { if (cur === e.date) setStatus(''); return; }
  const data = { date: e.date, title: e.title, body: e.body, photos: e.photos, updated: Date.now() };
  // Shown at once; the upload happens in the background and finishes whenever there is internet.
  entries[e.date] = data;
  if (!hasContent(prev) && totalCount !== null) { totalCount++; if (!firstDate || e.date < firstDate) firstDate = e.date; }
  pending++;
  renderSync();
  renderCal(); renderCount(); renderExport();
  noteWidget(e.date, hasContent(data));
  store.setEntry(e.date, data).then(() => {
    pending--; delete failedWrites[e.date]; if (!Object.keys(failedWrites).length) syncFailed = false;
    if (!pending && !dirty && cur === e.date) setStatus('');
    renderSync();
  }).catch(() => { pending--; failedWrites[e.date] = data; syncFailed = true; renderSync(); });
}
function closeBrowse() { $('#browse').hidden = true; $('#browseBtn').setAttribute('aria-expanded', 'false'); }
async function goto(k, fromBrowse) {
  if (!isDate(k) || !loaded) return;
  if (k > todayKey()) k = todayKey();
  await flush();
  cur = k;
  const d = parseKey(k); calM = { y: d.getFullYear(), m: d.getMonth() };
  const my = ++navToken;
  if (!(k in entries) && k < recentFrom) {
    lockEditor('Loading…'); renderHeader();
    try { entries[k] = await store.getEntry(k); }
    catch (e) { if (my === navToken) { goOffline(navigator.onLine ? 'Could not load that day. Check your connection.' : 'That day is not stored on this device yet. Connect to the internet to open it.'); } return; }
    if (my !== navToken) return;
  }
  unlockEditor(); loadEditor(); renderAll();
  if (fromBrowse) { closeBrowse(); window.scrollTo(0, 0); }
}
const shift = (days) => { const d = parseKey(cur); d.setDate(d.getDate() + days); goto(keyOf(d)); };

/* ---------- rendering ---------- */
function rel(k) {
  const n = Math.round((parseKey(todayKey()) - parseKey(k)) / 864e5);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 365) return n + ' days ago';
  const y = Math.floor(n / 365.25);
  return y + (y === 1 ? ' year ago' : ' years ago');
}
function renderHeader() {
  const d = parseKey(cur);
  $('#dWeek').textContent = DAYS[d.getDay()];
  $('#dDate').textContent = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  $('#dMeta').textContent = rel(cur) + ' · Day ' + dayNumber(d) + ' of ' + d.getFullYear();
  $('#next').disabled = cur >= todayKey();
  $('#today').hidden = cur === todayKey();
}
const allEntries = () => Object.keys(entries).filter((k) => hasContent(entries[k])).sort().map((k) => entries[k]);
function renderCal() {
  const now = new Date(), minY = Math.min(1950, calM.y);
  const ySel = $('#ySel'), mSel = $('#mSel');
  if (!mSel.options.length) mSel.innerHTML = MONTHS.map((m, i) => '<option value="' + i + '">' + m + '</option>').join('');
  let yh = '';
  for (let y = now.getFullYear(); y >= minY; y--) yh += '<option value="' + y + '">' + y + '</option>';
  if (ySel.dataset.h !== yh) { ySel.innerHTML = yh; ySel.dataset.h = yh; }
  mSel.value = String(calM.m); ySel.value = String(calM.y);
  const firstDay = new Date(calM.y, calM.m, 1).getDay(), n = new Date(calM.y, calM.m + 1, 0).getDate(), t = todayKey();
  let html = ['S','M','T','W','T','F','S'].map((c) => '<div class="wd" aria-hidden="true">' + c + '</div>').join('');
  for (let i = 0; i < firstDay; i++) html += '<span></span>';
  for (let d = 1; d <= n; d++) {
    const k = calM.y + '-' + pad(calM.m + 1) + '-' + pad(d), e = entries[k], cls = [];
    if (k === cur) cls.push('sel');
    if (k === t) cls.push('today');
    if (hasContent(e)) cls.push('has');
    html += '<button type="button" data-k="' + k + '"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + (k > t ? ' disabled' : '') + ' aria-label="' + longDate(k) + (hasContent(e) ? ', has an entry' : '') + '">' + d + '</button>';
  }
  $('#cal').innerHTML = html;
  ensureMonth(calM.y, calM.m);
}
function renderCount() {
  if (totalCount === null) { $('#count').textContent = ''; return; }
  if (!totalCount) { $('#count').textContent = 'A dot marks each day you have written.'; return; }
  $('#count').textContent = fmt(totalCount) + (totalCount === 1 ? ' entry' : ' entries') + (firstDate ? ' · since ' + longDate(firstDate) : '');
}
function snippet(e, q) {
  const b = (e.body || '').replace(/\s+/g, ' ').trim();
  if (!b) return e.title || '';
  const i = q ? b.toLowerCase().indexOf(q) : -1, from = i > 40 ? i - 40 : 0;
  return (from > 0 ? '…' : '') + b.slice(from, from + 120) + (b.length > from + 120 ? '…' : '');
}
function itemBtn(e, q, label) {
  const li = document.createElement('li'), b = document.createElement('button');
  b.type = 'button'; b.dataset.k = e.date;
  const d = document.createElement('span'); d.className = 'd'; d.textContent = label || (longDate(e.date) + (e.title ? ' · ' + e.title : ''));
  const s = document.createElement('span'); s.className = 's'; s.textContent = snippet(e, q);
  b.appendChild(d); b.appendChild(s); li.appendChild(b);
  return li;
}
let otdToken = 0;
async function renderOTD() {
  const d = parseKey(cur), md = pad(d.getMonth() + 1) + '-' + pad(d.getDate()), ul = $('#otd'), my = ++otdToken;
  const y0 = firstDate ? Math.max(Number(firstDate.slice(0, 4)), d.getFullYear() - 90) : d.getFullYear();
  const keys = [];
  for (let y = d.getFullYear() - 1; y >= y0; y--) keys.push(y + '-' + md);
  try {
    await Promise.all(keys.filter((k) => !(k in entries)).map(async (k) => { entries[k] = await store.getEntry(k); }));
  } catch (e) { /* show what we have */ }
  if (my !== otdToken) return;
  ul.textContent = '';
  const hits = keys.map((k) => entries[k]).filter(hasContent);
  if (!hits.length) {
    const p = document.createElement('li'); p.className = 'empty';
    p.textContent = 'Nothing from other years yet. What you write on ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' will be here next year.';
    ul.appendChild(p); return;
  }
  hits.forEach((e) => {
    const yrs = d.getFullYear() - Number(e.date.slice(0, 4));
    ul.appendChild(itemBtn(e, '', yrs + (yrs === 1 ? ' year ago' : ' years ago') + ' · ' + e.date.slice(0, 4) + (e.title ? ' · ' + e.title : '')));
  });
}
let searchToken = 0;
async function renderSearch() {
  const q = $('#q').value.trim().toLowerCase(), ul = $('#results'), my = ++searchToken;
  if (!q) { ul.textContent = ''; $('#qInfo').textContent = ''; return; }
  try { await ensureAll(); } catch (e) { $('#qInfo').textContent = 'Could not load everything to search. Check your connection.'; return; }
  if (my !== searchToken) return;
  ul.textContent = '';
  const hits = allEntries().filter((e) => (e.body || '').toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q)).reverse();
  if (!hits.length) { const p = document.createElement('li'); p.className = 'empty'; p.textContent = 'No entries match.'; ul.appendChild(p); return; }
  hits.slice(0, 25).forEach((e) => ul.appendChild(itemBtn(e, q)));
}
function renderAll() { renderHeader(); renderCal(); renderCount(); renderOTD(); renderExport(); if ($('#q').value.trim()) renderSearch(); }

/* ---------- export ---------- */
function rangeBounds() {
  const v = $('#range').value, c = parseKey(cur);
  if (v === 'week' || v === 'last30') { const f = new Date(); f.setDate(f.getDate() - (v === 'week' ? 6 : 29)); return [keyOf(f), todayKey()]; }
  if (v === 'month') return [keyOf(new Date(c.getFullYear(), c.getMonth(), 1)), keyOf(new Date(c.getFullYear(), c.getMonth() + 1, 0))];
  if (v === 'year') return [c.getFullYear() + '-01-01', c.getFullYear() + '-12-31'];
  if (v === 'all') return ['0000-00-00', '9999-99-99'];
  return [$('#from').value || '0000-00-00', $('#to').value || '9999-99-99'];
}
async function rangeList() {
  await flush();
  const b = rangeBounds();
  const rows = $('#range').value === 'all' ? await store.getAll() : await store.getRange(b[0], b[1]);
  return rows.filter(hasContent);
}
function rangeLabel(list) {
  const v = $('#range').value, c = parseKey(cur);
  if (v === 'week' || v === 'last30') { const rb = rangeBounds(); return longDate(rb[0]) + ' to ' + longDate(rb[1]); }
  if (v === 'month') return MONTHS[c.getMonth()] + ' ' + c.getFullYear();
  if (v === 'year') return String(c.getFullYear());
  if (v === 'all') return list.length ? longDate(list[0].date) + ' to ' + longDate(list[list.length - 1].date) : 'All entries';
  const b = rangeBounds();
  return (b[0] > '0001' ? longDate(b[0]) : 'The start') + ' to ' + (b[1] < '9998' ? longDate(b[1]) : 'now');
}
let exportToken = 0, exportCount = 0;
async function renderExport() {
  const c = parseKey(cur), my = ++exportToken;
  $('#chipMonth').textContent = MONTHS[c.getMonth()] + ' ' + c.getFullYear();
  $('#chipYear').textContent = 'All of ' + c.getFullYear();
  document.querySelectorAll('#chips .chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === $('#range').value)));
  $('#customRow').hidden = $('#range').value !== 'custom';
  if (!store || !started) return;
  let n = 0;
  try {
    if ($('#range').value === 'all') n = totalCount === null ? await store.count() : totalCount;
    else { const b = rangeBounds(); n = await store.countRange(b[0], b[1]); }
  } catch (e) { n = -1; }
  if (my !== exportToken) return;
  exportCount = n;
  $('#rangeInfo').textContent = n < 0 ? 'The count needs a connection.' : n + (n === 1 ? ' entry' : ' entries') + ' in this range';
  ['#expPrint', '#expTxt'].forEach((s) => { $(s).disabled = n === 0; });
}
// Saving a file. In the Android app the file is written to the phone and the share menu opens,
// so it can go to Files, Drive, a printer or a chat. On the web it downloads as usual.
const nativeBridge = () => { const C = window.Capacitor; return C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && typeof C.nativePromise === 'function' ? C : null; };
async function saveFile(name, data, mime) {
  const C = nativeBridge();
  if (!C) { download(name, data, mime); return 'downloaded'; }
  const isB64 = typeof data === 'object' && data.base64;
  const w = await C.nativePromise('Filesystem', 'writeFile', isB64 ? { path: name, data: data.base64, directory: 'CACHE' } : { path: name, data: String(data), directory: 'CACHE', encoding: 'utf8' });
  try { await C.nativePromise('Share', 'share', { title: name, url: w.uri, dialogTitle: 'Save or share ' + name }); }
  catch (e) { if (!/cancel/i.test(String(e && (e.message || e.code) || ''))) throw e; }
  return 'shared';
}
function download(name, data, mime) {
  if (typeof data === 'object' && data.base64) { const b = atob(data.base64), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); data = u; }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function slug() {
  const v = $('#range').value, c = parseKey(cur);
  if (v === 'week') return 'last-7-days';
  if (v === 'last30') return 'last-30-days';
  if (v === 'month') return c.getFullYear() + '-' + pad(c.getMonth() + 1);
  if (v === 'year') return String(c.getFullYear());
  if (v === 'all') return 'everything';
  const b = rangeBounds(); return (b[0] > '0001' ? b[0] : 'start') + '-to-' + (b[1] < '9998' ? b[1] : 'now');
}
function plainText(list) {
  // Just the writing: each entry is its date, an optional title, then the text.
  return list.map((e) => longDate(e.date) + '\n' + (e.title ? e.title + '\n' : '') + '\n' + (e.body || '').trim() + '\n').join('\n\n') ;
}
async function runExport(kind) {
  setMsg('Preparing…');
  try {
    const list = await rangeList();
    if (!list.length) { setMsg('Nothing to export in that range.'); return; }
    const label = rangeLabel(list);
    if (!navigator.onLine) setMsg('Offline: this only includes entries stored on this device.');
    const base = 'daybook-' + slug();
    if (kind === 'print' || kind === 'sheets') {
      const booklet = kind === 'print';
      setMsg('Making your PDF…');
      const { makeJournalPdf } = await import('./pdf.js');
      const doc = await makeJournalPdf(list, { label, mode: booklet ? 'booklet' : 'sheets', photo: photoData, onProgress: (i, n) => setMsg('Laying out day ' + i + ' of ' + n + '…') });
      const b64 = doc.output('datauristring').split(',')[1];
      const name = base + (booklet ? '-book' : '-sheets') + '.pdf', info = doc.__info;
      const how = await saveFile(name, { base64: b64 }, 'application/pdf');
      setMsg((how === 'shared' ? 'Your PDF is ready. ' : 'Saved ' + name + '. ') + (booklet
        ? 'To print: A4, actual size, both sides, flip on the short edge. ' + info.sheets + (info.sheets === 1 ? ' sheet' : ' sheets') + (info.booklets > 1 ? ', in ' + info.booklets + ' booklets of up to 8 sheets: fold each one and stack them in order.' : ': fold the stack in half.')
        : 'To print: A4, actual size, one side. Cut each sheet down the middle.'));
    } else {
      const how = await saveFile(base + '.txt', plainText(list), 'text/plain');
      setMsg(how === 'shared' ? 'Your text file is ready.' : 'Saved ' + base + '.txt');
    }
  } catch (e) { setMsg(/pdf library|fetch/i.test(String(e && e.message)) ? 'Could not load the PDF maker. Check your connection and try again.' : 'Could not make that file. ' + String(e && (e.message || e) || '').slice(0, 80)); }
}
async function runBackup() {
  if (!navigator.onLine) { setMsg('Connect to the internet to make a full backup.'); return; }
  setMsg('Preparing your backup…');
  try {
    await flush();
    const list = (await store.getAll()).filter(hasContent);
    const ids = [...new Set(list.flatMap((e) => e.photos || []))], pics = {};
    for (let i = 0; i < ids.length; i++) { setMsg('Collecting photos ' + (i + 1) + ' of ' + ids.length + '…'); const d = await photoData(ids[i]); if (d) pics[ids[i]] = d; }
    const name = 'daybook-backup-' + todayKey() + '.json';
    await saveFile(name, JSON.stringify({ app: 'daybook', version: 2, exported: new Date().toISOString(), entries: list, photos: pics }), 'application/json');
    setMsg('Saved ' + name + ' with ' + list.length + ' entries and ' + ids.length + ' photos.');
  } catch (e) { setMsg('Could not make the backup. Check your connection.'); }
}
async function runRestore(file) {
  if (!navigator.onLine) { setMsg('Connect to the internet to restore a backup.'); return; }
  setMsg('Reading the backup…');
  try {
    const j = JSON.parse(await file.text());
    const list = (j.entries || []).filter((e) => e && isDate(e.date)), pics = j.photos || {};
    let added = 0, skipped = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      setMsg('Restoring ' + (i + 1) + ' of ' + list.length + '…');
      const ex = await store.getEntry(e.date);
      if (hasContent(ex)) { skipped++; continue; }
      const keep = (e.photos || []).filter((id) => pics[id]);
      for (const id of keep) await store.addPhoto(id, pics[id], e.date);
      const data = { date: e.date, title: String(e.title || ''), body: String(e.body || ''), photos: keep, updated: Date.now() };
      if (!hasContent(data)) continue;
      await store.setEntry(e.date, data);
      if (e.date >= recentFrom) entries[e.date] = data; else entries[e.date] = data;
      added++;
    }
    await refreshMeta(); renderAll();
    setMsg('Restored ' + added + ' entries' + (skipped ? ', kept ' + skipped + ' you already had.' : '.'));
  } catch (e) { setMsg('That file could not be read as a Daybook backup.'); }
}


/* ---------- spelling and grammar ---------- */
function setAutoUi() {
  const a = $('#auto');
  a.setAttribute('aria-pressed', String(autoFix));
  a.title = autoFix ? 'Auto-correct is on' : 'Auto-correct as I write';
  a.setAttribute('aria-label', autoFix ? 'Auto-correct is on. Press to turn off.' : 'Auto-correct while I write');
}
async function fixText(core) {
  const out = (await correct(core)).trim(), n = core.length;
  if (!out || out.length > n * 1.3 + 20 || out.length < n * 0.7 - 20) return null;
  return out;
}
const wrapKeep = (src, out) => src.match(/^\s*/)[0] + out + src.match(/\s*$/)[0];
function showUndo(info) { undoInfo = info; $('#undo').hidden = !info; }
const grammarOk = () => { try { return localStorage.getItem('daybook.grammarOk') === '1'; } catch (e) { return false; } };
const setGrammarOk = () => { try { localStorage.setItem('daybook.grammarOk', '1'); } catch (e) {} };
function askGrammarConsent() {
  if (grammarOk()) return Promise.resolve(true);
  const d = $('#gramConsent');
  if (!d.showModal) return Promise.resolve(window.confirm('Grammar correction sends the text you correct to LanguageTool, a public service. Continue?') && (setGrammarOk(), true));
  return new Promise((res) => {
    const done = (ok) => { d.close(); d.removeEventListener('cancel', no); $('#gcYes').onclick = $('#gcNo').onclick = null;
      if (ok) setGrammarOk(); res(ok); };
    const no = (ev) => { if (ev) ev.preventDefault(); done(false); };
    $('#gcYes').onclick = () => done(true); $('#gcNo').onclick = () => no();
    d.addEventListener('cancel', no); d.showModal();
  });
}
async function fixNow() {
  if (!editable || fixBusy) return;
  if (!(await askGrammarConsent())) return;
  const b = $('#body'), src = b.value, core = src.trim();
  if (words(core) < 2) { setStatus('Nothing to correct yet'); return; }
  fixBusy = true; $('#fix').disabled = true; setStatus('Correcting…');
  try {
    const out = await fixText(core);
    if (b.value !== src) setStatus('You kept typing. Press correct again.');
    else if (out === null) setStatus('Could not correct that safely. Nothing changed.');
    else if (out === core) setStatus('No mistakes found');
    else { haptic('success'); const neu = wrapKeep(src, out); b.value = neu; showUndo({ before: src, after: neu }); lastFixed = ''; autosize(); updateWc(); touch(); }
  } catch (e) { setStatus(fixError(e)); }
  fixBusy = false; $('#fix').disabled = false;
}
async function autoRun() {
  if (!autoFix || !editable || fixBusy) return;
  const b = $('#body'), v = b.value, pos = b.selectionStart;
  const s = v.lastIndexOf('\n', pos - 1) + 1; let e = v.indexOf('\n', pos); if (e < 0) e = v.length;
  const seg = v.slice(s, e), core = seg.trim();
  if (words(core) < 3 || seg === lastFixed) return;
  fixBusy = true;
  try {
    const out = await fixText(core);
    if (b.value.slice(s, e) !== seg) fixTimer = setTimeout(autoRun, 1500);
    else if (out === null || out === core) lastFixed = seg;
    else {
      const neu = wrapKeep(seg, out), cp = b.selectionStart;
      b.setRangeText(neu, s, e, 'end');
      const np = cp >= e ? s + neu.length + (cp - e) : cp <= s ? cp : Math.min(cp, s + neu.length);
      b.setSelectionRange(np, np);
      lastFixed = neu; showUndo({ before: seg, after: neu });
      autosize(); updateWc(); touch();
    }
  } catch (err) {
    if (err && err.code === 'rate_limited') setStatus(fixError(err));
  }
  fixBusy = false;
}

/* ---------- events ---------- */
let typeFrame = 0;
$('#body').addEventListener('input', () => {
  touch();
  if (!typeFrame) typeFrame = requestAnimationFrame(() => { typeFrame = 0; autosize(); updateWc(); });
  clearTimeout(fixTimer);
  if (autoFix) fixTimer = setTimeout(autoRun, 3500);
});
$('#title').addEventListener('input', touch);
$('#fix').addEventListener('click', fixNow);
$('#auto').addEventListener('click', async () => {
  if (!autoFix && !(await askGrammarConsent())) return;
  autoFix = !autoFix; prefs.autoFix = autoFix; delete prefs.geminiKey; delete prefs.model; setAutoUi();
  setStatus(autoFix ? 'Auto-correct on' : 'Auto-correct off');
  store.setSetting('prefs', prefs).catch(() => {});
  if (autoFix) autoRun();
});
$('#undo').addEventListener('click', () => {
  const u = undoInfo, b = $('#body');
  if (!u) return;
  const i = b.value.indexOf(u.after);
  if (i < 0) { setStatus('Cannot undo, the text has changed.'); showUndo(null); return; }
  b.setRangeText(u.before, i, i + u.after.length, 'end');
  lastFixed = u.before; showUndo(null); autosize(); updateWc(); touch();
});
$('#stamp').addEventListener('click', () => {
  if (!editable) return;
  const b = $('#body');
  b.value = b.value.replace(/\s+$/, '') + (b.value.trim() ? '\n\n' : '') + timeNow() + ' — ';
  b.focus(); b.setSelectionRange(b.value.length, b.value.length);
  autosize(); updateWc(); touch();
});
$('#photos').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-id]'); if (!b) return;
  const id = b.dataset.id;
  photos = photos.filter((p) => p !== id);
  renderPhotos(); touch();
  store.deletePhoto(id).catch(() => {});
});
$('#browseBtn').addEventListener('click', () => {
  const b = $('#browse'); b.hidden = !b.hidden;
  $('#browseBtn').setAttribute('aria-expanded', String(!b.hidden));
  if (!b.hidden) { closeExport(); closePanel(); refreshMeta(); }
});
$('#prev').addEventListener('click', () => { haptic(); shift(-1); });
$('#next').addEventListener('click', () => { haptic(); shift(1); });
$('#today').addEventListener('click', () => goto(todayKey()));
$('#mPrev').addEventListener('click', () => { calM.m--; if (calM.m < 0) { calM.m = 11; calM.y--; } renderCal(); });
$('#mNext').addEventListener('click', () => { calM.m++; if (calM.m > 11) { calM.m = 0; calM.y++; } renderCal(); });
$('#mSel').addEventListener('change', (e) => { calM.m = Number(e.target.value); renderCal(); });
$('#ySel').addEventListener('change', (e) => { calM.y = Number(e.target.value); renderCal(); });
['#cal', '#results', '#otd'].forEach((s) => $(s).addEventListener('click', (ev) => { const b = ev.target.closest('button[data-k]'); if (b) goto(b.dataset.k, true); }));
let qTimer = null;
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderSearch, 250); });
['#range', '#from', '#to'].forEach((s) => $(s).addEventListener('change', renderExport));
$('#expPrint').addEventListener('click', () => runExport($('#printMode').value === 'sheets' ? 'sheets' : 'print'));
$('#printMode').addEventListener('change', () => { $('#printHow').textContent = $('#printMode').value === 'sheets' ? 'Two days on each A4 sheet' : 'Print both sides, then fold'; });
document.querySelectorAll('#chips .chip').forEach((b) => b.addEventListener('click', () => { $('#range').value = b.dataset.v; renderExport(); }));
function closeExport() { $('#exportPanel').hidden = true; $('#exportBtn').setAttribute('aria-expanded', 'false'); }
$('#exClose').addEventListener('click', closeExport);
$('#exportBtn').addEventListener('click', () => {
  const p = $('#exportPanel'); p.hidden = !p.hidden;
  $('#exportBtn').setAttribute('aria-expanded', String(!p.hidden));
  if (!p.hidden) { closePanel(); closeBrowse(); setMsg(''); renderExport(); }
});
$('#expTxt').addEventListener('click', () => runExport('text'));
$('#expJson').addEventListener('click', runBackup);
$('#impBtn').addEventListener('click', () => $('#impFile').click());
$('#impFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) runRestore(f); });

const OFFLINE_MSG = 'You are offline. You can keep writing; it is kept on this device and uploads when you are back online.';
function netState() {
  const b = $('#banner');
  if (!navigator.onLine) { if (!$('#shell').hidden) showBanner(OFFLINE_MSG); }
  else if (b.textContent === OFFLINE_MSG) showBanner('');
  if (navigator.onLine && syncFailed) retrySync();
  renderSync();
}
window.addEventListener('online', netState);
window.addEventListener('offline', netState);
window.addEventListener('pagehide', flush);
$('#sync').addEventListener('click', retrySync);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', autosize);
if (isNative()) { ['getApp', 'getApp2'].forEach((i) => { const g = document.getElementById(i); if (g) g.remove(); }); }
// After the app comes back from the background the phone can lay the page out a moment late, so the
// writing box would be measured too short and the page could not scroll. Measure again whenever it returns.
const remeasure = () => { requestAnimationFrame(autosize); setTimeout(autosize, 250); setTimeout(autosize, 900); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') remeasure(); });
window.addEventListener('pageshow', remeasure);
window.addEventListener('focus', remeasure);
if (document.fonts) { document.fonts.ready.then(autosize); document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', autosize); }
if (window.ResizeObserver) { let lastW = 0; new ResizeObserver(() => { const w = $('#body').clientWidth; if (w !== lastW) { lastW = w; autosize(); } }).observe($('#body')); }

$('#range').value = 'month';
const t0 = parseKey(cur); calM = { y: t0.getFullYear(), m: t0.getMonth() };
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();

// Creator links and the support section in Settings. Empty values stay hidden.
(function creatorLinks() {
  const row = $('#socialRow'); if (!row) return;
  [['instagram', 'Instagram', links.instagram], ['linkedin', 'LinkedIn', links.linkedin], ['behance', 'Behance', links.behance], ['mail', 'Email', links.email && 'mailto:' + links.email]].forEach(([id, name, href]) => {
    if (!href) return;
    const el = document.createElement('a'); el.href = href; el.title = name; el.setAttribute('aria-label', name);
    el.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
    if (/^https?:/.test(href)) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    row.appendChild(el);
  });
  if (!links.upiId) return;
  $('#supportSec').hidden = false; $('#supportGrp').hidden = false;
  $('#upiPay').href = 'upi://pay?pa=' + encodeURIComponent(links.upiId) + '&pn=' + encodeURIComponent(links.upiName || 'Daybook') + '&cu=INR&tn=' + encodeURIComponent('Support Daybook');
})();

// Easy reading mode: bigger text, darker greys, labelled buttons. Asked once on first open, one tap to change later.
(function easyReading() {
  const get = () => { try { return localStorage.getItem('daybook.view'); } catch (e) { return ''; } };
  const apply = (on) => {
    const r = document.documentElement;
    if (on) r.setAttribute('data-view', 'readable'); else r.removeAttribute('data-view');
    const b = $('#viewBtn'), b2 = $('#viewBtn2');
    if (b) b.setAttribute('aria-pressed', String(on));
    const vc = $('#vsClassic'), ve = $('#vsEasy');
    if (vc) vc.setAttribute('aria-pressed', String(!on)); if (ve) ve.setAttribute('aria-pressed', String(on));
    if (b2) { b2.setAttribute('aria-pressed', String(on)); b2.textContent = on ? 'Easy reading: on' : 'Easy reading: off'; }
    requestAnimationFrame(() => { try { autosize(); } catch (e) {} });
  };
  const choose = (on) => { try { localStorage.setItem('daybook.view', on ? 'readable' : 'classic'); } catch (e) {} apply(on); };
  apply(get() === 'readable');
  const vc0 = $('#vsClassic'), ve0 = $('#vsEasy');
  if (vc0) vc0.addEventListener('click', () => choose(false)); if (ve0) ve0.addEventListener('click', () => choose(true));
  ['#viewBtn', '#viewBtn2'].forEach((s) => { const el = $(s); if (el) el.addEventListener('click', () => choose(document.documentElement.getAttribute('data-view') !== 'readable')); });
  const box = $('#viewChoice');
  if (box && get() === null) {
    box.hidden = false;
    const done = (on) => { choose(on); box.hidden = true; };
    $('#vcClassic').addEventListener('click', () => done(false));
    $('#vcEasy').addEventListener('click', () => done(true));
    setTimeout(() => { try { $('#vcClassic').focus(); } catch (e) {} }, 50);
  }
})();

// Version label in Settings, and a one-time clean-out of saved pages when the app version changes so nothing old lingers.
(function buildStamp() {
  const BUILD = '__BUILD__';
  if (BUILD.startsWith('__')) return;
  const v = $('#verLine'); if (v) { v.textContent = 'Version ' + BUILD.replace(/^v/, ''); v.hidden = false; }
  try {
    if (localStorage.getItem('daybook.build') === BUILD) return;
    localStorage.setItem('daybook.build', BUILD);
    const jobs = [];
    if (window.caches) jobs.push(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
    if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))));
    Promise.all(jobs).then(() => { if (jobs.length) location.reload(); }).catch(() => {});
  } catch (e) {}
})();
