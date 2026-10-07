/* 07-rendu.js
 *
 * Le rendu general et la page d'accueil.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ======================================================== rendu ====== */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function allEpisodes(){ return S.animes.flatMap(a => a.episodes); }

/**
 * Une seule entrée par série et par média: le dernier épisode regardé, le
 * dernier chapitre de scan lu, le dernier tome ouvert. Reprendre la saison 3
 * épisode 3 retire donc la saison 1 épisode 2, sans effacer la lecture en cours.
 * On part des positions enregistrées, pas du catalogue: seul ce qui a été
 * ouvert est examiné.
 */
function continueList(){
  const best = new Map();
  const put = (id, at, make) => {
    if (!(at > 0)) return;                  // sans date, on ne sait pas où classer
    const cur = best.get(id);
    if (!cur || at > cur.at) best.set(id, Object.assign({ at }, make()));
  };
  for (const k of store.keys()){
    if (k.startsWith('pg.')){
      const e = findEp(k.slice(3));
      if (!e) continue;
      const p = getProgress(e);
      if (!p || p.done || p.t <= 20) continue;
      put('ep|' + e.anime, p.at, () => ({
        kind:'ep', anime: e.anime, ep: e, ref: e.rel, pct: p.d ? p.t / p.d : 0
      }));
    } else if (k.startsWith('sc.')){
      const spec = k.slice(3);
      const hit = findChapter(spec);
      if (!hit) continue;
      const pos = getScanPos(spec);
      if (!pos) continue;
      const pct = (pos.p + 1) / hit.c.pages.length;
      if (pct > 0.97) continue;             // chapitre terminé
      put('scan|' + hit.a.key, pos.at, () => ({
        kind:'scan', anime: hit.a.key, hit, ref: spec, pct
      }));
    } else if (k.startsWith('rd.')){
      const rel = k.slice(3);
      const hit = findDoc(rel);
      if (!hit) continue;
      const pos = getReadPos(rel);
      if (!pos || pos.p < 0.01 || pos.p > 0.97) continue;
      put('doc|' + hit.anime.key, pos.at, () => ({
        kind:'doc', anime: hit.anime.key, doc: hit.doc, a: hit.anime, ref: rel, pct: pos.p
      }));
    }
  }
  return [...best.values()].sort((x,y) => y.at - x.at).slice(0, 20);
}
const resumeId = (c) => c.kind + '|' + c.ref;
/** Ce sur quoi on retombe quand on clique la tuile. */
function resumeTarget(c){
  return c.kind === 'ep'   ? { attr:'data-play', val: c.ep.rel }
       : c.kind === 'scan' ? { attr:'data-scan', val: c.ref }
       :                     { attr:'data-doc',  val: c.doc.rel };
}
function recentList(){
  return allEpisodes().filter(e => e.added).sort((a,b) => b.added - a.added).slice(0, 24);
}
function nextUnwatched(a){
  for (const e of a.episodes){
    const p = getProgress(e);
    if (!p || !p.done) return e;
  }
  return a.episodes[0];
}

function render(){
  dernierVuCache.clear();                     // la progression a pu bouger depuis le dernier rendu

  ['home','anime','list','docs'].forEach(v => { const el = $('#view-' + v); if (el) el.hidden = true; });
  if (S.query)                 renderList('search');
  else if (S.view === 'home')  renderHome();
  else if (S.view === 'anime') renderAnime(S.animeKey);
  else if (S.view === 'docs')  renderDocs(S.docKey);
  else if (S.view === 'episode') renderEpisode(S.epRel);

  else                         renderList(S.view);
  paintNav();
  hydrate();
}
/** Onglets ajoutés seulement si la collection a de quoi les remplir. */
function paintNav(){
  const nav = $('#tnav');
  $$('button', nav).forEach(b => b.classList.toggle('on', !!b.dataset.go && b.dataset.go === S.view && !S.query));
  const has = S.animes.some(hasReading);
  let btn = nav.querySelector('[data-docs=""]');
  if (has && !btn){
    btn = document.createElement('button');
    btn.setAttribute('data-docs', '');
    nav.appendChild(btn);
  }
  if (btn){
    btn.hidden = !has;
    btn.textContent = docsLabel();
    btn.classList.toggle('on', S.view === 'docs' && !S.query);
  }
  // le fil de tous les edits, séries confondues
  const nEd = totalEdits();
  let bed = nav.querySelector('[data-edits-tous]');
  if (nEd && !bed){
    bed = document.createElement('button');
    bed.setAttribute('data-edits-tous', '');
    bed.textContent = 'Edits';
    nav.appendChild(bed);
  }
  if (bed){
    bed.hidden = !nEd;
    bed.title = fmtCount(nEd, 'edit', 'edits') + ' dans toute la bibliothèque';
  }
}
function totalEdits(){ return S.animes.reduce((n, a) => n + a.edits.length, 0); }

