/* 12-lecteur-scans.js
 *
 * Le lecteur de scans, page par page.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ================================================ lecteur de scans === */
const SV = $('#scanview');
const svUrls = new Map();          // rel de page -> URL blob, fenêtre glissante
let svCtx = null, svPage = 0, svHideT = null, svObs = null;
let svZoom = 1, svOx = 0, svOy = 0;          // zoom et décalage de la page courante
const SV_MAX = 6, SV_MIN = 1;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Applique zoom et décalage à la page affichée, en la gardant dans le cadre. */
function applyZoom(){
  const img = $('#svStage .sv-page img');
  SV.classList.toggle('zoomed', svZoom > 1);
  $('#svLevel').textContent = Math.round(svZoom * 100) + ' %';
  if (scanMode() === 'scroll'){
    $('#svStage').style.setProperty('--svz', svZoom);
    return;
  }
  if (!img) return;
  if (svZoom <= 1){ svOx = svOy = 0; img.style.transform = ''; return; }
  clampPan(img);
  img.style.transform = 'translate(' + svOx + 'px,' + svOy + 'px) scale(' + svZoom + ')';
}
/** Position de la page sans aucune transformation: repère stable pour tout calculer.
    Déduire ce repère du rectangle transformé donnerait un décalage, car la
    transformation appliquée est encore celle du zoom précédent. */
function layoutRect(img){
  const prev = img.style.transform;
  img.style.transform = '';
  const r = img.getBoundingClientRect();
  img.style.transform = prev;
  return r;
}
/** Empêche la page de sortir du cadre: elle le couvre, ou reste centrée. */
function clampPan(img){
  const stage = $('#svStage').getBoundingClientRect();
  const L = layoutRect(img);
  const w = L.width * svZoom, h = L.height * svZoom;
  svOx = w >= stage.width
    ? clamp(svOx, stage.right - w - L.left, stage.left - L.left)
    : stage.left + (stage.width - w) / 2 - L.left;
  svOy = h >= stage.height
    ? clamp(svOy, stage.bottom - h - L.top, stage.top - L.top)
    : stage.top + (stage.height - h) / 2 - L.top;
}
/** Zoome en gardant sous le curseur le point de l'image qui s'y trouvait. */
function zoomAt(clientX, clientY, next){
  const target = clamp(next, SV_MIN, SV_MAX);
  if (scanMode() === 'scroll'){ svZoom = target; applyZoom(); return; }
  const img = $('#svStage .sv-page img');
  if (!img){ svZoom = target; return; }
  const r = img.getBoundingClientRect();      // ce qui est affiché maintenant
  const L = layoutRect(img);                  // le même sans transformation
  const fx = r.width  ? (clientX - r.left) / r.width  : 0.5;
  const fy = r.height ? (clientY - r.top)  / r.height : 0.5;
  svZoom = target;
  svOx = clientX - L.left - fx * L.width  * svZoom;
  svOy = clientY - L.top  - fy * L.height * svZoom;
  applyZoom();
}
function resetZoom(){ svZoom = 1; svOx = svOy = 0; applyZoom(); }
/** Palier suivant au clic: on monte jusqu'au maximum, puis retour à l'ajustement. */
function nextZoomStep(z){
  const steps = [1, 2, 3, 4.5, SV_MAX];
  const i = steps.findIndex(s => z < s - 0.01);
  return i < 0 ? 1 : steps[i];
}
/** Ce que déclenche un clic simple, selon sa position horizontale (0 à 1). */
function clickAction(x, dir){
  const edge = 0.22;
  if (x >= edge && x <= 1 - edge) return 'zoom';
  const forward = dir === 'ltr' ? x > 0.5 : x < 0.5;
  return forward ? 'next' : 'prev';
}
/** Vrai si la page déborde du cadre: la molette doit alors défiler, pas zoomer. */
function pageOverflows(){
  const stage = $('#svStage');
  return stage.scrollHeight > stage.clientHeight + 4;
}

/** URL d'une page, créée à la demande et gardée en mémoire tant qu'elle sert. */
async function pageUrl(img){
  if (svUrls.has(img.rel)) return svUrls.get(img.rel);
  const src = await srcOf(img);
  if (!src) return null;
  svUrls.set(img.rel, src.url);
  return src.url;
}
/** Libère les pages hors de la fenêtre courante: 3066 pages ne tiennent pas en mémoire. */
function trimPages(keep){
  for (const [rel, url] of svUrls){
    if (keep.has(rel)) continue;
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    svUrls.delete(rel);
  }
}

