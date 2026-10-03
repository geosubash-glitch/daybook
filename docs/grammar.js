// Spelling and grammar fixes through LanguageTool's free public service. No key or account needed.
// Only the text being checked is sent. Style suggestions are ignored: this fixes mistakes, never your voice.
const URL_ = 'https://api.languagetool.org/v2/check';
const KEEP = new Set(['TYPOS', 'GRAMMAR', 'PUNCTUATION', 'CASING', 'CONFUSED_WORDS', 'COMPOUNDING']);
const CHUNK = 15000; // the free service accepts about 20 KB per request

function chunks(text) {
  if (text.length <= CHUNK) return [text];
  const out = []; let cur = '';
  for (const part of text.split(/(\n)/)) {
    if (cur.length + part.length > CHUNK && cur) { out.push(cur); cur = ''; }
    cur += part;
  }
  if (cur) out.push(cur);
  return out;
}

async function check(text) {
  let r;
  try {
    r = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ text, language: 'auto', preferredVariants: 'en-GB', level: 'default' })
    });
  } catch (e) { throw Object.assign(new Error('network'), { code: 'network' }); }
  if (r.status === 429) throw Object.assign(new Error('busy'), { code: 'rate_limited' });
  if (!r.ok) throw Object.assign(new Error('lt ' + r.status), { code: 'error' });
  return (await r.json()).matches || [];
}

// For spelling mistakes, pick the suggestion closest to what was typed (ties go to the longer word,
// so "realy" becomes "really", not "real").
function dist(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function pick(orig, m) {
  const reps = m.replacements.slice(0, 4).map((r) => r.value);
  if (!(m.rule && m.rule.category && m.rule.category.id === 'TYPOS')) return reps[0];
  const o = orig.toLowerCase();
  return reps.map((v, i) => ({ v, i, d: dist(o, v.toLowerCase()) })).sort((a, b) => a.d - b.d || b.v.length - a.v.length || a.i - b.i)[0].v;
}

function apply(text, matches) {
  let out = text;
  const ok = matches.filter((m) => {
    if (!m.replacements || !m.replacements.length) return false;
    const cat = m.rule && m.rule.category && m.rule.category.id;
    if (!KEEP.has(cat)) return false;
    const orig = text.substr(m.offset, m.length);
    // A capitalised word mid-sentence is probably a name: leave it alone.
    if (cat === 'TYPOS' && /^[A-Z]/.test(orig) && !/(^|[.!?]\s+|\n\s*)$/.test(text.slice(0, m.offset))) return false;
    return true;
  }).sort((a, b) => b.offset - a.offset);
  let lastStart = Infinity;
  for (const m of ok) {
    if (m.offset + m.length > lastStart) continue; // skip overlapping fixes
    out = out.slice(0, m.offset) + pick(text.substr(m.offset, m.length), m) + out.slice(m.offset + m.length);
    lastStart = m.offset;
  }
  return out;
}

export async function correct(text) {
  let out = '';
  for (const c of chunks(text)) out += apply(c, await check(c));
  return out;
}

export function fixError(e) {
  switch (e && e.code) {
    case 'rate_limited': return 'The checker is busy. Wait a minute and try again.';
    case 'network': return 'Correcting needs an internet connection.';
    default: return 'Could not check that right now.';
  }
}