/** Pastilles qualite + langue. Les sous-titres etant incrustes dans l'image,
    la pastille de langue decrit la video elle-meme. */
function metaChips(a){
  return (a.quality ? '<span class="chip q">' + esc(a.quality) + '</span>' : '') +
         (a.lang ? '<span class="chip lang" title="' + esc(langHint(a.lang, a.subs)) + '">' + esc(a.lang) + '</span>' : '') +
         (a.subs ? '<span class="chip subs" title="Sous-titres au choix, dans plusieurs langues">' + esc(a.subs) + '</span>' : '');
}
function langHint(lang, subs){
  if (/^VOST/.test(lang) && subs) return 'Version originale, sous-titres au choix';
  if (/^VOST/.test(lang)) return "Version originale, sous-titres incrustés dans l'image";
  if (/^VF/.test(lang))   return 'Doublage français';
  if (lang === 'VO')      return 'Version originale, sans sous-titres';
  return lang;
}

/* --------------------------------------------- recommandations ------
 * Ce qu'on a regarde dit ce qu'on aime. Chaque serie entamee donne du poids
 * a ses categories: d'autant plus qu'on en a vu d'episodes (plein a douze),
 * que c'est recent (demi-vie de deux mois) et qu'on l'a bien notee — une
 * serie notee sous 5 fait baisser les siennes. Les poids sont ramenes a 1
 * pour la categorie preferee.
 */
const RECO_PLEIN = 12, RECO_DEMI_VIE = 60;
function goutsCategories(){
  const poids = {}, maintenant = Date.now();
  for (const a of S.animes){
    if (!a.episodes.length) continue;
    let vus = 0, dernier = 0;
    for (const e of a.episodes){
      const p = getProgress(e);
      if (!p) continue;
      if (p.done) vus += 1; else if (p.t > 120) vus += .5;
      if (p.at > dernier) dernier = p.at;
    }
    if (!vus) continue;
    const engagement = Math.min(1, vus / Math.min(a.episodes.length, RECO_PLEIN));
    const recence = Math.pow(.5, (maintenant - dernier) / 86400000 / RECO_DEMI_VIE);
    const c = noteCible('s:' + a.key), avis = c.perso || c.note;
    const gout = avis ? Math.max(-1, Math.min(1, (avis - 5) / 4)) : .5;
    const w = engagement * (.4 + .6 * recence) * gout;
    const cats = catsOf(a.key);
    for (const k of cats) poids[k] = (poids[k] || 0) + w / Math.sqrt(cats.length);
  }
  const max = Math.max(0, ...Object.values(poids));
  if (max > 0) for (const k in poids) poids[k] /= max;
  return poids;
}
/* Les series a recommander: pas commencees, ou a peine (moins d'un tiers
 * vu — au-dela, elles sont dans « Reprendre »). Leur score: ce que leurs
 * categories partagent avec nos gouts, plus un peu de leur note. Sans
 * historique, il ne reste que la note: les mieux notees d'abord. */
