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
function artTag(a){
  if (!a || !a.art) return '';
  const url = artUrls.get(a.art.rel);
  const ready = url && artReady.has(a.art.rel);
  // paresseuses: 134 affiches d'un coup pesaient 34 Mo au premier affichage sur telephone
  return '<img data-art="' + esc(a.key) + '" alt="" loading="lazy" decoding="async"' +

    (ready ? ' src="' + esc(url) + '" class="in" data-done="1"' : '') + '>';
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
    paintArt(img, a.art.rel, url);
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
