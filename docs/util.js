// Small pure helpers: dates, text counting and escaping. No page or database access, so they are easy to test.
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const parseKey = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
export const todayKey = () => keyOf(new Date());
export const longDate = (k) => { const d = parseKey(k); return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const words = (t) => { t = (t || '').trim(); return t ? t.split(/\s+/).length : 0; };
export const hasContent = (e) => !!(e && (((e.body || '').trim()) || ((e.title || '').trim()) || (e.photos && e.photos.length)));
export const fmt = (n) => n.toLocaleString();
export const dayNumber = (d) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
export const icon = (id) => '<svg class="ic"><use href="#i-' + id + '"/></svg>';
export const timeNow = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const isDate = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k || '') && keyOf(parseKey(k)) === k;
