/* 16-compte.js
 *
 * Le compte leger des invites: un pseudo, un mot de passe, et c'est tout.
 *
 * Un lien de partage temporaire est un site neuf a chaque lancement: ce que le
 * navigateur rangeait — progression, edits vus, reglages, identifiant de vote —
 * restait sur l'ancien lien. Connecte, tout cela est garde chez l'hote par le
 * serveur de partage et revient sur n'importe quel lien. Facultatif: sans
 * compte rien n'est refuse, les infos restent seulement dans ce navigateur.
 *
 * La session est un cookie HttpOnly que la page ne voit pas; elle ne connait
 * que le pseudo. Les notes de l'hote, ses categories, ses generiques ne
 * passent jamais par ici: ils viennent de ses fichiers, pas d'un compte.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ====================================================== compte ===== */
/* Ce qui suit le compte: ce qui est a l'invite. Les miniatures (th.) se
   refont toutes seules, et pesent trop pour voyager. */
const COMPTE_PREFIXES = /^(pg|rd|sc|oubli|fav)\./;
const COMPTE_CLES = new Set(['edvus', 'edstats', 'inviteId', 'sublang', 'subpos', 'vol', 'rate',
                             'edMute', 'edVol', 'edRate', 'svMode', 'svFit', 'svDir', 'rsize', 'reglages']);

function cleDuCompte(k){ return COMPTE_PREFIXES.test(k) || COMPTE_CLES.has(k); }

const COMPTE = { dispo: false, actif: false, pseudo: '', sale: false, minuteur: 0, onglet: 'connexion',
                 machine: false, hote: false };   // la machine de l'hote; un compte declare comme le sien

/* Toute ecriture d'une cle du compte le marque a sauver. Pas a chaque fois:
   la lecture pose sa position toutes les 4 secondes. Au plus une sauvegarde
   toutes les 5 secondes, et une derniere quand on quitte la page. */
