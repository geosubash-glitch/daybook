// Database rules tests. Run with:  firebase emulators:exec --only firestore "node --test tests/rules.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'daybook-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const me = () => env.authenticatedContext('alice').firestore();
const other = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();
const plain = (date, extra = {}) => ({ date, title: 't', body: 'b', photos: [], updated: 1, ...extra });
const sealed = (date, extra = {}) => ({ date, photos: [], updated: 1, v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'QUJDRA==', ...extra });
const keys = (done = false, extra = {}) => ({ v: 1, iter: 600000, salt: 'AAAA', iv: 'AAAA', wrapped: 'AAAA', rsalt: 'AAAA', riv: 'AAAA', rwrapped: 'AAAA', done, created: 1, ...extra });
const e = (db, d) => doc(db, 'users/alice/entries/' + d);

test('only the owner can read or write', async () => {
  await assertSucceeds(setDoc(e(me(), '2026-10-04'), plain('2026-10-04')));
  await assertSucceeds(getDoc(e(me(), '2026-10-04')));
  await assertFails(getDoc(e(other(), '2026-10-04')));
  await assertFails(setDoc(e(other(), '2026-10-05'), plain('2026-10-05')));
  await assertFails(getDoc(e(anon(), '2026-10-04')));
});
test('plain entries are checked for shape and size', async () => {
  await assertFails(setDoc(e(me(), '2026-10-04'), plain('2026-10-05')));
  await assertFails(setDoc(e(me(), '2026-10-04'), plain('2026-10-04', { extra: 1 })));
  await assertFails(setDoc(e(me(), '2026-10-04'), plain('2026-10-04', { body: 'x'.repeat(200001) })));
  await assertFails(setDoc(e(me(), 'not-a-date'), plain('not-a-date')));
  await assertFails(setDoc(e(me(), '1800-01-01'), plain('1800-01-01')));
  await assertFails(setDoc(e(me(), '2999-01-01'), plain('2999-01-01')));
  await assertFails(setDoc(e(me(), '2026-10-04'), plain('2026-10-04', { photos: Array(25).fill('a') })));
});
test('encrypted entries are accepted and checked', async () => {
  await assertSucceeds(setDoc(e(me(), '2026-10-04'), sealed('2026-10-04')));
  await assertFails(setDoc(e(me(), '2026-10-04'), sealed('2026-10-04', { ct: 'not base64!' })));
  await assertFails(setDoc(e(me(), '2026-10-04'), sealed('2026-10-04', { v: 2 })));
  await assertFails(setDoc(e(me(), '2026-10-04'), sealed('2026-10-04', { title: 'leak' })));
  await assertFails(setDoc(e(me(), '2026-10-04'), sealed('2026-10-04', { ct: 'A'.repeat(700001) })));
});
test('after encryption is finished, plain writes are refused', async () => {
  await assertSucceeds(setDoc(doc(me(), 'users/alice/settings/keys'), keys(false)));
  await assertSucceeds(setDoc(e(me(), '2026-10-04'), plain('2026-10-04')));
  await assertSucceeds(setDoc(doc(me(), 'users/alice/settings/keys'), keys(true)));
  await assertFails(setDoc(e(me(), '2026-10-05'), plain('2026-10-05')));
  await assertSucceeds(setDoc(e(me(), '2026-10-05'), sealed('2026-10-05')));
  await assertFails(setDoc(doc(me(), 'users/alice/settings/photos'), { x: 1 }));
});
test('finished keys cannot be turned back to unfinished, but can be re-wrapped', async () => {
  await assertSucceeds(setDoc(doc(me(), 'users/alice/settings/keys'), keys(true)));
  await assertFails(setDoc(doc(me(), 'users/alice/settings/keys'), keys(false)));
  await assertSucceeds(setDoc(doc(me(), 'users/alice/settings/keys'), keys(true, { wrapped: 'BBBB' })));
});
test('keys document shape', async () => {
  await assertFails(setDoc(doc(me(), 'users/alice/settings/keys'), keys(false, { iter: 10 })));
  await assertFails(setDoc(doc(me(), 'users/alice/settings/keys'), keys(false, { extra: 1 })));
  await assertFails(setDoc(doc(me(), 'users/alice/settings/keys'), keys(false, { salt: 'bad salt!' })));
});
test('photos: plain and encrypted shapes', async () => {
  const p = (db, id) => doc(db, 'users/alice/photos/' + id);
  await assertSucceeds(setDoc(p(me(), 'a1'), { data: 'data:image/jpeg;base64,AAAA', date: '2026-10-04', created: 1 }));
  await assertFails(setDoc(p(me(), 'a2'), { data: 'data:text/html;base64,AAAA', date: '2026-10-04', created: 1 }));
  await assertSucceeds(setDoc(p(me(), 'a3'), { v: 1, iv: 'AAAA', ct: 'QUJD', date: '2026-10-04', created: 1 }));
  await assertFails(getDoc(p(other(), 'a3')));
});
test('telemetry is write-only and sanity checked', async () => {
  const t = (id) => doc(me(), 'telemetry/' + id);
  const ok = { iid: 'x', t: Date.now(), ev: 'open', v: '1.0', plat: 'web', os: 'test' };
  await assertSucceeds(setDoc(t('1'), ok));
  await assertFails(getDoc(t('1')));
  await assertFails(setDoc(t('2'), { ...ok, t: 5 }));
  await assertFails(setDoc(t('3'), { ...ok, secret: 'x' }));
  await assertFails(setDoc(doc(anon(), 'telemetry/4'), ok));
});
test('everything else is closed', async () => {
  await assertFails(setDoc(doc(me(), 'anything/x'), { a: 1 }));
  await assertFails(setDoc(doc(me(), 'users/alice/other/x'), { a: 1 }));
  await assertFails(deleteDoc(doc(other(), 'users/alice/entries/2026-10-04')));
});