async function openScan(spec, startPage){
  const hit = findChapter(spec);
  if (!hit) return toast('Chapitre introuvable', 'bad');
  svCtx = hit;
  SV.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#svEnd').hidden = true;
  $('#svTitle').textContent = hit.c.title;
  $('#svSub').textContent = [hit.a.title, hit.g.label, fmtCount(hit.c.pages.length,'page','pages')].join(' · ');
  $('#svRange').max = hit.c.pages.length - 1;
  const pos = getScanPos(spec);
  const saved = startPage != null ? startPage : (pos ? pos.p : 0);
  svPage = Math.max(0, Math.min(hit.c.pages.length - 1, saved));
  paintScanMode();
  await renderScan();
  svPoke();
}
function scanMode(){ return store.get('svMode', 'page'); }
function scanFit(){ return store.get('svFit', 'height'); }
function scanDir(){ return store.get('svDir', 'ltr'); }
function paintScanMode(){
  $('#svMode').textContent = scanMode() === 'page' ? 'Page' : 'Défilement';
  $('#svFit').textContent  = scanFit()  === 'height' ? 'Hauteur' : 'Largeur';
  $('#svDir').textContent  = scanDir() === 'ltr' ? '→' : '←';
  SV.classList.toggle('fit-width', scanFit() === 'width');
  SV.classList.toggle('scroll-mode', scanMode() === 'scroll');
  $('#svPrev').hidden = $('#svNext').hidden = $('#svRange').hidden = scanMode() === 'scroll';
}

async function renderScan(){
  if (!svCtx) return;
  const stage = $('#svStage');
  if (svObs){ svObs.disconnect(); svObs = null; }

  if (scanMode() === 'scroll'){
    stage.innerHTML = svCtx.c.pages.map((p,i) =>
      '<div class="sv-slot" data-i="' + i + '"><span class="sv-num">' + (i+1) + '</span></div>').join('');
    // chargement au fil du défilement, et libération de ce qui s'éloigne
    svObs = new IntersectionObserver(async (entries) => {
      for (const en of entries){
        const i = +en.target.dataset.i;
        if (!en.isIntersecting) continue;
        svPage = i;
        paintScanCount();
        if (en.target.querySelector('img')) continue;
        const url = await pageUrl(svCtx.c.pages[i]);
        if (!url || !en.target.isConnected) continue;
        const im = document.createElement('img');
        im.src = url; im.alt = 'Page ' + (i+1);
        im.addEventListener('load', () => im.classList.add('in'), { once:true });
        en.target.appendChild(im);
      }
    }, { root: stage, rootMargin: '900px 0px' });
    $$('.sv-slot', stage).forEach(el => svObs.observe(el));
    applyZoom();
    requestAnimationFrame(() => {
      const target = stage.querySelector('[data-i="' + svPage + '"]');
      if (target) target.scrollIntoView({ block:'start' });
    });
  } else {
    const url = await pageUrl(svCtx.c.pages[svPage]);
    stage.innerHTML = '<div class="sv-page">' +
      (url ? '<img src="' + esc(url) + '" alt="Page ' + (svPage+1) + '">' : '<div class="rload">Page illisible</div>') +
      '</div>';
    const im = stage.querySelector('img');
    if (im) im.addEventListener('load', () => im.classList.add('in'), { once:true });
    svZoom = 1; svOx = svOy = 0;          // chaque page repart ajustee
    applyZoom();
    preloadAround();
  }
  paintScanCount();
  saveScanPos();
}
/** Garde en mémoire la page courante, deux avant, quatre après. */
async function preloadAround(){
  if (!svCtx) return;
  const pages = svCtx.c.pages;
  const keep = new Set();
  for (let i = svPage - 2; i <= svPage + 4; i++){
    if (i >= 0 && i < pages.length) keep.add(pages[i].rel);
  }
  trimPages(keep);
  for (let i = svPage + 1; i <= svPage + 4; i++){
    if (i >= 0 && i < pages.length){
      const u = await pageUrl(pages[i]);
      if (u){ const im = new Image(); im.src = u; }
    }
  }
}
function paintScanCount(){
  if (!svCtx) return;
  $('#svCount').textContent = (svPage + 1) + ' / ' + svCtx.c.pages.length;
  $('#svRange').value = svPage;
}
function saveScanPos(){
  if (svCtx) setScanPos(chapSpec(svCtx.a, svCtx.g, svCtx.c), svPage, svCtx.a.key);
}
async function goPage(delta){
  if (!svCtx) return;
  const next = svPage + delta;
  if (next < 0){ return prevChapter(); }
  if (next >= svCtx.c.pages.length){ return showScanEnd(); }
  svPage = next;
  $('#svEnd').hidden = true;
  if (scanMode() === 'scroll'){
    const el = $('#svStage').querySelector('[data-i="' + svPage + '"]');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
    paintScanCount(); saveScanPos();
  } else {
    await renderScan();
  }
  svPoke();
}
function siblingChapter(step){
  if (!svCtx) return null;
  const i = svCtx.index + step;
  return i >= 0 && i < svCtx.g.chapters.length ? svCtx.g.chapters[i] : null;
}
function prevChapter(){
  const c = siblingChapter(-1);
  if (!c) return toast('Premier chapitre');
  openScan(chapSpec(svCtx.a, svCtx.g, c), c.pages.length - 1);
}
function nextChapter(){
  const c = siblingChapter(1);
  if (!c) return toast('Dernier chapitre de la collection');
  openScan(chapSpec(svCtx.a, svCtx.g, c), 0);
}
function showScanEnd(){
  const next = siblingChapter(1);
  $('#svEnd').hidden = false;
  $('#svEnd').innerHTML = '<div class="sv-endbox">' +
    '<b>' + esc(svCtx.c.title) + ' terminé</b>' +
    (next ? '<p>' + esc(next.title) + ' t\'attend.</p>' +
            '<button class="btn btn-light" id="svGoNext">Chapitre suivant</button>'
          : '<p>C\'était le dernier chapitre de la collection.</p>') +
    '<button class="btn btn-ghost" id="svBack">Retour aux chapitres</button></div>';
  const g = $('#svGoNext'); if (g) g.addEventListener('click', nextChapter);
  $('#svBack').addEventListener('click', closeScan);
  store.set('sc.' + chapSpec(svCtx.a, svCtx.g, svCtx.c), svCtx.c.pages.length - 1);
}
function closeScan(){
  saveScanPos();
  flushProgress();
  if (svObs){ svObs.disconnect(); svObs = null; }
  trimPages(new Set());
  svCtx = null;
  SV.hidden = true;
  $('#svStage').innerHTML = '';
  document.body.style.overflow = '';
  render();
}
function svPoke(){
  SV.classList.remove('hide-ui');
  clearTimeout(svHideT);
  svHideT = setTimeout(() => SV.classList.add('hide-ui'), 2600);
}

