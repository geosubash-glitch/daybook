// End-to-end encryption for Daybook (opt-in).
//
// How it works, in plain words:
//  * A random 256-bit key (the "data key") encrypts every entry and photo on the device with AES-GCM
//    before anything is sent to the database. The database only ever holds scrambled text.
//  * The data key itself is stored online only in locked form: once locked with your passphrase and once
//    with a random recovery key. Neither the passphrase nor the recovery key ever leaves the device.
//  * Locking uses PBKDF2-SHA-256 with 600,000 rounds, so guessing a passphrase is slow.
//  * After you unlock once, the phone keeps the data key in the app's private storage as a
//    non-extractable key, so you are not asked again on that phone.
// Lose both the passphrase and the recovery key and the entries cannot be read by anyone, including the developer.

const te = new TextEncoder(), td = new TextDecoder();
export const ITER = 600000;
export const MIN_PASSPHRASE = 8;

const subtle = () => globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* ---------- recovery key ---------- */
// 20 characters from an alphabet without look-alikes: 100 bits of randomness, shown as XXXX-XXXX-XXXX-XXXX-XXXX.
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 characters
export function newRecoveryKey() {
  const out = [];
  while (out.length < 20) {
    const b = rand(32);
    for (const x of b) { if (x < 248 && out.length < 20) out.push(ALPHA[x % 31]); } // 248 = 31 * 8, so no bias
  }
  return out.join('').replace(/(.{4})(?=.)/g, '$1-');
}
// Case, spaces and dashes do not matter when the key is typed back in.
function recoverySecret(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/* ---------- key wrapping ---------- */
async function kek(secret, saltB64, iter) {
  const base = await subtle().importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrap(secret, raw, iter) {
  const salt = b64(rand(16)), iv = rand(12);
  const k = await kek(secret, salt, iter);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('dek') }, k, raw));
  return { salt, iv: b64(iv), wrapped: b64(ct) };
}
async function unwrapRaw(secret, part) {
  const k = await kek(secret, part.salt, part.iter);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(part.iv), additionalData: te.encode('dek') }, k, unb64(part.wrapped)));
  } catch (e) { throw Object.assign(new Error('wrong secret'), { code: 'e2ee/wrong-secret' }); }
}
const asKey = (raw) => subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

// Create a brand-new set of keys. Returns the document to store online (not finished yet) and the usable data key.
export async function createKeys(passphrase, recoveryKey) {
  if (String(passphrase || '').length < MIN_PASSPHRASE) throw Object.assign(new Error('short'), { code: 'e2ee/short' });
  const raw = rand(32);
  try {
    const p = await wrap(passphrase, raw, ITER), r = await wrap(recoverySecret(recoveryKey), raw, ITER);
    const doc = { v: 1, iter: ITER, salt: p.salt, iv: p.iv, wrapped: p.wrapped, rsalt: r.salt, riv: r.iv, rwrapped: r.wrapped, done: false, created: Date.now() };
    return { doc, key: await asKey(raw) };
  } finally { raw.fill(0); }
}
const part = (doc, which) => which === 'recovery'
  ? { salt: doc.rsalt, iv: doc.riv, wrapped: doc.rwrapped, iter: doc.iter } : { salt: doc.salt, iv: doc.iv, wrapped: doc.wrapped, iter: doc.iter };

// Open the data key with the passphrase or the recovery key. Throws code 'e2ee/wrong-secret' when it does not fit.
export async function openKey(doc, secret, which) {
  const raw = await unwrapRaw(which === 'recovery' ? recoverySecret(secret) : secret, part(doc, which));
  try { return await asKey(raw); } finally { raw.fill(0); }
}
// Lock the same data key again with a new passphrase (after "change" or "forgot").
export async function rewrapPassphrase(doc, secret, which, newPassphrase) {
  if (String(newPassphrase || '').length < MIN_PASSPHRASE) throw Object.assign(new Error('short'), { code: 'e2ee/short' });
  const raw = await unwrapRaw(which === 'recovery' ? recoverySecret(secret) : secret, part(doc, which));
  try {
    const p = await wrap(newPassphrase, raw, doc.iter || ITER);
    return Object.assign({}, doc, { salt: p.salt, iv: p.iv, wrapped: p.wrapped });
  } finally { raw.fill(0); }
}

