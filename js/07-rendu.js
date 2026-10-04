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
  ['home','anime','list','docs'].forEach(v => { const el = $('#view-' + v); if (el) el.hidden = true; });
  if (S.query)                 renderList('search');
  else if (S.view === 'home')  renderHome();
  else if (S.view === 'anime') renderAnime(S.animeKey);
  else if (S.view === 'docs')  renderDocs(S.docKey);
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

/* ----------------------------------------------------------- home --- */
function renderHome(){
  const view = $('#view-home'); view.hidden = false;
  const cont = continueList();
  const firstEp = cont.find(c => c.kind === 'ep');       // la bannière reste une vidéo
  const vids  = videoSeries();
  const heroA = (firstEp && S.byKey.get(firstEp.anime)) || favList().find(hasVideo) || vids[0];
  renderHero(heroA, firstEp && firstEp.ep);

  const rows = [];
  if (cont.length) rows.push({ title:'Reprendre', sub:'là où tu t\'es arrêté', items: cont, resume:true });
  const favs = favList().filter(hasVideo);
  if (favs.length) rows.push({ title:'Mes favoris', sub: fmtCount(favs.length,'série','séries'), items: favs, poster:true });
  const rec = recentList();
  if (rec.length) rows.push({ title:'Ajoutés récemment', items: rec, wide:true });
  rows.push(...categoryRows());
  $('#rows').innerHTML = catPromptHTML() + rows.map(rowHTML).join('');
  wireRows($('#rows'));
}