const _storeSet = store.set.bind(store), _storeDel = store.del.bind(store);
let compteSilence = false;                      // pendant une fusion: rien a renvoyer
store.set = (k, v) => { _storeSet(k, v); if (cleDuCompte(k)) compteSale(); };
store.del = (k) => { _storeDel(k); if (cleDuCompte(k)) compteSale(); };
function compteSale(){
  if (!COMPTE.actif || compteSilence) return;
  COMPTE.sale = true;
  if (!COMPTE.minuteur) COMPTE.minuteur = setTimeout(() => { COMPTE.minuteur = 0; compteSauver(); }, 5000);
}
function compteInstantane(){
  const d = {};
  for (const k of store.keys()) if (cleDuCompte(k)) d[k] = store.get(k, null);
  return d;
}
async function compteSauver(enPartant){
  if (!COMPTE.actif || !COMPTE.sale) return;
  COMPTE.sale = false;
  const corps = JSON.stringify({ donnees: compteInstantane() });
  // en quittant la page, fetch serait coupe: sendBeacon part quand meme, cookie compris
  if (enPartant && navigator.sendBeacon){
    navigator.sendBeacon('__compte/sauver', new Blob([corps], { type: 'application/json' }));
    return;
  }
  try {
    const r = await fetch('__compte/sauver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
    if (r.status === 401){
      COMPTE.actif = false; COMPTE.pseudo = '';
      paintCompte();
      toast('Session terminée : reconnecte-toi pour garder tes infos', 'bad');
    } else if (!r.ok) COMPTE.sale = true;
  } catch(e){ COMPTE.sale = true; }
}
addEventListener('visibilitychange', () => { if (document.hidden) compteSauver(true); });
addEventListener('pagehide', () => compteSauver(true));

/* Ce que le compte apporte rejoint ce que le navigateur sait deja. Les
   positions datees: la plus recente. Les edits vus: les deux listes. Les
   reglages et l'identifiant de vote: ceux du compte, pour que les votes
   suivent la personne et non le navigateur. */
function compteFusionner(d){
  compteSilence = true;
  try {
    // les oublis d'abord: une position que la croix de « Reprendre » a
    // retiree ici, le compte la gardait et la rendait au chargement suivant
    for (const [k, v] of Object.entries(d || {}))
      if (k.startsWith('oubli.') && typeof v === 'number' && v > +store.get(k, 0)) store.set(k, v);
    for (const [k, v] of Object.entries(d || {})){
      if (!cleDuCompte(k) || v == null) continue;
      if (/^(pg|rd|sc)\./.test(k)){
        const serie = k.slice(3).split(k[0] === 's' ? '|' : '/')[0];
        if ((+v.at || 0) <= +store.get('oubli.' + serie, 0)) continue;
      }
      const ici = store.get(k, null);
      if (ici == null) store.set(k, v);
      else if (/^(pg|rd|sc|fav)\./.test(k)){ if ((+v.at || 0) > (+ici.at || 0)) store.set(k, v); }
      else if (k.startsWith('oubli.')){ if (+v > +ici) store.set(k, v); }
      else if (k === 'edvus' || k === 'edstats'){
        if (typeof v === 'object' && typeof ici === 'object') store.set(k, Object.assign({}, v, ici));
      }
      else store.set(k, v);
    }
  } finally { compteSilence = false; }
  edVusCache = edStatsCache = null;              // relues au prochain fil d'edits
  favCache = null;
}

/* Au chargement, le serveur dit si les comptes existent chez lui et si un
   cookie de session nous connecte deja. */
/* Les votes donnes sans compte dans ce navigateur, sous un autre identifiant,
   rejoignent le compte: sinon la meme personne votait deux fois. */
async function rattacherVotes(ancien){
  if (!ancien || ancien === store.get('inviteId', null)) return;
  try {
    const r = await fetch('__compte/votes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ ancien }) });
    const d = await r.json();
    if (d && d.deplaces) location.reload();      // les notes affichees ont change
  } catch(e){}
}
function compteAuDemarrage(d){
  COMPTE.dispo = !!(d && d.comptes);
  COMPTE.machine = !!(d && d.machine);
  if (COMPTE.dispo && d.compte){
    COMPTE.actif = true;
    COMPTE.pseudo = d.compte.pseudo;
    COMPTE.hote = !!d.compte.hote;
    const ancien = store.get('inviteId', null);
    compteFusionner(d.compte.donnees);
    rattacherVotes(ancien);
    if (ancien !== store.get('inviteId', null)) rafraichirMonVote();
    COMPTE.sale = true;
    compteSauver();                              // ce que ce navigateur avait en plus
    if (S.animes.length) render();               // sinon le scan en cours s'en chargera

  } else if (COMPTE.dispo && !d.hote && store.keys().some(k => /^pg\./.test(k)) && !store.get('rappelCompte', false)){
    // il a commence a regarder sans compte: une seule fois, on lui dit ce qu'il risque
    store.set('rappelCompte', true);
    setTimeout(() => toastAction('Crée un compte pour garder ta progression sur les prochains liens', 'Créer',
                                 () => ouvrirCompte('inscription')), 4000);
  } else if (COMPTE.dispo && !d.hote && !store.keys().some(k => /^(pg|rd|sc)\./.test(k))){
    // un navigateur vierge: peut-etre un ami revenu par un nouveau lien
    setTimeout(() => toastAction('Déjà un compte ? Retrouve tes infos', 'Se connecter', () => ouvrirCompte('connexion')), 1500);
  }
  paintCompte();
}

/* ---------------------------------------------------- le panneau ---- */
const ICO_COMPTE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.3 7.5-5.3s6.1 1.7 7.5 5.3"/></svg>';
function paintCompte(){
  const b = $('#btnCompte');
  if (!b) return;
  b.hidden = !COMPTE.dispo;
  b.classList.toggle('connecte', COMPTE.actif);
  b.innerHTML = (COMPTE.actif ? '<span class="cp-initiale">' + esc(COMPTE.pseudo.slice(0, 1).toUpperCase()) + '</span>' : ICO_COMPTE) +
    '<span class="tip">' + (COMPTE.actif ? esc(COMPTE.pseudo) : 'Compte') + '</span>';

  const p = $('#comptePanel');
  if (p && !p.hidden) remplirCompte();
}
function remplirCompte(msg){
  const p = $('#comptePanel');
  if (COMPTE.actif){
    p.innerHTML =
      '<h4>Connecté : <b>' + esc(COMPTE.pseudo) + '</b></h4>' +
      '<p class="cp-aide">Ta progression, tes edits vus et tes réglages sont gardés chez l’hôte. ' +
      'Sur un nouveau lien, reconnecte-toi pour tout retrouver.</p>' +
      // depuis sa machine seulement: un ami ne peut pas s'en reclamer
      (COMPTE.machine
        ? '<label class="cp-hote"><input type="checkbox" data-cp="hote"' + (COMPTE.hote ? ' checked' : '') + '>' +
          '<span><b>C’est mon compte d’hôte</b><small>Mes notes comptent comme celles de l’hôte, ' +
          'même depuis le lien partagé, et jamais en double.</small></span></label>'
        : COMPTE.hote ? '<p class="cp-note">Compte de l’hôte : tes notes comptent comme les siennes.</p>' : '') +
      (COMPTE.machine ? '<a class="cp-gerer" href="comptes.html" target="_blank" rel="noopener">Gérer les comptes de tes potes →</a>' : '') +
      '<button class="btn btn-ghost cp-sortir" data-cp="deconnexion">Se déconnecter</button>';
    return;
  }
  const ins = COMPTE.onglet === 'inscription';
  p.innerHTML =
    '<h4>Compte</h4>' +
    '<p class="cp-aide">Facultatif : tout marche sans. Mais sans compte, tes infos restent dans ce navigateur ' +
    'et se perdent avec un nouveau lien.</p>' +
    (COMPTE.machine ? '<a class="cp-gerer" href="comptes.html" target="_blank" rel="noopener">Gérer les comptes de tes potes →</a>' : '') +

    '<div class="cp-onglets">' +
      '<button type="button" data-cp-onglet="connexion"' + (ins ? '' : ' class="on"') + '>Se connecter</button>' +
      '<button type="button" data-cp-onglet="inscription"' + (ins ? ' class="on"' : '') + '>Créer un compte</button>' +
    '</div>' +
    '<form class="cp-form" autocomplete="on">' +
      '<input name="pseudo" placeholder="Pseudo" autocomplete="username" maxlength="24" required>' +
      '<input name="mdp" type="password" placeholder="Mot de passe" autocomplete="' + (ins ? 'new-password' : 'current-password') + '" required>' +
      '<button class="btn btn-primary" type="submit">' + (ins ? 'Créer mon compte' : 'Se connecter') + '</button>' +
      '<p class="cp-err">' + esc(msg || '') + '</p>' +
      (ins ? '<p class="cp-note">Ce que tu as déjà regardé ici sera gardé dans le compte.</p>' : '') +
    '</form>';
  const champ = p.querySelector('input[name=pseudo]');
  if (champ) setTimeout(() => champ.focus(), 0);
}
function ouvrirCompte(onglet){
  if (onglet) COMPTE.onglet = onglet;
  const p = $('#comptePanel');
  p.hidden = false;
  remplirCompte();
}
function fermerCompte(){ const p = $('#comptePanel'); if (p) p.hidden = true; }

$('#btnCompte').addEventListener('click', (ev) => {
  ev.stopPropagation();
  if ($('#comptePanel').hidden) ouvrirCompte(); else fermerCompte();
});
document.addEventListener('pointerdown', (ev) => {
  const p = $('#comptePanel');
  if (p && !p.hidden && !p.contains(ev.target) && !ev.target.closest('#btnCompte')) fermerCompte();
});
addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#comptePanel').hidden) fermerCompte(); });
$('#comptePanel').addEventListener('change', async (ev) => {
  const c = ev.target.closest('[data-cp="hote"]');
  if (!c) return;
  c.disabled = true;
  let d = null;
  try {
    const r = await fetch('__compte/hote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                             body: JSON.stringify({ actif: c.checked }) });
    d = await r.json();
  } catch(e){}
  if (!d || !d.ok){ c.checked = !c.checked; c.disabled = false; return toast('Réglage refusé par le partage', 'bad'); }
  toast(c.checked ? 'Compte de l’hôte' + (d.deplaces ? ' : ' + fmtCount(d.deplaces, 'vote en double rangé', 'votes en double rangés') : '')
                  : 'Ce compte note de nouveau en invité', 'ok');
  setTimeout(() => location.reload(), 900);     // les notes changent de case: on repart propre
});
$('#comptePanel').addEventListener('click', async (ev) => {
  const o = ev.target.closest('[data-cp-onglet]');
  if (o){ COMPTE.onglet = o.dataset.cpOnglet; remplirCompte(); return; }
  if (ev.target.closest('[data-cp="deconnexion"]')){
    if (!confirm('Te déconnecter ? Tes infos restent gardées dans ton compte.')) return;
    await compteSauver();

    try { await fetch('__compte/deconnexion', { method: 'POST' }); } catch(e){}
    COMPTE.actif = false; COMPTE.pseudo = '';
    paintCompte(); fermerCompte();
    toast('Déconnecté : tes infos restent dans ton compte');
  }
});
$('#comptePanel').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target, ins = COMPTE.onglet === 'inscription';
  const pseudo = f.pseudo.value.trim(), mdp = f.mdp.value;
  const bouton = f.querySelector('button[type=submit]');
  bouton.disabled = true;
  let r = null;
  try {
    const rep = await fetch('__compte/' + (ins ? 'inscription' : 'connexion'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ins ? { pseudo, mdp, donnees: compteInstantane() } : { pseudo, mdp }) });
    r = await rep.json();
  } catch(e){}
  bouton.disabled = false;
  if (!r || !r.ok) return remplirCompte((r && r.erreur) || 'Le partage ne répond pas');
  COMPTE.actif = true;
  COMPTE.pseudo = r.pseudo;
  if (!ins){
    const ancien = store.get('inviteId', null);
    compteFusionner(r.donnees); COMPTE.sale = true; compteSauver();
    rattacherVotes(ancien);
    if (ancien !== store.get('inviteId', null)) rafraichirMonVote();

  }

  paintCompte(); fermerCompte();
  if (S.animes.length) render();
  toast(ins
 ? 'Compte créé : bienvenue ' + r.pseudo : 'Content de te revoir, ' + r.pseudo, 'ok');
});
