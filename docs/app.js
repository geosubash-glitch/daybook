import { config } from './config.js';
import * as ai from './ai.js';

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
let scanToken = 0, scanFile = null;
let pending = 0;
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
  $('#acct').textContent = 'Signed in as ' + user.email;
  acctProvider = user.provider || 'password';
  try {
    lockData = await store.getSetting('lock');
    prefs = (await store.getSetting('prefs')) || {};
  } catch (e) {
    teardown(); gate('#signin');
    $('#siErr').textContent = 'Signed in, but the journal could not be reached. Check your connection and that the Firestore rules were published.';
    return;
  }
  autoFix = !!prefs.autoFix; setAutoUi(); renderAiSettings();
  if (lockData && lockData.hash && hasCrypto) showLock(); else start();
}
function teardown() {
  if (unwatch) { try { unwatch(); } catch (e) {} unwatch = null; }
  clearTimeout(timer); clearTimeout(fixTimer);
  entries = {}; monthsLoaded = new Set(); photoCache = {}; photos = [];
  loaded = editable = started = dirty = allLoaded = false;
  lockData = null; prefs = {}; totalCount = null; firstDate = null; undoInfo = null;
  $('#body').value = ''; $('#title').value = ''; $('#results').textContent = ''; $('#q').value = '';
  $('#lockPanel').hidden = true; $('#browse').hidden = true; $('#exportPanel').hidden = true; closeScan();
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
    if (!loaded) { loaded = true; goto(cur); refreshMeta(); }
    else afterEntriesChanged();
  }, () => goOffline('Lost the connection to your journal. Check your internet and reload.'));
}
async function refreshMeta() {
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
  $('#del').hidden = !hasContent(entries[cur]);
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
}
function hideLock() { gate('#shell'); start(); }
async function lockNow() {
  if (!lockData || !started) return;
  await flush(); closeScan(); closeLightbox();
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
  if (!p.hidden) { closeExport(); closeBrowse(); renderLockPanel(); }
});
$('#lpClose').addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#lockPanel').hidden) closePanel(); else if (!$('#exportPanel').hidden) closeExport(); else if (!$('#browse').hidden) closeBrowse();
});
$('#lockNow').addEventListener('click', lockNow);
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
  else if (lockData && hasCrypto && hiddenAt && Date.now() - hiddenAt > 120000) { lockNow(); }
});

/* ---------- settings: Gemini key ---------- */
function renderAiSettings() {
  $('#aiKey').value = '';
  $('#aiKey').placeholder = prefs.geminiKey ? 'Key saved. Paste a new one to replace it.' : 'Gemini API key';
  $('#aiModel').value = prefs.model || '';
  $('#aiModel').placeholder = 'Model, for example ' + ai.DEFAULT_MODEL;
}
async function savePrefs(msg) {
  try { await store.setSetting('prefs', prefs); $('#lpMsg').textContent = msg || ''; return true; }
  catch (e) { $('#lpMsg').textContent = 'Could not save. Check your connection.'; return false; }
}
$('#aiSave').addEventListener('click', async () => {
  if (!navigator.onLine) { $('#lpMsg').textContent = 'Connect to the internet to change settings.'; return; }
  const key = $('#aiKey').value.trim(), model = $('#aiModel').value.trim();
  if (!key && !prefs.geminiKey) { $('#lpMsg').textContent = 'Paste your Gemini key first.'; return; }
  if (key) prefs.geminiKey = key;
  if (model) prefs.model = model; else delete prefs.model;
  if (await savePrefs('Saved.')) renderAiSettings();
});
$('#aiRemove').addEventListener('click', async () => {
  if (!navigator.onLine) { $('#lpMsg').textContent = 'Connect to the internet to change settings.'; return; }
  delete prefs.geminiKey; autoFix = false; prefs.autoFix = false; setAutoUi();
  if (await savePrefs('Key removed.')) renderAiSettings();
});