/* ---------- entries and photos ---------- */
const aad = (kind, id) => te.encode(kind + ':' + id);
async function seal(key, bytes, kind, id) {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(kind, id) }, key, bytes));
  return { iv: b64(iv), ct: b64(ct) };
}
async function open(key, iv, ct, kind, id) {
  try { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: aad(kind, id) }, key, unb64(ct))); }
  catch (e) { throw Object.assign(new Error('cannot decrypt'), { code: 'e2ee/bad-data' }); }
}
export const isSealed = (row) => !!row && row.v === 1 && typeof row.ct === 'string';

export async function sealEntry(key, e) {
  const s = await seal(key, te.encode(JSON.stringify({ title: e.title || '', body: e.body || '' })), 'entry', e.date);
  return { date: e.date, photos: e.photos || [], updated: e.updated, v: 1, iv: s.iv, ct: s.ct };
}
export async function openEntry(key, row) {
  if (!isSealed(row)) return row;
  const t = JSON.parse(td.decode(await open(key, row.iv, row.ct, 'entry', row.date)));
  return { date: row.date, title: t.title, body: t.body, photos: row.photos || [], updated: row.updated };
}

const MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export async function sealPhoto(key, id, dataUrl, date) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('not an image'), { code: 'e2ee/bad-photo' });
  const bin = unb64(m[2]), bytes = new Uint8Array(bin.length + 1);
  bytes[0] = MIMES.indexOf(m[1]); bytes.set(bin, 1);
  const s = await seal(key, bytes, 'photo', id);
  return { v: 1, iv: s.iv, ct: s.ct, date, created: Date.now() };
}
export async function openPhoto(key, id, doc) {
  if (!isSealed(doc)) return doc ? doc.data : null;
  const bytes = await open(key, doc.iv, doc.ct, 'photo', id);
  return 'data:' + (MIMES[bytes[0]] || 'image/jpeg') + ';base64,' + b64(bytes.subarray(1));
}

/* ---------- keeping the key on this phone ---------- */
// A CryptoKey that is not extractable can be saved in IndexedDB. Scripts can use it but can never read its bytes.
export function idbVault(name = 'daybook-vault') {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => { const tx = db.transaction('keys', mode), rq = fn(tx.objectStore('keys')); tx.oncomplete = () => { db.close(); res(rq && rq.result); }; tx.onerror = () => { db.close(); rej(tx.error); }; });
  };
  return {
    get: (id) => run('readonly', (s) => s.get(id)).catch(() => null),
    put: (id, key) => run('readwrite', (s) => s.put(key, id)).catch(() => {}),
    del: (id) => run('readwrite', (s) => s.delete(id)).catch(() => {})
  };
}

