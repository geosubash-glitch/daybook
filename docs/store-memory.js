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
    async signIn(email) { user = { email }; authCb(user); },
    async signOut() { user = null; authCb(null); },
    async resetPassword() {},
    watchRecent(from, cb) {
      const run = () => cb(clone(sorted().filter((e) => e.date >= from).reverse()));
      watchers.push(run); setTimeout(run, 0); return () => { watchers = watchers.filter((w) => w !== run); };
    },
    async getRange(a, b) { return clone(sorted().filter((e) => e.date >= a && e.date <= b)); },
    async getAll() { return clone(sorted()); },
    async getEntry(d) { return clone(entries.get(d)) || null; },
    async setEntry(d, data) { entries.set(d, clone(data)); fire(); if (window.__offline) return new Promise(() => {}); },
    async deleteEntry(d) { entries.delete(d); fire(); },
    async count() { return entries.size; },
    async countRange(a, b) { return sorted().filter((e) => e.date >= a && e.date <= b).length; },
    async firstDate() { const s = sorted(); return s.length ? s[0].date : null; },
    async getSetting(n) { return clone(settings.get(n)) || null; },
    async setSetting(n, d) { settings.set(n, clone(d)); },
    async deleteSetting(n) { settings.delete(n); },
    async addPhoto(id, data) { photos.set(id, data); },
    async getPhoto(id) { return photos.get(id) || null; },
    async deletePhoto(id) { photos.delete(id); },
    async sync() {}
  };
}
