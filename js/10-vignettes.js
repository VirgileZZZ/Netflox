/* 10-vignettes.js
 *
 * Jaquettes et vignettes d'episodes.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ============================================== images & vignettes === */
const artUrls  = new Map();   // rel de l'image -> adresse (blob ou http)
const artReady = new Set();   // rel des jaquettes deja decodees par le navigateur

/**
 * Balise d'une jaquette. Si l'image a deja ete affichee une fois, sa source part
 * dans le HTML avec la classe d'apparition: changer d'onglet ne laisse plus voir
 * les initiales du fond pendant la frame ou l'image se rebranche.
 */
/* Par le partage, une affiche se demande reduite (400 px pour une vignette,
   1280 pour une grande image de fond): le serveur en fait une copie legere.
   Certaines pesaient 5 Mo pour 168 px affiches. En local, l'original. */
function urlAffiche(url, taille){
  if (!url || !taille || /^(blob|data|file):/.test(url) || !/^https?:$/.test(location.protocol)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'mini=' + taille;
}
function artTag(a, grand){
  if (!a || !a.art) return '';
  const url = artUrls.get(a.art.rel);
  const ready = url && artReady.has(a.art.rel);
  const taille = grand ? 1280 : 400;
  const mini = urlAffiche(url, taille);
  // deja chargee en entier une fois: directement la vraie
  const src = affichesPleines.has(url) ? url : mini;
  // paresseuses: 134 affiches d'un coup pesaient 34 Mo au premier affichage sur telephone
  const x = cadrageOf(a.key);
  return '<img data-art="' + esc(a.key) + '" data-mini="' + taille + '" alt="" loading="lazy" decoding="async"' +
    (x != null ? ' style="--ax:' + x + '%"' : '') +
    (ready ? ' src="' + esc(src) + '" class="in" data-done="1"' + (src !== url ? ' data-pleine="' + esc(url) + '"' : '') : '') + '>';
}
/* D'abord la copie legere (le premier affichage arrive vite), puis la vraie
 * affiche — mais seulement pour celles qu'on voit vraiment (a l'ecran ou
 * juste a cote), deux a la fois, et seulement apres le premier chargement:
 * sinon on retombait sur les 34 Mo d'un coup. La vraie est chargee a part
 * avant d'etre posee, l'echange ne clignote pas. */
const affichesPleines = new Set();          // url originales deja chargees en entier
const fileAffiches = [];
let affichesEnCours = 0, affichesPretes = false;
const veilleAffiches = ('IntersectionObserver' in window) ? new IntersectionObserver((entrees) => {
  for (const en of entrees){
    if (!en.isIntersecting) continue;
    veilleAffiches.unobserve(en.target);
    fileAffiches.push(en.target);
  }
  pomperAffiches();
}, { rootMargin: '300px' }) : null;
function pomperAffiches(){
  if (!affichesPretes) return;
  while (affichesEnCours < 2 && fileAffiches.length){
    const img = fileAffiches.shift(), pleine = img.dataset.pleine;
    if (!pleine || !img.isConnected || affichesPleines.has(pleine) && img.src === pleine) continue;
    affichesEnCours++;
    const pre = new Image();
    const fin = () => { affichesEnCours--; pomperAffiches(); };
    pre.onload = () => { affichesPleines.add(pleine); if (img.isConnected) img.src = pleine; fin(); };
    pre.onerror = fin;
    pre.src = pleine;
  }
}
function veillerAffiche(img){
  if (!img.dataset.pleine || img.dataset.veille || !veilleAffiches) return;
  img.dataset.veille = '1';
  veilleAffiches.observe(img);
}
function paintArt(img, rel, url){
  img.addEventListener('load',  () => { artReady.add(rel); img.classList.add('in'); }, { once:true });
  img.addEventListener('error', () => { artReady.delete(rel); artUrls.delete(rel); }, { once:true });
  img.src = url;
}

async function hydrate(){
  // jaquettes
  for (const img of $$('img[data-art]')){
    if (img.dataset.done) continue;
    img.dataset.done = '1';
    const a = S.byKey.get(img.dataset.art);
    if (!a || !a.art) continue;
    let url = artUrls.get(a.art.rel);
    if (!url){
      const src = await srcOf(a.art);
      if (!src) continue;
      url = src.url;
      artUrls.set(a.art.rel, url);
    }
    const mini = urlAffiche(url, +img.dataset.mini || 0);
    if (mini !== url && !affichesPleines.has(url)) img.dataset.pleine = url;
    paintArt(img, a.art.rel, affichesPleines.has(url) ? url : mini);
  }
  // la vraie affiche, plus tard, pour celles qu'on voit
  $$('img[data-pleine]').forEach(veillerAffiche);
  if (!affichesPretes && !hydrate.premier){
    hydrate.premier = true;
    setTimeout(() => { affichesPretes = true; pomperAffiches(); }, 2500);
  }
  // vignettes d'épisodes (paresseux)
  thumbObserver && $$('[data-thumb]').forEach(el => { if (!el.dataset.obs){ el.dataset.obs = '1'; thumbObserver.observe(el); } });
  hydrateCovers(document);          // couvertures de chapitres, y compris dans « Reprendre »
}

const thumbQueue = [];
let thumbBusy = 0;
const thumbObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries, obs) => {
  for (const en of entries){
    if (!en.isIntersecting) continue;
    obs.unobserve(en.target);
    queueThumb(en.target);
  }
}, { rootMargin:'250px' }) : null;