/* ---------- the store wrapper ---------- */
// Wraps a store (store-firebase.js or store-memory.js) so the rest of the app never sees ciphertext.
// With no keys document the wrapper changes nothing: entries are stored as before.
export function createEncryptedStore(inner, opts = {}) {
  const vault = opts.vault || idbVault();
  let doc = null, key = null, uid = 'local', remember = true;
  const bad = new Set(); // dates that could not be decrypted, never overwritten
  const sealing = () => !!doc;
  const need = () => { if (!key) throw Object.assign(new Error('locked'), { code: 'e2ee/locked' }); return key; };

  async function dec(row) {
    if (!isSealed(row)) return row;
    try { return await openEntry(need(), row); }
    catch (e) { if (e.code === 'e2ee/locked') throw e; bad.add(row.date); return { date: row.date, title: '', body: '', photos: row.photos || [], updated: row.updated, _unreadable: true }; }
  }
  const decAll = (rows) => Promise.all(rows.map(dec));

  const enc = {
    // 'off' | 'migrating' | 'needs-key' | 'ready'
    async attach(keysDoc, userId) {
      doc = keysDoc && keysDoc.v === 1 ? keysDoc : null; uid = userId || 'local'; key = null; bad.clear();
      if (!doc) return 'off';
      const saved = await vault.get(uid);
      if (saved) { key = saved; }
      return enc.status();
    },
    status() { return !doc ? 'off' : !key ? 'needs-key' : doc.done ? 'ready' : 'migrating'; },
    isOn: () => !!doc,
    isRemembered: () => remember,
    // Brand new setup on this device. Returns the recovery key once; the caller must show it to the person.
    async setup(passphrase, recoveryKey) {
      const made = await createKeys(passphrase, recoveryKey);
      await inner.setSetting('keys', made.doc);
      doc = made.doc; key = made.key; if (remember) await vault.put(uid, key);
      return enc.status();
    },
    async unlock(secret, which) {
      if (!doc) throw new Error('no keys');
      key = await openKey(doc, secret, which);
      if (remember) await vault.put(uid, key);
      return enc.status();
    },
    async changePassphrase(secret, which, newPassphrase) {
      const next = await rewrapPassphrase(doc, secret, which, newPassphrase);
      await inner.setSetting('keys', next); doc = next;
      if (which === 'recovery') { key = await openKey(doc, newPassphrase, 'passphrase'); if (remember) await vault.put(uid, key); }
    },
    async setRemember(on) { remember = !!on; if (!on) await vault.del(uid); else if (key) await vault.put(uid, key); },
    async forgetDevice() { await vault.del(uid); key = null; },
    clearMemory() { key = null; },
    // Encrypts everything already stored. Safe to run again: finished rows are skipped.
    async migrate(onProgress) {
      need();
      const all = await inner.getAll();
      const todo = all.filter((r) => !isSealed(r));
      const photoIds = await (inner.listPhotos ? inner.listPhotos() : Promise.resolve([]));
      const total = todo.length + photoIds.length;
      let n = 0;
      const tick = () => { n++; if (onProgress) onProgress(n, total); };
      for (const row of todo) {
        const sealed = await sealEntry(key, row);
        const back = await openEntry(key, sealed); // prove it opens before the plain copy is replaced
        if (back.title !== (row.title || '') || back.body !== (row.body || '') || JSON.stringify(back.photos) !== JSON.stringify(row.photos || [])) throw Object.assign(new Error('verify failed'), { code: 'e2ee/verify' });
        await inner.setEntry(row.date, sealed);
        tick();
      }
      for (const id of photoIds) {
        const d = await inner.getPhotoDoc(id);
        if (d && !isSealed(d)) {
          const sealed = await sealPhoto(key, id, d.data, d.date);
          if ((await openPhoto(key, id, sealed)) !== d.data) throw Object.assign(new Error('verify failed'), { code: 'e2ee/verify' });
          await inner.putPhotoDoc(id, sealed);
        }
        tick();
      }
      const left = (await inner.getAll()).filter((r) => !isSealed(r)).length;
      if (left) throw Object.assign(new Error('some entries are still plain'), { code: 'e2ee/incomplete' });
      const done = Object.assign({}, doc, { done: true });
      await inner.setSetting('keys', done); doc = done;
      return total;
    }
  };

  return Object.assign({}, inner, {
    enc,
    onAuth(cb) { return inner.onAuth((u) => { if (!u) { enc.clearMemory(); doc = null; } cb(u); }); },
    async signOut() { try { await vault.del(uid); } catch (e) {} enc.clearMemory(); doc = null; return inner.signOut(); },
    async deleteAccount(...a) { const r = await inner.deleteAccount(...a); try { await vault.del(uid); } catch (e) {} enc.clearMemory(); doc = null; return r; },
    watchRecent(from, cb, onErr) {
      let seq = 0;
      return inner.watchRecent(from, (rows) => {
        const mine = ++seq;
        decAll(rows).then((out) => { if (mine === seq) cb(out); }).catch((e) => { if (onErr) onErr(e); });
      }, onErr);
    },
    async getRange(a, b) { return decAll(await inner.getRange(a, b)); },
    async getAll() { return decAll(await inner.getAll()); },
    async getEntry(d) { const r = await inner.getEntry(d); return r ? dec(r) : r; },
    async setEntry(date, data) {
      if (bad.has(date)) throw Object.assign(new Error('this entry could not be read, so it is not overwritten'), { code: 'e2ee/unreadable' });
      if (!sealing()) return inner.setEntry(date, data);
      return inner.setEntry(date, await sealEntry(need(), Object.assign({}, data, { date })));
    },
    async addPhoto(id, dataUrl, date) {
      if (!sealing()) return inner.addPhoto(id, dataUrl, date);
      return inner.putPhotoDoc(id, await sealPhoto(need(), id, dataUrl, date));
    },
    async getPhoto(id) {
      if (!inner.getPhotoDoc) return inner.getPhoto(id);
      const d = await inner.getPhotoDoc(id);
      if (!d) return null;
      try { return await openPhoto(isSealed(d) ? need() : null, id, d); } catch (e) { return null; }
    }
  });
}