$('#svClose').addEventListener('click', closeScan);
$('#svPrev').addEventListener('click', () => goPage(-1));
$('#svNext').addEventListener('click', () => goPage(1));
$('#svRange').addEventListener('input', async (ev) => {
  svPage = +ev.target.value;
  if (scanMode() === 'scroll'){
    const el = $('#svStage').querySelector('[data-i="' + svPage + '"]');
    if (el) el.scrollIntoView({ block:'start' });
    paintScanCount();
  } else await renderScan();
});
$('#svMode').addEventListener('click', async () => {
  store.set('svMode', scanMode() === 'page' ? 'scroll' : 'page');
  paintScanMode(); await renderScan(); svPoke();
});
$('#svFit').addEventListener('click', () => {
  store.set('svFit', scanFit() === 'height' ? 'width' : 'height');
  paintScanMode(); svPoke();
});
$('#svDir').addEventListener('click', () => {
  store.set('svDir', scanDir() === 'ltr' ? 'rtl' : 'ltr');
  paintScanMode();
  toast(scanDir() === 'ltr' ? 'Lecture de gauche à droite' : 'Lecture de droite à gauche (manga)');
  svPoke();
});
SV.addEventListener('mousemove', svPoke);
$('#svStage').addEventListener('scroll', () => { svPoke(); saveScanPos(); }, { passive:true });
/* Clic: les bords tournent la page, le centre zoome sur l'endroit visé.
   Un glissement déplace la page zoomée sans jamais tourner. */
let svDrag = null;
$('#svStage').addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || ev.target.closest('.sv-endbox')) return;
  svDrag = { x: ev.clientX, y: ev.clientY, ox: svOx, oy: svOy, moved: false, id: ev.pointerId };
});
$('#svStage').addEventListener('pointermove', (ev) => {
  if (!svDrag || svDrag.id !== ev.pointerId) return;
  const dx = ev.clientX - svDrag.x, dy = ev.clientY - svDrag.y;
  if (!svDrag.moved){
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    svDrag.moved = true;
    if (svZoom > 1 && scanMode() === 'page'){
      SV.classList.add('dragging');
      try { $('#svStage').setPointerCapture(ev.pointerId); } catch(e){}
    }
  }
  if (svZoom > 1 && scanMode() === 'page'){
    svOx = svDrag.ox + dx; svOy = svDrag.oy + dy;
    applyZoom();
  }
});
const svEndDrag = (ev) => {
  if (!svDrag) return;
  try { $('#svStage').releasePointerCapture(svDrag.id); } catch(e){}
  SV.classList.remove('dragging');
  const moved = svDrag.moved;
  svDrag = null;
  if (moved || scanMode() !== 'page' || (ev && ev.target && ev.target.closest('.sv-endbox'))) return;

  const action = clickAction((ev ? ev.clientX : 0) / innerWidth, scanDir());
  if (action === 'next' || action === 'prev'){
    goPage(action === 'next' ? 1 : -1);           // marche aussi quand la page est zoomée
    return;
  }
  zoomAt(ev.clientX, ev.clientY, nextZoomStep(svZoom));
  svPoke();
};
$('#svStage').addEventListener('pointerup', svEndDrag);
$('#svStage').addEventListener('pointercancel', () => { svDrag = null; SV.classList.remove('dragging'); });
$('#svStage').addEventListener('dblclick', (ev) => { ev.preventDefault(); resetZoom(); });

