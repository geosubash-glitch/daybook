// Makes the printable journal as a real PDF file, inside the app.
// A4 landscape sheets, each split into two A5 pages. Every day starts on a fresh A5 page.
// No browser print window, so nothing like a web address or page title is added to the pages.

const A5W = 148.5, H = 210;                 // one half of a landscape A4 sheet, in mm
const ML = 17, MR = 17, MT = 20, MB = 20;   // margins inside each A5 page
const TW = A5W - ML - MR;                   // text width
const INK = [20, 20, 20], SOFT = [120, 118, 112], RULE = [205, 203, 196];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

let libReady = null;
function loadLib() {
  if (window.jspdf) return Promise.resolve();
  if (!libReady) libReady = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js';
    s.onload = () => res(); s.onerror = () => { libReady = null; rej(new Error('pdf library')); };
    document.head.appendChild(s);
  });
  return libReady;
}
const fontCache = {};
async function font(file) {
  if (!fontCache[file]) {
    const buf = new Uint8Array(await (await fetch('fonts/' + file)).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    fontCache[file] = btoa(s);
  }
  return fontCache[file];
}
const dateParts = (k) => { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); return { wd: DAYS[dt.getDay()], long: d + ' ' + MONTHS[m - 1] + ' ' + y }; };
// Characters the font cannot draw would come out as blanks or boxes; swap the common ones.
const clean = (t) => String(t || '').replace(/\r/g, '').replace(/\t/g, '    ').replace(/[​-‍﻿]/g, '');

// "4 October 2026", "October 2026", "March to October 2026", or "March 2024 to October 2026"
function coverLabel(list) {
  if (!list.length) return '';
  const a = list[0].date, b = list[list.length - 1].date;
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  if (a === b) return dateParts(a).long;
  if (ay === by && am === bm) return MONTHS[am - 1] + ' ' + ay;
  if (ay === by) return MONTHS[am - 1] + ' to ' + MONTHS[bm - 1] + ' ' + ay;
  return MONTHS[am - 1] + ' ' + ay + ' to ' + MONTHS[bm - 1] + ' ' + by;
}

