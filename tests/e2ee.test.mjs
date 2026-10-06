import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {};
const E = await import('../docs/e2ee.js');
const { createStore } = await import('../docs/store-memory.js');

const mapVault = () => { const m = new Map(); return { get: async (k) => m.get(k) || null, put: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); }, m }; };
const PIC = 'data:image/png;base64,' + Buffer.from('fake-png-bytes-1234567890').toString('base64');
const seed = () => [
  { date: '2026-10-01', title: 'First', body: 'Plain words about the first day', photos: ['p1'], updated: 1 },
  { date: '2026-10-02', title: '', body: 'Second day, unicode: नमस्ते ☕ and quotes "ok"', photos: [], updated: 2 },
  { date: '2026-10-03', title: 'Third', body: 'x'.repeat(5000), photos: [], updated: 3 }
];
async function fresh() {
  const inner = createStore({ seed: seed() });
  await inner.addPhoto('p1', PIC, '2026-10-01');
  const vault = mapVault();
  const s = E.createEncryptedStore(inner, { vault });
  await s.enc.attach(null, 'mem');
  return { inner, s, vault };
}

test('recovery keys look right and are random', () => {
  const a = E.newRecoveryKey(), b = E.newRecoveryKey();
  assert.match(a, /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){4}$/);
  assert.notEqual(a, b);
});

test('entries round trip and are unreadable without the key', async () => {
  const { privateKey } = {}; // no-op, keeps lint quiet
  const { doc, key } = await E.createKeys('correct horse battery', 'ABCD-EFGH-JKMN-PQRS-TUVW');
  const sealed = await E.sealEntry(key, { date: '2026-10-05', title: 'T', body: 'secret body', photos: [], updated: 9 });
  assert.equal(sealed.v, 1);
  assert.ok(!JSON.stringify(sealed).includes('secret'));
  const back = await E.openEntry(key, sealed);
  assert.equal(back.body, 'secret body'); assert.equal(back.title, 'T');
  // wrong key
  const other = await E.createKeys('another passphrase!', 'AAAA-BBBB-CCCC-DDDD-EEEE');
  await assert.rejects(E.openEntry(other.key, sealed), /decrypt/);
  // moved to another date
  await assert.rejects(E.openEntry(key, { ...sealed, date: '2026-10-06' }), /decrypt/);
});

test('passphrase and recovery key both open the key; wrong ones do not', async () => {
  const rk = E.newRecoveryKey();
  const { doc, key } = await E.createKeys('correct horse battery', rk);
  const sealed = await E.sealEntry(key, { date: '2026-10-05', title: '', body: 'hello', photos: [], updated: 1 });
  const k1 = await E.openKey(doc, 'correct horse battery', 'passphrase');
  const k2 = await E.openKey(doc, rk.toLowerCase().replace(/-/g, ' '), 'recovery');
  assert.equal((await E.openEntry(k1, sealed)).body, 'hello');
  assert.equal((await E.openEntry(k2, sealed)).body, 'hello');
  await assert.rejects(E.openKey(doc, 'wrong passphrase!!', 'passphrase'), { code: 'e2ee/wrong-secret' });
  await assert.rejects(E.openKey(doc, 'AAAA-BBBB-CCCC-DDDD-EEEE', 'recovery'), { code: 'e2ee/wrong-secret' });
  await assert.rejects(E.createKeys('short', rk), { code: 'e2ee/short' });
});

test('changing the passphrase keeps old entries readable', async () => {
  const rk = E.newRecoveryKey();
  const { doc, key } = await E.createKeys('first passphrase', rk);
  const sealed = await E.sealEntry(key, { date: '2026-10-05', title: '', body: 'keep me', photos: [], updated: 1 });
  const next = await E.rewrapPassphrase(doc, rk, 'recovery', 'second passphrase');
  const k = await E.openKey(next, 'second passphrase', 'passphrase');
  assert.equal((await E.openEntry(k, sealed)).body, 'keep me');
  await assert.rejects(E.openKey(next, 'first passphrase', 'passphrase'), { code: 'e2ee/wrong-secret' });
  assert.equal((await E.openKey(next, rk, 'recovery')) !== null, true);
});

test('photos round trip', async () => {
  const { key } = await E.createKeys('correct horse battery', E.newRecoveryKey());
  const doc = await E.sealPhoto(key, 'p1', PIC, '2026-10-01');
  assert.ok(doc.ct && !doc.data);
  assert.equal(await E.openPhoto(key, 'p1', doc), PIC);
  assert.equal(await E.openPhoto(key, 'p1', { data: PIC }), PIC); // an old plain photo still opens
});