/**
 * Molette, par ordre de priorité:
 *   Ctrl (ou ⌘)          -> zoome, toujours
 *   page zoomée          -> déplace la vue, car le zoom est une transformation:
 *                           la mise en page n'a pas grandi, le navigateur n'a
 *                           rien à faire défiler de lui-même
 *   page qui déborde     -> on laisse le défilement natif faire son travail
 *   page entière visible -> rien à défiler, la molette sert donc à zoomer
 */
function onScanWheel(ev){
  const step = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
  const dy = ev.deltaY * step, dx = ev.deltaX * step;

  if (ev.ctrlKey || ev.metaKey){
    ev.preventDefault();
    zoomAt(ev.clientX, ev.clientY, svZoom * (dy < 0 ? 1.18 : 1 / 1.18));
    svPoke();
    return 'zoom';
  }
  if (svZoom > 1 && scanMode() === 'page'){
    ev.preventDefault();
    if (ev.shiftKey) svOx -= dy;          // molette horizontale au clavier
    else { svOx -= dx; svOy -= dy; }
    applyZoom();
    svPoke();
    return 'pan';
  }
  if (scanMode() === 'scroll' || pageOverflows()) return 'scroll';
  ev.preventDefault();
  zoomAt(ev.clientX, ev.clientY, svZoom * (dy < 0 ? 1.18 : 1 / 1.18));
  svPoke();
  return 'zoom';
}
$('#svStage').addEventListener('wheel', onScanWheel, { passive:false });

$('#svIn').addEventListener('click', () => { zoomAt(innerWidth/2, innerHeight/2, svZoom * 1.35); svPoke(); });
$('#svOut').addEventListener('click', () => { zoomAt(innerWidth/2, innerHeight/2, svZoom / 1.35); svPoke(); });
$('#svLevel').addEventListener('click', () => { resetZoom(); svPoke(); });
addEventListener('resize', () => { if (!SV.hidden && svZoom > 1) applyZoom(); });
addEventListener('keydown', (ev) => {
  if (SV.hidden || ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.matches('input,textarea,select')) return;

  const k = ev.key;
  if (k === 'Escape'){ closeScan(); return; }
  const fwd = scanDir() === 'ltr' ? 'ArrowRight' : 'ArrowLeft';
  const bwd = scanDir() === 'ltr' ? 'ArrowLeft' : 'ArrowRight';
  if (k === fwd || k === ' ' || k === 'PageDown'){ ev.preventDefault(); goPage(1); }
  else if (k === bwd || k === 'PageUp'){ ev.preventDefault(); goPage(-1); }
  else if (k === 'n'){ nextChapter(); }
  else if (k === 'p'){ prevChapter(); }
  else if (k === '+' || k === '='){ zoomAt(innerWidth/2, innerHeight/2, svZoom * 1.35); }
  else if (k === '-'){ zoomAt(innerWidth/2, innerHeight/2, svZoom / 1.35); }
  else if (k === '0'){ resetZoom(); }
  svPoke();
});

/** Couvertures de chapitres: première page, chargée à l'approche. */
const coverObs = ('IntersectionObserver' in window) ? new IntersectionObserver(async (entries, obs) => {
  for (const en of entries){
    if (!en.isIntersecting) continue;
    obs.unobserve(en.target);
    const hit = findChapter(en.target.dataset.cover);
    if (!hit || !hit.c.pages.length) continue;
    const src = await srcOf(hit.c.pages[0]);
    if (!src) continue;
    en.target.src = src.url;
    en.target.addEventListener('load', () => en.target.classList.add('in'), { once:true });
  }
}, { rootMargin:'400px' }) : null;
function hydrateCovers(root){
  if (!coverObs) return;
  $$('img[data-cover]', root).forEach(im => { if (!im.dataset.obs){ im.dataset.obs = '1'; coverObs.observe(im); } });
}
