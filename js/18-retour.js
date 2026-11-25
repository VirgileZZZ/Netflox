/* 18-retour.js
 *
 * Le bouton retour — celui du navigateur, et surtout celui du telephone.
 * Sans lui, il quittait le site: on ouvrait un episode, on faisait retour,
 * et l'on se retrouvait hors de Netflox.
 *
 * L'historique suit une profondeur, calculee a chaque changement: 0 a
 * l'accueil, 1 sur une fiche (ou une liste, une recherche), +1 quand un ecran
 * est ouvert par-dessus (lecteur, fil d'edits, scans, document). Quand elle
 * monte, on pose une marque; quand elle descend — par la croix, Echap, la fin
 * de la serie, peu importe — on recule d'autant. Les premieres versions
 * enveloppaient les fonctions d'ouverture: les croix appelaient les
 * originales et laissaient des marques orphelines (jusqu'a onze retours pour
 * sortir). Ici rien ne s'empile: l'historique colle a ce qui est ouvert.
 *
 * Charge par index.html, en dernier.
 */
"use strict";
/* ===================================================== retour ===== */
const CALQUES = ['#player', '#edits', '#scanview', '#reader'];
function unCalqueOuvert(){ return CALQUES.some(s => { const el = $(s); return el && !el.hidden; }); }
function profondeurVoulue(){
  return ((S.view !== 'home' || S.query) && S.animes.length ? 1 : 0) + (unCalqueOuvert() ? 1 : 0);
}
function profondeur(){ return (history.state && history.state.netflox) || 0; }

/* ------------------------------------------------------ l'adresse -----
 * L'adresse dit ou l'on est, apres le # — le seul morceau qu'on peut changer
 * aussi en ouvrant index.html directement (file://), et que le serveur ne
 * voit jamais:
 *   #/mushoku-tensei                  la fiche
 *   #/mushoku-tensei/saison1/3        l'episode, dans le lecteur
 *   #/mushoku-tensei/saison1/3/infos  la page de l'episode
 *   #/edits  #/edits/mushoku-tensei  #/edits/mushoku-tensei/saison1/3
 *   #/series  #/tout  #/lectures  #/lectures/la-serie  #/recherche/texte
 * Collee dans un autre onglet, ou apres F5, elle rouvre le meme endroit. */