/* ---------- editor ---------- */
function readEditor() { return { date: cur, title: $('#title').value.trim(), body: $('#body').value.replace(/\s+$/, ''), photos: photos.slice() }; }
function autosize() { const ta = $('#body'); ta.style.height = 'auto'; ta.style.height = Math.max(320, ta.scrollHeight + 8) + 'px'; }
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
  setStatus(hasContent(e) ? 'saved' : '');
  $('#del').hidden = !hasContent(e);
}
function touch() {
  if (!editable) return;
  dirty = true; setStatus('Saving…');
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
  if (cur === e.date) setStatus(navigator.onLine ? 'Saving…' : 'Kept here, uploads when online');
  renderCal(); renderCount(); renderExport();
  $('#del').hidden = !hasContent(entries[cur]);
  store.setEntry(e.date, data).then(() => {
    pending--;
    if (!pending && !dirty && cur === e.date) setStatus('saved');
  }).catch(() => { pending--; if (cur === e.date) setStatus('Not uploaded. Check your connection and sign-in.'); });
}
function closeBrowse() { $('#browse').hidden = true; $('#browseBtn').setAttribute('aria-expanded', 'false'); }
async function goto(k, fromBrowse) {
  if (!isDate(k) || !loaded) return;
  if (k > todayKey()) k = todayKey();
  await flush();
  closeScan();
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
    if (kind === 'print') {
      setMsg('Making your PDF…');
      const { makeJournalPdf } = await import('./pdf.js');
      const doc = await makeJournalPdf(list, { label, photo: photoData, onProgress: (i, n) => setMsg('Laying out day ' + i + ' of ' + n + '…') });
      const b64 = doc.output('datauristring').split(',')[1];
      const how = await saveFile(base + '.pdf', { base64: b64 }, 'application/pdf');
      setMsg(how === 'shared' ? 'Your PDF is ready.' : 'Saved ' + base + '.pdf. Open it to print: A4, landscape.');
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

/* ---------- scan a handwritten page ---------- */
function closeScan() {
  scanToken++; scanFile = null;
  $('#scan').hidden = true; $('#scanText').hidden = true; $('#scanAdd').hidden = true;
}
async function packPhoto(file) {
  const tries = [[1400, 0.72], [1400, 0.6], [1200, 0.5], [1000, 0.4]];
  let out = '';
  for (const t of tries) { out = await ai.shrink(file, t[0], t[1]); if (out.length < 800000) break; }
  return out;
}
async function startScan(file) {
  if (!file) return;
  if (!prefs.geminiKey) { setStatus(ai.aiError({ code: 'no_key' })); return; }
  scanFile = file;
  const my = ++scanToken;
  $('#scan').hidden = false; $('#scanTitle').textContent = 'Reading your page…';
  $('#scanText').hidden = true; $('#scanAdd').hidden = true; $('#scanText').value = '';
  $('#scanCancel').textContent = 'Stop';
  try {
    const url = await ai.shrink(file, 2000, 0.85);
    const r = await ai.transcribe(prefs, url.split(',')[1], 'image/jpeg');
    if (my !== scanToken) return;
    if (!r.text.trim()) { $('#scanTitle').textContent = 'No text was found in that photo.'; $('#scanCancel').textContent = 'Close'; return; }
    $('#scanText').hidden = false; $('#scanText').value = r.text;
    $('#scanTitle').textContent = 'Check the text, fix anything, then add it';
    $('#scanAdd').hidden = false; $('#scanCancel').textContent = 'Cancel';
    $('#keepWrap').hidden = false;
  } catch (e) {
    if (my !== scanToken) return;
    $('#scanTitle').textContent = e && e.message === 'image' ? 'That image could not be read. Try a clearer photo.' : ai.aiError(e);
    $('#scanCancel').textContent = 'Close';
  }
}
async function addScan() {
  const txt = $('#scanText').value.replace(/\s+$/, ''), body = $('#body'), file = scanFile, keep = $('#keep').checked;
  if (txt) body.value = body.value.replace(/\s+$/, '') + (body.value.trim() ? '\n\n' : '') + txt + '\n';
  if (file && keep) {
    try {
      const id = rnd(), data = await packPhoto(file);
      store.addPhoto(id, data, cur).catch(() => {}); photoCache[id] = data; photos.push(id); renderPhotos();
    } catch (e) { setStatus('The text was added, but the photo could not be kept.'); }
  }
  closeScan(); autosize(); updateWc(); touch();
}

/* ---------- spelling and grammar ---------- */
function setAutoUi() {
  const a = $('#auto');
  a.setAttribute('aria-pressed', String(autoFix));
  a.title = autoFix ? 'Auto-correct is on' : 'Auto-correct as I write';
  a.setAttribute('aria-label', autoFix ? 'Auto-correct is on. Press to turn off.' : 'Auto-correct while I write');
}
async function fixText(core) {
  const r = await ai.correct(prefs, core);
  const out = (r.text || '').trim(), n = core.length;
  if (!out || r.truncated || out.length > n * 1.3 + 20 || out.length < n * 0.7 - 20) return null;
  return out;
}
const wrapKeep = (src, out) => src.match(/^\s*/)[0] + out + src.match(/\s*$/)[0];
function showUndo(info) { undoInfo = info; $('#undo').hidden = !info; }
async function fixNow() {
  if (!editable || fixBusy) return;
  if (!prefs.geminiKey) { setStatus(ai.aiError({ code: 'no_key' })); return; }
  const b = $('#body'), src = b.value, core = src.trim();
  if (words(core) < 2) { setStatus('Nothing to correct yet'); return; }
  fixBusy = true; $('#fix').disabled = true; setStatus('Correcting…');
  try {
    const out = await fixText(core);
    if (b.value !== src) setStatus('You kept typing. Press correct again.');
    else if (out === null) setStatus('Could not correct that safely. Nothing changed.');
    else if (out === core) setStatus('No mistakes found');
    else { const neu = wrapKeep(src, out); b.value = neu; showUndo({ before: src, after: neu }); lastFixed = ''; autosize(); updateWc(); touch(); }
  } catch (e) { setStatus(ai.aiError(e)); }
  fixBusy = false; $('#fix').disabled = false;
}
async function autoRun() {
  if (!autoFix || !editable || fixBusy || !prefs.geminiKey) return;
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
    if (err && ['no_key', 'bad_key', 'bad_model', 'rate_limited'].includes(err.code)) { autoFix = false; setAutoUi(); setStatus(ai.aiError(err)); }
  }
  fixBusy = false;
}

/* ---------- events ---------- */
$('#body').addEventListener('input', () => {
  autosize(); updateWc(); touch();
  clearTimeout(fixTimer);
  if (autoFix && prefs.geminiKey) fixTimer = setTimeout(autoRun, 3500);
});
$('#title').addEventListener('input', touch);
$('#fix').addEventListener('click', fixNow);
$('#auto').addEventListener('click', async () => {
  if (!prefs.geminiKey) { setStatus(ai.aiError({ code: 'no_key' })); return; }
  autoFix = !autoFix; prefs.autoFix = autoFix; setAutoUi();
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
$('#scanBtn').addEventListener('click', () => {
  if (!editable) return;
  if (!prefs.geminiKey) { setStatus(ai.aiError({ code: 'no_key' })); return; }
  $('#scanFile').click();
});
$('#scanFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) startScan(f); });
$('#scanAdd').addEventListener('click', addScan);
$('#scanCancel').addEventListener('click', closeScan);
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
$('#prev').addEventListener('click', () => shift(-1));
$('#next').addEventListener('click', () => shift(1));
$('#today').addEventListener('click', () => goto(todayKey()));
$('#mPrev').addEventListener('click', () => { calM.m--; if (calM.m < 0) { calM.m = 11; calM.y--; } renderCal(); });
$('#mNext').addEventListener('click', () => { calM.m++; if (calM.m > 11) { calM.m = 0; calM.y++; } renderCal(); });
$('#mSel').addEventListener('change', (e) => { calM.m = Number(e.target.value); renderCal(); });
$('#ySel').addEventListener('change', (e) => { calM.y = Number(e.target.value); renderCal(); });
['#cal', '#results', '#otd'].forEach((s) => $(s).addEventListener('click', (ev) => { const b = ev.target.closest('button[data-k]'); if (b) goto(b.dataset.k, true); }));
let qTimer = null;
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderSearch, 250); });
['#range', '#from', '#to'].forEach((s) => $(s).addEventListener('change', renderExport));
$('#expPrint').addEventListener('click', () => runExport('print'));
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

let delArmed = false, delTimer = null;
const disarm = () => { delArmed = false; clearTimeout(delTimer); $('#del').classList.remove('armed'); };
$('#del').addEventListener('click', async () => {
  if (!hasContent(entries[cur])) return;
  if (!delArmed) { delArmed = true; $('#del').classList.add('armed'); setStatus('Tap the bin again to delete'); delTimer = setTimeout(() => { disarm(); setStatus('saved'); }, 4000); return; }
  disarm();
  const k = cur, ids = (entries[k].photos || []).slice();
  clearTimeout(timer); dirty = false;
  try {
    await writing;
    store.deleteEntry(k).catch(() => setStatus('Not deleted online. Check your connection.'));
    for (const id of ids) store.deletePhoto(id).catch(() => {});
    entries[k] = null; if (totalCount) totalCount--;
    if (cur === k) loadEditor();
    renderAll(); setStatus('Entry deleted');
  } catch (err) { setStatus('Could not delete. Check your connection and try again.'); }
});

const OFFLINE_MSG = 'You are offline. You can keep writing; it is kept on this device and uploads when you are back online.';
function netState() {
  const b = $('#banner');
  if (!navigator.onLine) { if (!$('#shell').hidden) showBanner(OFFLINE_MSG); }
  else if (b.textContent === OFFLINE_MSG) showBanner('');
  if (navigator.onLine && pending) setStatus('Uploading…');
}
window.addEventListener('online', netState);
window.addEventListener('offline', netState);
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('resize', autosize);

$('#range').value = 'month';
const t0 = parseKey(cur); calM = { y: t0.getFullYear(), m: t0.getMonth() };
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
