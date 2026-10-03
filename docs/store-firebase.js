// Online storage: Firebase Authentication + Cloud Firestore (free Spark plan).
// This is the only file that talks to Firebase. To move Daybook to another
// database someday, write a new store with the same functions as this one.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore, waitForPendingWrites, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, getCountFromServer }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export function createStore(cfg) {
  const app = initializeApp(cfg.firebase);
  const auth = getAuth(app);
  // Offline support: writes made without internet are kept in the browser's database and
  // uploaded automatically when the connection returns. The online copy remains the real one.
  let db;
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { db = getFirestore(app); }
  let uid = null;
  const col = (n) => collection(db, 'users', uid, n);
  const ref = (n, id) => doc(db, 'users', uid, n, id);
  const rows = (s) => s.docs.map((d) => d.data());

  return {
    onAuth(cb) { return onAuthStateChanged(auth, (u) => { uid = u ? u.uid : null; cb(u ? { email: u.email } : null); }); },
    signIn: (email, pass) => signInWithEmailAndPassword(auth, email, pass),
    signOut: () => signOut(auth),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),

    watchRecent(fromDate, cb, onErr) {
      return onSnapshot(query(col('entries'), where('date', '>=', fromDate), orderBy('date', 'desc')), (s) => cb(rows(s)), onErr);
    },
    async getRange(a, b) { return rows(await getDocs(query(col('entries'), where('date', '>=', a), where('date', '<=', b), orderBy('date')))); },
    async getAll() { return rows(await getDocs(query(col('entries'), orderBy('date')))); },
    async getEntry(date) { const d = await getDoc(ref('entries', date)); return d.exists() ? d.data() : null; },
    setEntry: (date, data) => setDoc(ref('entries', date), data),
    deleteEntry: (date) => deleteDoc(ref('entries', date)),
    async count() { return (await getCountFromServer(col('entries'))).data().count; },
    async countRange(a, b) { return (await getCountFromServer(query(col('entries'), where('date', '>=', a), where('date', '<=', b)))).data().count; },
    async firstDate() { const s = await getDocs(query(col('entries'), orderBy('date'), limit(1))); return s.empty ? null : s.docs[0].data().date; },

    async getSetting(name) { const d = await getDoc(ref('settings', name)); return d.exists() ? d.data() : null; },
    setSetting: (name, data) => setDoc(ref('settings', name), data),
    deleteSetting: (name) => deleteDoc(ref('settings', name)),

    addPhoto: (id, dataUrl, date) => setDoc(ref('photos', id), { data: dataUrl, date, created: Date.now() }),
    async getPhoto(id) { const d = await getDoc(ref('photos', id)); return d.exists() ? d.data().data : null; },
    deletePhoto: (id) => deleteDoc(ref('photos', id)),
    sync: () => waitForPendingWrites(db)
  };
}