test('migration encrypts everything, verifies, and the app still sees plain entries', async () => {
  const { inner, s } = await fresh();
  const before = await s.getAll();
  assert.equal(before.length, 3);
  const rk = E.newRecoveryKey();
  assert.equal(await s.enc.setup('correct horse battery', rk), 'migrating');
  const seen = [];
  const total = await s.enc.migrate((n, t) => seen.push([n, t]));
  assert.equal(total, 4); assert.deepEqual(seen.at(-1), [4, 4]);
  assert.equal(s.enc.status(), 'ready');
  // what the database holds
  const raw = await inner.getAll();
  assert.ok(raw.every((r) => r.v === 1 && !('body' in r) && !('title' in r)));
  assert.ok(!JSON.stringify(raw).includes('Plain words'));
  const rawPhoto = await inner.getPhotoDoc('p1');
  assert.ok(rawPhoto.v === 1 && !rawPhoto.data);
  // what the app sees
  const after = await s.getAll();
  assert.deepEqual(after.map((e) => [e.date, e.title, e.body, e.photos]), before.map((e) => [e.date, e.title, e.body, e.photos]));
  assert.equal(await s.getPhoto('p1'), PIC);
  assert.equal((await s.getEntry('2026-10-02')).body.includes('नमस्ते'), true);
  const keys = await inner.getSetting('keys');
  assert.equal(keys.done, true);
  assert.ok(!JSON.stringify(keys).includes('correct horse'));
});

test('migration can be run twice and new writes are encrypted', async () => {
  const { inner, s } = await fresh();
  await s.enc.setup('correct horse battery', E.newRecoveryKey());
  await s.enc.migrate();
  await s.enc.migrate();
  await s.setEntry('2026-10-09', { date: '2026-10-09', title: 'New', body: 'brand new secret', photos: [], updated: 5 });
  const raw = await inner.getEntry('2026-10-09');
  assert.equal(raw.v, 1); assert.ok(!JSON.stringify(raw).includes('brand new'));
  assert.equal((await s.getEntry('2026-10-09')).body, 'brand new secret');
  await s.addPhoto('p2', PIC, '2026-10-09');
  assert.ok((await inner.getPhotoDoc('p2')).ct);
  assert.equal(await s.getPhoto('p2'), PIC);
});

test('a new phone must unlock; the vault remembers; forgetting asks again', async () => {
  const { inner, s, vault } = await fresh();
  const rk = E.newRecoveryKey();
  await s.enc.setup('correct horse battery', rk); await s.enc.migrate();
  const keysDoc = await inner.getSetting('keys');
  // same phone: key is in the vault
  const s2 = E.createEncryptedStore(inner, { vault });
  assert.equal(await s2.enc.attach(keysDoc, 'mem'), 'ready');
  assert.equal((await s2.getEntry('2026-10-02')).body.includes('Second'), true);
  // new phone: empty vault
  const s3 = E.createEncryptedStore(inner, { vault: mapVault() });
  assert.equal(await s3.enc.attach(keysDoc, 'mem'), 'needs-key');
  await assert.rejects(s3.getAll(), { code: 'e2ee/locked' });
  await assert.rejects(s3.enc.unlock('wrong wrong wrong', 'passphrase'), { code: 'e2ee/wrong-secret' });
  assert.equal(await s3.enc.unlock('correct horse battery', 'passphrase'), 'ready');
  assert.equal((await s3.getAll()).length, 3);
  // recovery path on yet another phone, then a new passphrase
  const s4 = E.createEncryptedStore(inner, { vault: mapVault() });
  await s4.enc.attach(keysDoc, 'mem');
  await s4.enc.unlock(rk, 'recovery');
  await s4.enc.changePassphrase(rk, 'recovery', 'a brand new passphrase');
  const s5 = E.createEncryptedStore(inner, { vault: mapVault() });
  await s5.enc.attach(await inner.getSetting('keys'), 'mem');
  assert.equal(await s5.enc.unlock('a brand new passphrase', 'passphrase'), 'ready');
  assert.equal((await s5.getAll()).length, 3);
  // forget this phone
  await s2.enc.forgetDevice();
  const s6 = E.createEncryptedStore(inner, { vault });
  assert.equal(await s6.enc.attach(await inner.getSetting('keys'), 'mem'), 'needs-key');
});

test('an unreadable entry is never overwritten with blanks', async () => {
  const { inner, s } = await fresh();
  await s.enc.setup('correct horse battery', E.newRecoveryKey()); await s.enc.migrate();
  const row = await inner.getEntry('2026-10-01');
  await inner.setEntry('2026-10-01', { ...row, ct: row.ct.slice(0, -4) + 'AAAA' }); // damaged
  const e = await s.getEntry('2026-10-01');
  assert.equal(e._unreadable, true);
  await assert.rejects(s.setEntry('2026-10-01', { date: '2026-10-01', title: '', body: '', photos: [], updated: 7 }), { code: 'e2ee/unreadable' });
});

test('watchRecent delivers decrypted rows in order', async () => {
  const { s } = await fresh();
  await s.enc.setup('correct horse battery', E.newRecoveryKey()); await s.enc.migrate();
  const got = await new Promise((res) => { const un = s.watchRecent('2026-01-01', (rows) => { un(); res(rows); }); });
  assert.equal(got.length, 3);
  assert.ok(got.every((r) => typeof r.body === 'string' && !('ct' in r)));
});

test('without keys the wrapper changes nothing', async () => {
  const { inner, s } = await fresh();
  await s.setEntry('2026-10-10', { date: '2026-10-10', title: 'p', body: 'plain stays plain', photos: [], updated: 1 });
  assert.equal((await inner.getEntry('2026-10-10')).body, 'plain stays plain');
});