function recommandations(){
  const poids = goutsCategories();
  const perso = Object.values(poids).some(w => w > 0);
  const liste = [];
  for (const a of videoSeries()){
    if (!a.episodes.length) continue;
    const vus = a.episodes.filter(e => (getProgress(e) || {}).done).length;
    if (vus / a.episodes.length > 1 / 3) continue;
    const cats = catsOf(a.key);
    const affinite = cats.reduce((s, k) => s + Math.max(0, poids[k] || 0), 0) / Math.sqrt(cats.length || 1);
    const note = noteCible('s:' + a.key).note || 6;
    const score = (perso ? affinite : 0) + (note - 6) * .12 - (vus ? .15 : 0);
    const raisons = cats.filter(k => (poids[k] || 0) > 0).sort((x, y) => poids[y] - poids[x]).slice(0, 2);
    liste.push({ a, score, raisons });
  }
  liste.sort((x, y) => y.score - x.score || naturalCompare(x.a.title, y.a.title));
  return { liste, perso };
}
/* A la une: une des trois premieres, tiree avec la date du jour pour graine.
   Elle change chaque jour, pas a chaque retour a l'accueil. */
function choixDuJour(liste){
  const n = Math.min(3, liste.length);
  if (!n) return null;
  const jour = new Date().toISOString().slice(0, 10);
  let h = 0;
  for (const ch of jour) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return liste[h % n];
}
/* La serie qu'on est en train de regarder: la plus recemment touchee qui
   n'est pas finie, depuis moins d'un mois. L'episode a reprendre: celui
   qu'on a laisse en cours, ou, s'il etait fini, le suivant pas encore vu. */
const EN_COURS_JOURS = 30;
function serieEnCours(){
  const limite = Date.now() - EN_COURS_JOURS * 86400000, l = [];
  for (const a of videoSeries()){
    let dernier = null, at = 0;
    for (const e of a.episodes){ const p = getProgress(e); if (p && p.at > at){ at = p.at; dernier = e; } }
    if (dernier && at > limite) l.push({ a, dernier, at });
  }
  l.sort((x, y) => y.at - x.at);
  for (const { a, dernier } of l){
    const ep = getProgress(dernier).done
      ? a.episodes.find(e => e.idx > dernier.idx && !(getProgress(e) || {}).done)
      : dernier;
    if (ep) return { a, ep };
  }
  return null;
}
function phraseReco(r){
  if (!r.raisons.length) return '';
  return 'Parce que tu aimes ' + r.raisons.join(' et ');
}

/* ----------------------------------------------------------- home --- */
function renderHome(){
  const view = $('#view-home'); view.hidden = false;
  const cont = continueList();
  const vids  = videoSeries();
  const reco = recommandations();
  // une serie en cours passe avant la recommandation du jour: on la reprend
  const enCours = serieEnCours();
  const une = choixDuJour(reco.liste);
  if (enCours) renderHero(enCours.a, enCours.ep);
  else renderHero((une && une.a) || favList().find(hasVideo) || vids[0], null,
                  !une ? '' : reco.perso ? phraseReco(une) || 'À la une sur Netflox' : 'Les mieux notées de Netflox');


  const rows = [];
  if (cont.length) rows.push({ title:'Reprendre', sub:'là où tu t\'es arrêté', items: cont, resume:true });
  if (reco.liste.length > 1) rows.push({ title:'Pour toi', poster:true, items: reco.liste.slice(0, 12).map(r => r.a),
    sub: reco.perso ? 'd’après ce que tu regardes' : 'les mieux notées, en attendant de te connaître' });

  const favs = favList().filter(hasVideo);
  if (favs.length) rows.push({ title:'Mes favoris', sub: fmtCount(favs.length,'série','séries'), items: favs, poster:true });
  const rec = recentList();
  if (rec.length) rows.push({ title:'Ajoutés récemment', items: rec, wide:true });
  rows.push(...categoryRows());
  $('#rows').innerHTML = catPromptHTML() + rows.map(rowHTML).join('');
  wireRows($('#rows'));
}
