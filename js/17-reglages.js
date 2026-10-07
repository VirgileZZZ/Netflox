/* 17-reglages.js
 *
 * Les parametres: un bouton en haut a droite, un panneau, des interrupteurs.
 * Pour commencer, l'anti-spoiler de la page d'une serie — desactive par
 * defaut, chacun l'allume s'il veut:
 *   - flouter legerement les miniatures des episodes pas encore vus: on
 *     devine l'image sans la comprendre;
 *   - cacher leurs titres: « Episode 5 » au lieu de ce qu'il raconte.
 * « Pas encore vu »: apres le dernier episode vu de la serie, et pas entame.
 * Les reglages suivent le compte (cle « reglages »).
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ==================================================== reglages ===== */
const REGLAGES = [
  { cle: 'flouMiniatures', titre: 'Flouter les miniatures',
    aide: 'Celles des épisodes pas encore vus : on devine l’image sans la comprendre.' },
  { cle: 'cacherTitres', titre: 'Cacher les titres',
    aide: 'Ceux des épisodes pas encore vus : « Épisode 5 » au lieu de ce qu’il raconte.' }
];
/* Par defaut: miniatures floutees et titres caches — une image ou un titre
   d'episode spoile vite. Un reglage jamais touche suit ce defaut. */
const REGLAGES_DEFAUT = { flouMiniatures: true, cacherTitres: true };
function reglage(k){
  const r = store.get('reglages', {}) || {};
  return typeof r[k] === 'boolean' ? r[k] : !!REGLAGES_DEFAUT[k];
}

function poserReglage(k, v){
  const r = store.get('reglages', {}) || {};
  r[k] = !!v;
  store.set('reglages', r);
}

/* Le dernier episode vu de chaque serie, garde le temps d'un rendu: une page
   de soixante episodes le demanderait sinon soixante fois. */
const dernierVuCache = new Map();
function dernierVu(a){
  if (dernierVuCache.has(a.key)) return dernierVuCache.get(a.key);
  let d = -1;
  for (const x of a.episodes){ const q = getProgress(x); if (q && q.done && x.idx > d) d = x.idx; }
  dernierVuCache.set(a.key, d);
  return d;
}
/** Apres le dernier vu de sa serie, et pas commence. */
function aVenir(e){
  const a = S.byKey.get(e.anime);
  if (!a) return false;
  const p = getProgress(e);
  if (p && (p.done || p.t > 20)) return false;
  return e.idx > dernierVu(a);
}
function titreEpisode(e){
  return reglage('cacherTitres') && aVenir(e) ? 'Épisode ' + (e.ep != null ? e.ep : e.idx + 1) : e.title;
}
function classeSpoil(e){ return reglage('flouMiniatures') && aVenir(e) ? ' spoil' : ''; }

/* ------------------------------------------------------- panneau ---- */
const ICO_REGLAGES = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>';
function remplirReglages(){
  $('#reglagesPanel').innerHTML =
    '<h4>Paramètres</h4>' +
    '<div class="rg-groupe"><div class="rg-titre">Anti-spoiler</div>' +
    '<p class="cp-aide">Pour les épisodes après le dernier que tu as vu. Ceux que tu as commencés ne sont pas touchés.</p>' +
    REGLAGES.map(r =>
      '<label class="rg-ligne"><span><b>' + esc(r.titre) + '</b><small>' + esc(r.aide) + '</small></span>' +
      '<input type="checkbox" class="rg-switch" data-reglage="' + r.cle + '"' + (reglage(r.cle) ? ' checked' : '') + '></label>').join('') +
    '</div>';
}
function ouvrirReglages(){ remplirReglages(); $('#reglagesPanel').hidden = false; if (typeof fermerCompte === 'function') fermerCompte(); }
function fermerReglages(){ $('#reglagesPanel').hidden = true; }
$('#btnReglages').innerHTML = ICO_REGLAGES + '<span class="tip">Paramètres</span>';
$('#btnReglages').addEventListener('click', (ev) => {
  ev.stopPropagation();
  if ($('#reglagesPanel').hidden) ouvrirReglages(); else fermerReglages();
});
$('#reglagesPanel').addEventListener('change', (ev) => {
  const c = ev.target.closest('[data-reglage]');
  if (!c) return;
  poserReglage(c.dataset.reglage, c.checked);
  rafraichirVue();
  toast(c.checked ? 'Activé' : 'Désactivé', 'ok');
});
document.addEventListener('pointerdown', (ev) => {
  const p = $('#reglagesPanel');
  if (!p.hidden && !p.contains(ev.target) && !ev.target.closest('#btnReglages')) fermerReglages();
});
addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#reglagesPanel').hidden) fermerReglages(); });