function queueThumb(el){
  const rel = el.dataset.thumb;
  const cached = store.get('th.' + rel, null);
  if (cached) return paintThumb(el, cached);
  const ep = findEp(rel);
  if (!ep || ep.play !== 'native') return;         // on ne sait pas décoder un .ts hors lecteur
  thumbQueue.push({ el, ep });
  pumpThumbs();
}
function paintThumb(el, url){
  if (el.querySelector('img[data-thumbimg]')) return;
  const img = document.createElement('img');
  img.dataset.thumbimg = '1';
  img.alt = '';
  img.addEventListener('load', () => img.classList.add('in'), { once:true });
  img.src = url;
  el.insertBefore(img, el.firstChild);
}
function pumpThumbs(){
  while (thumbBusy < 2 && thumbQueue.length){
    const job = thumbQueue.shift();
    thumbBusy++;
    makeThumb(job.ep).then(url => {
      if (url){ store.set('th.' + job.ep.rel, url); paintThumb(job.el, url); }
    }).catch(()=>{}).finally(() => { thumbBusy--; pumpThumbs(); });
  }
}
function makeThumb(ep){
  return new Promise(async (resolve) => {
    const src = await srcOf(ep);
    if (!src) return resolve(null);
    const url = src.url;
    const v = document.createElement('video');
    let done = false;
    const finish = (val) => { if (done) return; done = true; if (src.revoke) src.revoke(); v.removeAttribute('src'); v.load(); resolve(val); };
    const timer = setTimeout(() => finish(null), 12000);
    v.muted = true; v.preload = 'metadata'; v.playsInline = true;
    v.addEventListener('loadedmetadata', () => {
      const t = Math.min(Math.max(v.duration * 0.22, 8), Math.max(v.duration - 2, 1));
      const onSeek = () => {
        try {
          const c = document.createElement('canvas');
          const w = 320, h = Math.round(w * (v.videoHeight || 9) / (v.videoWidth || 16));
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(v, 0, 0, w, h);
          clearTimeout(timer);
          finish(c.toDataURL('image/jpeg', 0.62));
        } catch(e){ clearTimeout(timer); finish(null); }
      };
      v.addEventListener('seeked', onSeek, { once:true });
      try { v.currentTime = t; } catch(e){ clearTimeout(timer); finish(null); }
    }, { once:true });
    v.addEventListener('error', () => { clearTimeout(timer); finish(null); }, { once:true });
    v.src = url;
  });
}