function slugDe(t){
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
let slugsDe = null, slugsPour = null;      // recalcules quand la bibliotheque change
function slugs(){
  if (slugsPour !== S.animes){
    slugsPour = S.animes;
    slugsDe = new Map();
    const pris = new Map();
    for (const a of S.animes){ const s = slugDe(a.title); pris.set(s, (pris.get(s) || 0) + 1); }
    // deux series au meme titre: chacune garde le nom de son dossier
    for (const a of S.animes){
      const s = slugDe(a.title);
      slugsDe.set(a.key, s && pris.get(s) === 1 ? s : slugDe(a.key) || encodeURIComponent(a.key));
    }
  }
  return slugsDe;
}
function serieDuSlug(s){
  if (!s) return null;
  for (const [key, sl] of slugs()) if (sl === s) return S.byKey.get(key);
  return S.byKey.get(s) || S.animes.find(a => slugDe(a.key) === s) || null;
}
function numeroDans(e, a){
  if (e.ep != null) return String(e.ep);
  const sa = a.seasons.get(e.seasonKey);
  return String(sa ? sa.eps.indexOf(e) + 1 : e.idx + 1);
}
function routeEpisode(e){
  const a = e && S.byKey.get(e.anime);
  if (!a) return '';
  return '#/' + slugs().get(a.key) + '/' + (slugDe(e.seasonKey) || 'episodes') + '/' + numeroDans(e, a);
}
function episodeDe(a, saison, num){
  if (!a) return null;
  return a.episodes.find(e => (slugDe(e.seasonKey) || 'episodes') === saison && numeroDans(e, a) === num) || null;
}

function routeActuelle(){
  if (!$('#player').hidden && S.current) return routeEpisode(S.current);
  if (!$('#edits').hidden && typeof edCtx !== 'undefined' && edCtx){
    if (edCtx.epRel) return '#/edits' + routeEpisode(findEp(edCtx.epRel)).slice(1);
    if (edCtx.serie && S.byKey.get(edCtx.serie)) return '#/edits/' + slugs().get(edCtx.serie);
    return '#/edits';
  }
  if (!S.animes.length) return '';
  if (S.query) return '#/recherche/' + encodeURIComponent(S.query);
  switch (S.view){
    case 'home':  return '';
    case 'anime': return S.byKey.get(S.animeKey) ? '#/' + slugs().get(S.animeKey) : '';
    case 'docs':  return '#/lectures' + (S.docKey && S.byKey.get(S.docKey) ? '/' + slugs().get(S.docKey) : '');
    case 'episode': { const r = routeEpisode(findEp(S.epRel)); return r ? r + '/infos' : ''; }
    case 'all':   return '#/series';
    default:      return '#/' + encodeURIComponent(S.view);
  }
}
function adresse(route){ return location.pathname + location.search + route; }

/** Rouvre l'endroit qu'une adresse designe. Faux si elle ne mene nulle part. */
function appliquerRoute(hash){
  let p;
  try { p = decodeURIComponent(String(hash || '').replace(/^#\/?/, '')).split('/').filter(Boolean); }
  catch(e){ return false; }
  const vue = (v, extra) => {
    S.query = ''; $('#q').value = '';
    S.view = v; Object.assign(S, extra || {});
    render(); scrollTo(0, 0);
  };
  if (!p.length){ vue('home'); return true; }
  const [t, s, n, quoi] = p;
  if (t === 'edits'){
    const a = serieDuSlug(s);
    if (a && n){ const e = episodeDe(a, n, quoi); if (e){ vue('anime', { animeKey: a.key, seasonKey: null }); openEditsEpisode(e.rel); return true; } }
    if (a){ vue('anime', { animeKey: a.key, seasonKey: null }); openEdits(a.key); return true; }
    vue('home'); openEditsTous(); return true;
  }
  if (t === 'recherche'){ vue('home'); S.query = s || ''; $('#q').value = S.query; render(); return true; }
  if (t === 'series'){ vue('all'); return true; }
  if (t === 'tout'){ vue('tout'); return true; }
  if (t === 'lectures'){ const a = serieDuSlug(s); vue('docs', { docKey: a ? a.key : null }); return true; }
  const a = serieDuSlug(t);
  if (!a) return false;
  const e = s && n ? episodeDe(a, s, n) : null;
  if (e && quoi === 'infos'){ vue('episode', { epRel: e.rel }); return true; }
  vue('anime', { animeKey: a.key, seasonKey: null });
  if (e) openPlayer(e);
  return true;
}

let reculEnCours = false;                  // nous avons recule: le popstate qui vient est le notre
let retourEnCours = false;                 // l'utilisateur a recule: on ferme, sans resynchroniser
let routeAttente = location.hash;          // l'adresse d'arrivee, appliquee une fois la bibliotheque lue
let routePrete = false;
function synchroniser(){
  if (reculEnCours || retourEnCours || !routePrete) return;
  const v = profondeurVoulue(), c = profondeur(), url = adresse(routeActuelle());
  try {
    if (v > c){ for (let d = c + 1; d <= v; d++) history.pushState({ netflox: d }, '', url); }
    else if (v < c){ reculEnCours = true; history.go(v - c); }
    else if (location.pathname + location.search + location.hash !== url || !history.state){
      history.replaceState({ netflox: c }, '', url);   // une fiche a l'autre: meme profondeur, autre adresse
    }
  } catch(e){ reculEnCours = false; }
}
/* La premiere lecture de la bibliotheque: l'entree d'arrivee devient
   l'accueil, puis l'adresse demandee s'ouvre par-dessus — retour ramene a
   l'accueil, pas hors du site. */
const _afterScan = window.afterScan;
window.afterScan = function(...args){
  const premiere = !routePrete;
  if (premiere){ routePrete = true; retourEnCours = true; }
  let r;
  try { r = _afterScan.apply(this, args); }
  finally { if (premiere) retourEnCours = false; }
  if (premiere && S.animes.length){
    try { history.replaceState({ netflox: 0 }, '', adresse('')); } catch(e){}
    if (!(routeAttente && appliquerRoute(routeAttente))) synchroniser();
  }
  return r;
};

const veilleCalques = new MutationObserver(() => synchroniser());
CALQUES.forEach(s => { const el = $(s); if (el) veilleCalques.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
const _render = window.render;
window.render = function(...args){
  const r = _render.apply(this, args);
  synchroniser();
  return r;
};

addEventListener('popstate', () => {
  // une adresse tapee ou collee dans la barre: une entree sans marque
  if (!history.state && !reculEnCours){
    if (!routePrete){ routeAttente = location.hash; return; }
    retourEnCours = true;
    try {
      if (!$('#player').hidden) closePlayer();
      if (!$('#edits').hidden) closeEdits();
      if (!$('#scanview').hidden) closeScan();
      if (!$('#reader').hidden) closeReader();
      if (!appliquerRoute(location.hash)) appliquerRoute('');
    } finally {
      setTimeout(() => {
        retourEnCours = false;
        try { history.replaceState({ netflox: profondeurVoulue() }, '', adresse(routeActuelle())); } catch(e){}
      }, 0);
    }
    return;
  }
  if (reculEnCours){
    // fin de notre propre recul: entre-temps, un ecran a pu se rouvrir
    reculEnCours = false;
    synchroniser();
    return;
  }
  retourEnCours = true;
  try {
    // du plus haut au plus bas: un menu, un panneau, un ecran, puis la vue
    if (typeof CTX !== 'undefined' && !CTX.hidden) fermerCtx();
    else if (['#comptePanel', '#reglagesPanel'].some(id => { const p = $(id); return p && !p.hidden && (p.hidden = true); })){}
    else if (!$('#player').hidden) closePlayer();
    else if (!$('#edits').hidden) closeEdits();
    else if (!$('#scanview').hidden) closeScan();
    else if (!$('#reader').hidden) closeReader();
    else if (S.view !== 'home' || S.query){
      S.view = 'home'; S.query = ''; const q = $('#q'); if (q) q.value = '';
      _render(); scrollTo(0, 0);
    }
  } finally {
    // les observateurs passent apres ce gestionnaire: on les laisse passer, puis on recale
    setTimeout(() => { retourEnCours = false; synchroniser(); }, 0);
  }
});
