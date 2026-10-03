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

export async function makeJournalPdf(list, opts) {
  await loadLib();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('NR.ttf', await font('Newsreader_400Regular.ttf')); doc.addFont('NR.ttf', 'Newsreader', 'normal');
  doc.addFileToVFS('NRI.ttf', await font('Newsreader_400Regular_Italic.ttf')); doc.addFont('NRI.ttf', 'Newsreader', 'italic');
  doc.setProperties({ title: 'Daybook, ' + opts.label, creator: 'Daybook' });

  let half = 0, page = 0, y = MT, x0 = 0, first = true;
  const set = (size, style, color) => { doc.setFont('Newsreader', style || 'normal'); doc.setFontSize(size); doc.setTextColor.apply(doc, color || INK); };
  function footer() {
    if (page < 1) return;
    set(7.5, 'normal', SOFT); doc.text(String(page), x0 + A5W / 2, H - 10, { align: 'center' });
  }
  function newHalf(numbered) {
    if (!first) footer();
    if (first) first = false;
    else if (half === 1) { doc.addPage('a4', 'landscape'); half = 0; } else half = 1;
    x0 = half * A5W; y = MT;
    if (numbered) page++;
  }
  const room = (h) => y + h <= H - MB;

  // Cover page
  newHalf(false);
  set(9, 'normal', SOFT); doc.setCharSpace(1.2); doc.text('DAYBOOK', x0 + ML, 92); doc.setCharSpace(0);
  doc.setDrawColor.apply(doc, INK); doc.setLineWidth(0.25); doc.line(x0 + ML, 97, x0 + ML + 14, 97);
  set(22, 'normal'); const cl = doc.splitTextToSize(coverLabel(list), TW); doc.text(cl, x0 + ML, 110);
  set(10, 'italic', SOFT);
  doc.text(list.length + (list.length === 1 ? ' day' : ' days') + ' written', x0 + ML, 110 + (cl.length - 1) * 9 + 10);

  for (let i = 0; i < list.length; i++) {
    const e = list[i], p = dateParts(e.date);
    if (opts.onProgress) opts.onProgress(i + 1, list.length);
    newHalf(true);
    // Day heading
    set(8, 'normal', SOFT); doc.setCharSpace(0.9); doc.text(p.wd.toUpperCase(), x0 + ML, y); doc.setCharSpace(0);
    y += 9; set(21, 'normal'); doc.text(p.long, x0 + ML, y);
    y += 5; doc.setDrawColor.apply(doc, RULE); doc.setLineWidth(0.2); doc.line(x0 + ML, y, x0 + ML + TW, y);
    y += 9;
    if (e.title) { set(13, 'italic'); const tl = doc.splitTextToSize(clean(e.title), TW); doc.text(tl, x0 + ML, y); y += tl.length * 6 + 3; }
    // Body, paragraph by paragraph, flowing onto the next A5 page when full
    set(10.5, 'normal');
    const LH = 5.4;
    const paras = clean(e.body).split(/\n/);
    for (let k = 0; k < paras.length; k++) {
      const para = paras[k];
      if (!para.trim()) { y += LH * 0.6; continue; }
      const lines = doc.splitTextToSize(para, TW);
      for (const ln of lines) {
        if (!room(LH)) {
          newHalf(true);
          set(7.5, 'italic', SOFT); doc.text(p.long + ', continued', x0 + ML, y); y += 9; set(10.5, 'normal');
        }
        doc.text(ln, x0 + ML, y); y += LH;
      }
    }
    // Kept photographs of handwritten pages
    for (const id of (e.photos || [])) {
      const src = opts.photo ? await opts.photo(id) : null;
      if (!src) continue;
      let w = TW, h = 0;
      try { const pr = doc.getImageProperties(src); h = w * pr.height / pr.width; if (h > 120) { h = 120; w = h * pr.width / pr.height; } } catch (err) { continue; }
      y += 4;
      if (!room(h)) newHalf(true);
      try { doc.addImage(src, 'JPEG', x0 + ML, y, w, h, undefined, 'MEDIUM'); y += h + 2; } catch (err) {}
    }
  }
  footer();
  return doc;
}
