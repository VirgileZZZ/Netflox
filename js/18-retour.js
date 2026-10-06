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

let reculEnCours = false;                  // nous avons recule: le popstate qui vient est le notre
let retourEnCours = false;                 // l'utilisateur a recule: on ferme, sans resynchroniser
function synchroniser(){
  if (reculEnCours || retourEnCours) return;
  const v = profondeurVoulue(), c = profondeur();
  try {
    if (v > c){ for (let d = c + 1; d <= v; d++) history.pushState({ netflox: d }, ''); }
    else if (v < c){ reculEnCours = true; history.go(v - c); }
  } catch(e){ reculEnCours = false; }
}

const veilleCalques = new MutationObserver(() => synchroniser());
CALQUES.forEach(s => { const el = $(s); if (el) veilleCalques.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
const _render = window.render;
window.render = function(...args){
  const r = _render.apply(this, args);
  synchroniser();
  return r;
};

addEventListener('popstate', () => {
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