// Lays the journal out as a list of A5 pages first, then places them on A4 sheets.
//   mode 'sheets':  pages in reading order, two per sheet side, one side only. Cut down the middle.
//   mode 'booklet': pages arranged for double-sided printing so the stack folds into a book.
//                   Long journals are split into booklets of up to 8 sheets (32 pages) each,
//                   which are folded one by one and stacked in order.
export async function makeJournalPdf(list, opts) {
  await loadLib();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('NR.ttf', await font('Newsreader_400Regular.ttf')); doc.addFont('NR.ttf', 'Newsreader', 'normal');
  doc.addFileToVFS('NRI.ttf', await font('Newsreader_400Regular_Italic.ttf')); doc.addFont('NRI.ttf', 'Newsreader', 'italic');
  doc.setProperties({ title: 'Daybook, ' + coverLabel(list), creator: 'Daybook' });
  const booklet = opts.mode === 'booklet';

  // ---- 1. layout: each page is a list of drawing steps, drawn later at the right spot ----
  const pages = []; let cur = null, y = MT, num = 0;
  const set = (size, style, color) => { doc.setFont('Newsreader', style || 'normal'); doc.setFontSize(size); doc.setTextColor.apply(doc, color || INK); };
  const op = (f) => cur.ops.push(f);
  const text = (t, x, yy, size, style, color, extra) => op((d, x0) => { set(size, style, color); if (extra && extra.cs) d.setCharSpace(extra.cs); d.text(t, x0 + x, yy, extra && extra.align ? { align: extra.align } : undefined); if (extra && extra.cs) d.setCharSpace(0); });
  const line = (x1, yy, x2, color, w) => op((d, x0) => { d.setDrawColor.apply(d, color); d.setLineWidth(w); d.line(x0 + x1, yy, x0 + x2, yy); });
  function newPage(numbered) { cur = { ops: [], n: numbered ? ++num : 0 }; pages.push(cur); y = MT; }
  const room = (h) => y + h <= H - MB;

  newPage(false);                                   // cover
  text('DAYBOOK', ML, 92, 9, 'normal', SOFT, { cs: 1.2 });
  line(ML, 97, ML + 14, INK, 0.25);
  set(22, 'normal'); const cl = doc.splitTextToSize(coverLabel(list), TW);
  text(cl, ML, 110, 22, 'normal');
  text(list.length + (list.length === 1 ? ' day' : ' days') + ' written', ML, 110 + (cl.length - 1) * 9 + 10, 10, 'italic', SOFT);
  if (booklet) newPage(false);                      // inside of the cover stays blank

  for (let i = 0; i < list.length; i++) {
    const e = list[i], p = dateParts(e.date);
    if (opts.onProgress) opts.onProgress(i + 1, list.length);
    newPage(true);
    text(p.wd.toUpperCase(), ML, y, 8, 'normal', SOFT, { cs: 0.9 });
    y += 9; text(p.long, ML, y, 21, 'normal');
    y += 5; line(ML, y, ML + TW, RULE, 0.2);
    y += 9;
    if (e.title) { set(13, 'italic'); const tl = doc.splitTextToSize(clean(e.title), TW); text(tl, ML, y, 13, 'italic'); y += tl.length * 6 + 3; }
    const LH = 5.4; set(10.5, 'normal');
    for (const para of clean(e.body).split(/\n/)) {
      if (!para.trim()) { y += LH * 0.6; continue; }
      set(10.5, 'normal');
      for (const ln of doc.splitTextToSize(para, TW)) {
        if (!room(LH)) { newPage(true); text(p.long + ', continued', ML, y, 7.5, 'italic', SOFT); y += 9; }
        text(ln, ML, y, 10.5, 'normal'); y += LH;
      }
    }
    for (const id of (e.photos || [])) {
      const src = opts.photo ? await opts.photo(id) : null;
      if (!src) continue;
      let w = TW, h = 0;
      try { const pr = doc.getImageProperties(src); h = w * pr.height / pr.width; if (h > 120) { h = 120; w = h * pr.width / pr.height; } } catch (err) { continue; }
      y += 4; if (!room(h)) newPage(true);
      const yy = y; op((d, x0) => { try { d.addImage(src, 'JPEG', x0 + ML, yy, w, h, undefined, 'MEDIUM'); } catch (err) {} });
      y += h + 2;
    }
  }

  // ---- 2. place the pages on sheets ----
  const blank = { ops: [], n: 0 };
  const draw = (pg, half) => { pg.ops.forEach((f) => f(doc, half * A5W)); if (pg.n) { set(7.5, 'normal', SOFT); doc.text(String(pg.n), half * A5W + A5W / 2, H - 10, { align: 'center' }); } };
  const sides = [];                                  // each side of paper: [left page, right page]
  if (!booklet) {
    for (let i = 0; i < pages.length; i += 2) sides.push([pages[i], pages[i + 1] || blank]);
  } else {
    const PER = 32;                                  // pages per folded booklet (8 sheets)
    for (let s0 = 0; s0 < pages.length; s0 += PER) {
      const part = pages.slice(s0, s0 + PER);
      while (part.length % 4) part.push(blank);
      const n = part.length;
      for (let k = 0; k < n / 4; k++) {
        sides.push([part[n - 1 - 2 * k], part[2 * k]]);         // front of sheet k
        sides.push([part[2 * k + 1], part[n - 2 - 2 * k]]);     // back of sheet k
      }
    }
  }
  sides.forEach((sd, i) => { if (i) doc.addPage('a4', 'landscape'); draw(sd[0], 0); draw(sd[1], 1); });
  doc.__info = { pages: pages.length, sheets: booklet ? sides.length / 2 : sides.length, booklets: booklet ? Math.ceil(pages.length / 32) : 0 };
  return doc;
}
