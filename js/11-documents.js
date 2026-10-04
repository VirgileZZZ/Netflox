/* 11-documents.js
 *
 * Les documents: PDF, EPUB, CBZ, textes.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ==================================================== documents ====== */
/* Rendu Markdown minimal: on échappe d'abord, on transforme ensuite —
   aucun HTML du fichier n'est interprété. */
/** Seuls les liens web ou relatifs sont conservés: pas de javascript:, data:, etc. */
function safeHref(h){
  return /^(https?:\/\/|mailto:|#|\/)/i.test(h) || !h.includes(':');
}
function inlineMd(s){
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, txt, href) =>
      safeHref(href) ? '<a href="' + href + '" target="_blank" rel="noopener">' + txt + '</a>' : txt)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
}
function renderMarkdown(src){
  const lines = esc(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], quote = [], list = null, fence = null;
  const flushPara = () => { if (para.length){ out.push('<p>' + inlineMd(para.join(' ')) + '</p>'); para = []; } };
  const flushQuote = () => { if (quote.length){ out.push('<blockquote>' + inlineMd(quote.join(' ')) + '</blockquote>'); quote = []; } };
  const flushList  = () => { if (list){ out.push('<' + list.tag + '>' + list.items.map(i => '<li>' + inlineMd(i) + '</li>').join('') + '</' + list.tag + '>'); list = null; } };
  const flushAll   = () => { flushPara(); flushQuote(); flushList(); };

  for (const raw of lines){
    const line = raw.replace(/\s+$/, '');
    if (fence !== null){
      if (/^\s*```/.test(line)){ out.push('<pre><code>' + fence.join('\n') + '</code></pre>'); fence = null; }
      else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)){ flushAll(); fence = []; continue; }
    if (!line.trim()){ flushAll(); continue; }

    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m){ flushAll(); const h = m[1].length; out.push('<h' + h + '>' + inlineMd(m[2]) + '</h' + h + '>'); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)){ flushAll(); out.push('<hr>'); continue; }
    m = line.match(/^\s*&gt;\s?(.*)$/);
    if (m){ flushPara(); flushList(); quote.push(m[1]); continue; }
    m = line.match(/^\s*[-*+]\s+(.*)$/);
    if (m){ flushPara(); flushQuote(); if (!list || list.tag !== 'ul') { flushList(); list = { tag:'ul', items:[] }; } list.items.push(m[1]); continue; }
    m = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m){ flushPara(); flushQuote(); if (!list || list.tag !== 'ol') { flushList(); list = { tag:'ol', items:[] }; } list.items.push(m[1]); continue; }
    flushQuote(); flushList();
    para.push(line.trim());
  }
  flushAll();
  if (fence) out.push('<pre><code>' + fence.join('\n') + '</code></pre>');
  return out.join('\n');
}

function findDoc(rel){
  for (const a of S.animes) for (const d of a.docs) if (d.rel === rel) return { doc: d, anime: a };
  return null;
}
const R = $('#reader');
let readerSrc = null, readerDoc = null, readerSaveT = null;

async function openDoc(rel){
  const hit = findDoc(rel);
  if (!hit) return toast('Fichier introuvable', 'bad');
  const { doc, anime } = hit;
  closeReaderSource();
  readerDoc = doc;
  R.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#rTitle').textContent = doc.vol != null ? 'Volume ' + doc.vol : doc.title;
  $('#rSub').textContent = [anime.title, doc.ext.toUpperCase(), fmtSize(doc.size)].join(' · ');
  $('#rBody').innerHTML = '<div class="rload"><div class="spinner"></div>Ouverture…</div>';
  $('#rToc').hidden = true;
  $('#rTocBtn').hidden = true;
  $('#rSize').hidden = doc.ext !== 'md' && doc.ext !== 'txt';
  buildFormatSwitch(anime, doc);

  const src = await srcOf(doc);
  if (!src) { $('#rBody').innerHTML = '<div class="rload">Fichier illisible.</div>'; return; }
  readerSrc = src;

  if (doc.ext === 'md' || doc.ext === 'txt'){
    let text = '';
    try {
      const file = await fileOf(doc);
      text = file ? await file.text() : await (await fetch(src.url)).text();
    } catch(e){
      $('#rBody').innerHTML = '<div class="rload">Lecture impossible : ' + esc(e.message) + '</div>';
      return;
    }
    if (readerDoc !== doc) return;
    const html = doc.ext === 'md' ? renderMarkdown(text) : '<pre>' + esc(text) + '</pre>';
    $('#rBody').innerHTML = '<article class="prose" id="rProse">' + html + '</article>';
    applyReaderSize();
    buildToc();
    restoreReadPos(doc);
  } else {
    $('#rBody').innerHTML = '<iframe class="rframe" src="' + esc(src.url) + '#view=FitH" title="Document"></iframe>';
  }
}
function buildFormatSwitch(anime, doc){
  const g = anime.docGroups.find(x => x.key === doc.group);
  const box = $('#rFmt');
  if (!g || g.formats.length < 2 || doc.vol == null){ box.innerHTML = ''; return; }
  const vol = g.volumes.find(v => v.vol === doc.vol);
  box.innerHTML = g.formats.map(e => {
    const alt = vol && vol.byExt[e];
    if (!alt) return '';
    return '<button data-swap="' + esc(alt.rel) + '"' + (e === doc.ext ? ' class="on"' : '') + '>' + esc(e.toUpperCase()) + '</button>';
  }).join('');
  $$('[data-swap]', box).forEach(b => b.addEventListener('click', () => {
    store.set('fmt.' + anime.key + '.' + g.key, extOf(b.dataset.swap));
    openDoc(b.dataset.swap);
  }));
}
function buildToc(){
  const heads = $$('#rProse h1,#rProse h2,#rProse h3');
  if (heads.length < 3) return;
  heads.forEach((h,i) => { h.id = 'h' + i; });
  $('#rToc').innerHTML = '<h4>Chapitres</h4>' + heads.map((h,i) =>
    '<button data-toc="h' + i + '" class="lvl' + h.tagName[1] + '">' + esc(h.textContent) + '</button>').join('');
  $('#rTocBtn').hidden = false;
  $$('[data-toc]', $('#rToc')).forEach(b => b.addEventListener('click', () => {
    const el = document.getElementById(b.dataset.toc);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
    $('#rToc').hidden = true;
  }));
}
const R_SIZES = [17, 19, 21, 23];
function applyReaderSize(){
  const i = Math.min(R_SIZES.length - 1, Math.max(0, store.get('rsize', 1)));
  const p = $('#rProse');
  if (p) p.style.fontSize = R_SIZES[i] + 'px';
}
function restoreReadPos(doc){
  const saved = getReadPos(doc.rel);
  const pos = saved ? saved.p : 0;
  const body = $('#rBody');
  requestAnimationFrame(() => {
    body.style.scrollBehavior = 'auto';          // pas d'animation au retour dans un tome
    body.scrollTop = pos * (body.scrollHeight - body.clientHeight);
    body.style.scrollBehavior = '';
    paintReadBar();
  });
}
function paintReadBar(){
  const body = $('#rBody');
  const max = body.scrollHeight - body.clientHeight;
  const pct = max > 0 ? body.scrollTop / max : 0;
  $('#rBar').style.width = (pct * 100) + '%';
  $('#rPct').textContent = Math.round(pct * 100) + ' %';
  if (readerDoc && !readerSaveT){
    readerSaveT = setTimeout(() => { readerSaveT = null; if (readerDoc) setReadPos(readerDoc.rel, pct); }, 700);
  }
}
function closeReaderSource(){
  if (readerSrc && readerSrc.revoke){ try { readerSrc.revoke(); } catch(e){} }
  readerSrc = null;
}
function closeReader(){
  if (readerDoc){
    const body = $('#rBody');
    const max = body.scrollHeight - body.clientHeight;
    if (max > 0) setReadPos(readerDoc.rel, body.scrollTop / max);
  }
  readerDoc = null;
  closeReaderSource();
  flushProgress();
  R.hidden = true;
  $('#rBody').innerHTML = '';
  document.body.style.overflow = '';
}
$('#rClose').addEventListener('click', closeReader);
$('#rBody').addEventListener('scroll', paintReadBar, { passive:true });
$('#rTocBtn').addEventListener('click', () => { $('#rToc').hidden = !$('#rToc').hidden; });
$('#rSize').addEventListener('click', () => {
  store.set('rsize', (store.get('rsize', 1) + 1) % R_SIZES.length);
  applyReaderSize();
});
$('#rOpen').addEventListener('click', () => {
  if (readerSrc) window.open(readerSrc.url, '_blank');
});
addEventListener('keydown', (ev) => {
  if (R.hidden || ev.target.matches('input,textarea')) return;
  if (ev.key === 'Escape'){ closeReader(); return; }
  const body = $('#rBody');
  if (ev.key === 'PageDown' || ev.key === ' '){ ev.preventDefault(); body.scrollBy({ top: body.clientHeight * 0.9, behavior:'smooth' }); }
  if (ev.key === 'PageUp'){ ev.preventDefault(); body.scrollBy({ top: -body.clientHeight * 0.9, behavior:'smooth' }); }
});
