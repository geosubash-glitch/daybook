// Optional helpers that use Google Gemini with the user's own free key.
// Used for reading handwriting and for fixing spelling and grammar.
const SCAN_PROMPT = 'This is a photo of a handwritten (or printed) journal page. Transcribe the text exactly as it is written. ' +
  'Keep the original paragraph breaks and wording, including spelling. Do not summarize, translate, correct or add anything. ' +
  'Write [unclear] where a word cannot be read. Reply with only the transcription.';
const FIX_PROMPT = 'Fix only spelling mistakes, typos, capitalisation, punctuation and clear grammar errors in the journal text below. ' +
  'Keep the writer\'s own words, voice, slang, tone, line breaks and meaning exactly. Do not rephrase, improve the style, shorten, or add or remove anything. ' +
  'Leave names and any [unclear] marks as they are. Reply with only the corrected text and nothing else.\n\nText:\n';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

async function call(prefs, parts) {
  if (!prefs || !prefs.geminiKey) { const e = new Error('no key'); e.code = 'no_key'; throw e; }
  const model = prefs.model || DEFAULT_MODEL;
  let r;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': prefs.geminiKey },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0 } })
    });
  } catch (err) { const e = new Error('network'); e.code = 'network'; throw e; }
  if (!r.ok) {
    const e = new Error('ai ' + r.status);
    e.code = r.status === 429 ? 'rate_limited' : (r.status === 400 || r.status === 401 || r.status === 403) ? 'bad_key' : r.status === 404 ? 'bad_model' : 'error';
    throw e;
  }
  const j = await r.json();
  const c = j.candidates && j.candidates[0];
  const text = ((c && c.content && c.content.parts) || []).map((p) => p.text || '').join('');
  return { text, truncated: !!c && c.finishReason === 'MAX_TOKENS' };
}

export const transcribe = (prefs, base64, mime) => call(prefs, [{ text: SCAN_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }]);
export const correct = (prefs, text) => call(prefs, [{ text: FIX_PROMPT + text }]);

export function aiError(e) {
  switch (e && e.code) {
    case 'no_key': return 'Add your Gemini key in settings first.';
    case 'bad_key': return 'Google did not accept the Gemini key. Check it in settings.';
    case 'bad_model': return 'That Gemini model name was not found. Change it in settings.';
    case 'rate_limited': return 'Too many requests right now. Wait a minute.';
    case 'network': return 'Could not reach Google. Check your connection.';
    default: return 'Could not do that right now.';
  }
}

// Shrink a photo in the browser. Returns a data URL (JPEG).
export function shrink(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
