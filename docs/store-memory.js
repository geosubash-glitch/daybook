// A throwaway in-memory store with the same functions as store-firebase.js.
// Used for trying the app without a database (set backend: 'memory' in config.js).
export function createStore(cfg) {
  const entries = new Map(), settings = new Map(), photos = new Map();
  (cfg.seed || []).forEach((e) => entries.set(e.date, e));
  let user = null, authCb = () => {}, watchers = [];
  const sorted = () => [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
  const fire = () => watchers.forEach((w) => w());
  return {
    onAuth(cb) { authCb = cb; setTimeout(() => cb(user), 0); return () => {}; },
    async signIn(email) { user = { email, uid: 'mem' }; authCb(user); },
    async signInGoogle() { user = { email: 'you@gmail.com', uid: 'mem' }; authCb(user); },
    async deleteAccount() { entries.clear(); settings.clear(); photos.clear(); user = null; authCb(null); },
    async signOut() { user = null; authCb(null); },
    async resetPassword() {},
    watchRecent(from, cb) {
      const run = () => cb(clone(sorted().filter((e) => e.date >= from).reverse()));
      watchers.push(run); setTimeout(run, 0); return () => { watchers = watchers.filter((w) => w !== run); };
    },
    async getRange(a, b) { return clone(sorted().filter((e) => e.date >= a && e.date <= b)); },
    async getAll() { return clone(sorted()); },
    async getEntry(d) { return clone(entries.get(d)) || null; },
    async setEntry(d, data) { entries.set(d, clone(data)); fire(); if (typeof window !== 'undefined' && window.__offline) return new Promise(() => {}); },
    async deleteEntry(d) { entries.delete(d); fire(); },
    async count() { return entries.size; },
    async countRange(a, b) { return sorted().filter((e) => e.date >= a && e.date <= b).length; },
    async firstDate() { const s = sorted(); return s.length ? s[0].date : null; },
    async getSetting(n) { return clone(settings.get(n)) || null; },
    async setSetting(n, d) { settings.set(n, clone(d)); },
    async deleteSetting(n) { settings.delete(n); },
    async addPhoto(id, data, date) { photos.set(id, { data, date: date || '', created: Date.now() }); },
    async getPhoto(id) { const d = photos.get(id); return d ? d.data || null : null; },
    async getPhotoDoc(id) { return clone(photos.get(id)) || null; },
    async putPhotoDoc(id, d) { photos.set(id, clone(d)); },
    async listPhotos() { return [...photos.keys()]; },
    async deletePhoto(id) { photos.delete(id); },
    async sync() {}
  };
}
