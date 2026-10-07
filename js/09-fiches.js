/* 09-fiches.js
 *
 * Les fiches: categories, notes en etoiles, page d'une serie, listes,
 * recherche, filtres et interactions.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ------------------------------------------------------ catégories -- */
/* Les catégories sont posées à la main depuis la page d'une série et
   gardées en local: rien n'est déduit du disque, rien n'est écrit en dur. */
const CAT_SUGGEST = ['Isekai','Shonen','Seinen','Fantasy','Action','Aventure','Comédie','Drame',
                     'Thriller','Surnaturel','Psychologique','Science-fiction','Slice of life',
                     'Sport','Horreur','Romance','Animation US','Film'];
function allCats(){ return S.shared ? S.host.cats : (store.get('cats', {}) || {}); }
function catsOf(key){ const l = allCats()[key]; return Array.isArray(l) ? l.slice() : []; }
function setCats(key, list){
  if (lectureSeule()) return;
  const all = allCats();
  if (list.length) all[key] = list; else delete all[key];
  store.set('cats', all);
  saveSidecar(key);
}
function knownCats(){
  const set = new Set(CAT_SUGGEST);
  Object.values(allCats()).forEach(l => (l || []).forEach(c => set.add(c)));
  return [...set].sort(naturalCompare);
}
/** Invitation affichée tant qu'aucune catégorie n'existe. Disparaît à la première. */
function catPromptHTML(){
  if (S.shared) return '';                       // ranger n'est pas de son ressort
  if (!S.animes.length || Object.keys(allCats()).length) return '';
  const first = S.animes[0];
  return '<div class="catprompt">' +
    '<span class="cp-ic">🗂️</span>' +
    '<span class="cp-tx"><b>Range tes séries par catégorie</b>' +
      'Ouvre une série et tape une catégorie — <i>Isekai</i>, <i>Shonen</i>, <i>Thriller</i>… ' +
      'Chaque catégorie devient une rangée ici.</span>' +
    '<button class="btn btn-ghost" data-anime="' + esc(first.key) + '">Commencer par ' + esc(first.title) + '</button>' +
  '</div>';
}

/* Une rangée qui ne contient qu'une seule série n'apporte rien et hache l'accueil:
   on n'affiche une catégorie qu'à partir de deux séries. Celles qui n'apparaissent
   alors nulle part sont regroupées en fin de page. */
const MIN_ROW = 2;

/** Une rangée de séries par catégorie, plus une rangée de repli. */
function categoryRows(){
  const byCat = new Map();
  for (const a of videoSeries()){
    for (const c of catsOf(a.key)){
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(a);
    }
  }
  const rows = [...byCat.entries()]
    .filter(([, items]) => items.length >= MIN_ROW)
    .sort((x,y) => y[1].length - x[1].length || naturalCompare(x[0], y[0]))
    .map(([label, items]) => ({ title: label, sub: fmtCount(items.length,'série','séries'), items, poster:true }));

  const shown = new Set(rows.flatMap(r => r.items.map(a => a.key)));
  const rest = videoSeries().filter(a => !shown.has(a.key));
  if (rest.length){
    rows.push({
      title: rows.length ? 'Autres séries' : 'Toutes les séries',
      sub: rows.length ? null : 'range-les par catégorie depuis leur page',
      items: rest, poster:true
    });
  }
  return rows;
}
/** Puces de catégories sur la page d'une série, avec ajout et retrait. */
function paintCats(a){
  const box = $('#catBox');
  if (!box) return;
  const mine = catsOf(a.key);
  if (S.shared){                                 // celles de l’hôte, sans les retirer
    box.innerHTML = mine.map(c => '<span class="catchip on">' + esc(c) + '</span>').join('');
    return;
  }
  const free = knownCats().filter(c => !mine.includes(c));
  box.innerHTML =
    mine.map(c => '<span class="catchip on">' + esc(c) +
      '<button data-rmcat="' + esc(c) + '" aria-label="Retirer ' + esc(c) + '">×</button></span>').join('') +
    '<span class="catchip add' + (mine.length ? '' : ' wide') + '">' +
      '<input id="catInput" list="catList" autocomplete="off" spellcheck="false" placeholder="' +
      (mine.length ? '+ catégorie' : '+ Ranger dans une catégorie') + '"></span>' +
    '<datalist id="catList">' + free.map(c => '<option value="' + esc(c) + '"></option>').join('') + '</datalist>';

  $$('[data-rmcat]', box).forEach(b => b.addEventListener('click', () => {
    setCats(a.key, catsOf(a.key).filter(c => c !== b.dataset.rmcat));
    paintCats(a);
  }));
  const inp = $('#catInput', box);
  const add = () => {
    const v = inp.value.trim().replace(/\s+/g, ' ');
    if (!v) return;
    const list = catsOf(a.key);
    if (!list.some(c => c.toLowerCase() === v.toLowerCase())){
      const known = knownCats().find(c => c.toLowerCase() === v.toLowerCase());
      list.push(known || v);
      setCats(a.key, list);
    }
    inp.value = '';
    paintCats(a);
    $('#catInput').focus();
  };
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter'){ ev.preventDefault(); add(); }
    if (ev.key === 'Escape') inp.blur();
  });
  inp.addEventListener('change', add);   // choix dans la liste déroulante
}

function renderHero(a, resumeEp, kicker){
  if (!a){ $('#hero').innerHTML = ''; return; }
  const ep = resumeEp || nextUnwatched(a);
  const p  = ep ? getProgress(ep) : null;
  const label = p && p.t > 20 && !p.done ? 'Reprendre' : 'Lecture';
  $('#hero').innerHTML =
    '<div class="hero-bg">' + artTag(a, true) + '</div>' +
    '<div class="hero-in">' +
      '<div class="hero-kicker">' + esc(resumeEp ? 'On reprend ?' : kicker || 'À la une sur Netflox')

 + '</div>' +
      '<h1>' + esc(a.title) + '</h1>' +
      '<div class="hero-meta">' +
        (a.episodes.length || !a.edits.length
          ? '<span>' + fmtCount(a.seasonList.length,'saison','saisons') + '</span><span class="sep"></span>' +
            '<span>' + fmtCount(a.episodes.length,'épisode','épisodes') + '</span><span class="sep"></span>' +
            '<span>' + fmtSize(a.size) + '</span>'
          : '<span>' + fmtCount(a.edits.length,'edit','edits') + '</span><span class="sep"></span>' +
            '<span>' + fmtSize(a.editSize) + '</span>') +
        metaChips(a) +
        (a.tsCount ? '<span class="chip ts">' + a.tsCount + ' .ts</span>' : '') +
      '</div>' +
      '<div class="hero-actions">' +
        (ep ? '<button class="btn btn-light" data-play="' + esc(ep.rel) + '">' +
              '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg>' + label + '</button>' : '') +
        '<button class="btn btn-ghost" data-anime="' + esc(a.key) + '">' +
          (a.episodes.length ? 'Voir les épisodes' : 'Voir la fiche') + '</button>' +
      '</div>' +
    '</div>';
}

function rowHTML(row){
  const tiles = row.items.map(it =>
    row.resume ? resumeTileHTML(it) : row.poster ? posterHTML(it) : tileHTML(it)).join('');
  return '<div class="row">' +
    '<div class="row-head"><h2>' + esc(row.title) + '</h2>' +
      (row.sub ? '<span class="cnt">' + esc(row.sub) + '</span>' : '') +
      (row.key ? '<button class="more" data-anime="' + esc(row.key) + '">Tout voir ›</button>' : '') +
    '</div>' +
    '<div class="rail-wrap">' +
      '<button class="rail-btn l" data-rail="-1" aria-label="Précédent">‹</button>' +
      '<div class="rail">' + tiles + '</div>' +
      '<button class="rail-btn r" data-rail="1" aria-label="Suivant">›</button>' +
    '</div></div>';
}

function posterHTML(a){
  const initials = a.title.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
  const lecture  = !hasVideo(a);          // trouvable par la recherche, lisible seulement
  /* Toute vignette mene a la fiche, meme celle d'une serie sans episode: c'est
     la que se choisit ce qu'on ouvre — le fil des edits ou les scans. Sauter
     droit aux chapitres cachait les edits de Dragon Ball Z. */
  return '<div class="tile poster" tabindex="0" data-anime="' + esc(a.key) + '">' +
    '<div class="th">' +
      '<div class="ph">' + esc(initials) + '</div>' +
      artTag(a) +
      '<div class="veil"></div><div class="play"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg></div>' +
      '<div class="tags">' +
        (a.quality ? '<span class="tag q">' + esc(a.quality) + '</span>' : '') +
        (a.lang ? '<span class="tag lang">' + esc(a.lang) + '</span>' : '') +
        (a.subs ? '<span class="tag subs">' + esc(a.subs) + '</span>' : '') + '</div>' +
      (isFav(a.key) ? '<span class="favmark" title="Dans ma liste">' + ICON_STAR_ON + '</span>' : '') +
      noteMarkHTML(a) +
    '</div>' +
    '<div class="tbody"><div class="tname">' + esc(a.title) + '</div>' +
      '<div class="tmeta">' + (lecture
        ? fmtCount(docsTotal(a),'chapitre','chapitres') +
          (a.edits.length ? '<span class="sep"></span>' +
            fmtCount(a.edits.length,'edit','edits') : '')
        : a.episodes.length
          ? fmtCount(a.episodes.length,'ép.','ép.') + '<span class="sep"></span>' + fmtSize(a.size)
          : fmtCount(a.edits.length,'edit','edits') + '<span class="sep"></span>' + fmtSize(a.editSize)) + '</div>' +
    '</div></div>';
}

const ICON_STAR = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linejoin="round"><path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"/></svg>';
const ICON_STAR_ON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"/></svg>';
/** Bascule favori de la page d'une série. */
function favButtonHTML(key){
  const on = isFav(key);
  return '<button class="btn btn-ghost fav' + (on ? ' on' : '') + '" data-fav="' + esc(key) + '" ' +
    'aria-pressed="' + (on ? 'true' : 'false') + '">' + (on ? ICON_STAR_ON : ICON_STAR) +
    (on ? 'Dans ma liste' : 'Ajouter à ma liste') + '</button>';
}

/* ------------------------------------------------------ les etoiles - */
const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"/></svg>';

/** Une note ecrite avec la virgule francaise: 8, ou 8,7. */
function fmtNote(n){ return String(Math.round(n * 10) / 10).replace('.', ','); }

/** D'ou sort le chiffre affiche: le dire evite de le prendre pour le mien.
    Chez l'invite, l'avis de l'hote reste un avis parmi d'autres: on dit qu'il
    compte, pas ce qu'il vaut. */
function noteDetail(c){
  if (c.auto) return c.note ? 'Moyenne des \u00e9pisodes' : '';
  const hote = !S.shared || S.estHote;
  const bouts = [];
  if (hote && c.mine) bouts.push('Ma note ' + fmtNote(c.mine));
  if (!hote && c.perso) bouts.push('Ta note ' + fmtNote(c.perso));
  if (c.imdb) bouts.push('IMDb ' + fmtNote(c.imdb));
  if (c.inv) bouts.push('Invit\u00e9s ' + fmtNote(c.inv.v) + ' (' + fmtCount(c.inv.n, 'vote', 'votes') +
                        (c.inv.w < .5 ? ', loin des autres : compte peu' : '') + ')');
  if (!hote && c.mine) bouts.push('et l\u2019h\u00f4te');
  if (!bouts.length) return '';
  return bouts.join(' \u00b7 ') + (bouts.length > 1 ? ' \u2192 ' + fmtNote(c.note) : '');
}

/**
 * Les cinq etoiles d'une cible. Chaque etoile porte deux zones de clic — sa
 * moitie gauche vaut le point impair — ce qui donne dix crans sans jamais
 * mesurer une coordonnee. Chez l'invite les zones disparaissent: il reste des
 * etoiles qui se lisent, et rien qui laisse croire qu'il peut noter.
 */
function rateHTML(cible){
  const c = noteCible(cible);
  const fige = S.shared && !S.peutNoter;       // un partage d'avant les notes d'invites
  if (fige && !c.note) return '';
  let etoiles = '';
  for (let i = 0; i < 5; i++){
    const plein = Math.max(0, Math.min(1, (c.note - i * 2) / 2));
    etoiles += '<span class="st">' + STAR_SVG +
      '<i style="width:' + (plein * 100).toFixed(1) + '%">' + STAR_SVG + '</i>' +
      (fige ? '' :
        '<button class="hz l" data-rate-n="' + (i*2+1) + '" title="' + (i*2+1) + '/10"></button>' +
        '<button class="hz r" data-rate-n="' + (i*2+2) + '" title="' + (i*2+2) + '/10"></button>') +
      '</span>';
  }
  const detail = noteDetail(c);
  return '<span class="rate' + (fige ? '' : ' set') + (c.note ? ' has' : '') +
      (c.note && !c.perso ? ' ext' : '') + '" data-rate="' + esc(cible) + '"' +
      (detail ? ' title="' + esc(detail) + '"' : '') + '>' + etoiles +
    (c.note ? '<span class="val">' + fmtNote(c.note) + '<small>/10</small></span>' : '') +
  '</span>';
}
/** Bloc de notation d'une serie, sur sa fiche comme sur sa page de lecture. */
function noteBoxHTML(a){
  const c = noteCible('s:' + a.key);
  if (S.shared && !S.peutNoter && !c.note) return '';
  /* A cote des etoiles, trois mots: le detail des voix est long, il reste
     au survol des etoiles (leur title). */
  const peut = !S.shared || S.peutNoter;
  const hote = !S.shared || S.estHote;
  const detail = c.perso ? (hote ? 'Ma note ' : 'Ta note ') + fmtNote(c.perso)
               : peut ? 'Clique pour noter'
               : c.auto && c.note ? 'Moyenne des \u00e9pisodes' : '';

  return '<div class="ratebox" data-notebox="' + esc(a.key) + '">' +
    '<span class="lab">Note</span>' +
    rateHTML('s:' + a.key) +
    (detail.trim() ? '<span class="auton">' + esc(detail.trim()) + '</span>' : '') +
  '</div>';
}
/** Ce que raconte la serie, tel que son fichier le dit. */
function descHTML(a){
  const d = descOf(a.key);
  return d ? '<p class="dsyn">' + esc(d) + '</p>' : '';
}
/** Pastille de note sur une vignette: visible de tous, l'hote comme l'invite. */
function noteMarkHTML(a){
  const c = noteCible('s:' + a.key);
  if (!c.note) return '';
  return '<span class="notemark' + (c.perso ? '' : ' ext') + '" title="' +
    esc(noteDetail(c) || 'Note') + '">' + STAR_SVG + fmtNote(c.note) + '</span>';
}
/* Une note posee change aussi la moyenne affichee plus haut: on redessine
   toutes les etoiles de la page, en place, pour ne pas perdre le defilement. */
function majNotes(){
  // les blocs d'abord: ils contiennent leurs propres etoiles, qu'on ne veut
  // pas repeindre une fois detachees de la page
  $$('[data-notebox]').forEach(box => {
    const a = S.byKey.get(box.dataset.notebox);
    if (a) box.outerHTML = noteBoxHTML(a);
  });
  $$('[data-rate]').forEach(box => {
    if (box.isConnected) box.outerHTML = rateHTML(box.dataset.rate);
  });
}
/** Clic sur une demi-etoile. Recliquer la meme valeur retire la note. */
function poserNote(btn){
  const box = btn.closest('[data-rate]');
  if (!box) return;
  const c = noteCible(box.dataset.rate);
  const n = normNote(btn.dataset.rateN);
  const val = (n === c.perso) ? 0 : n;         // recliquer sa propre etoile la retire
  toast(val ? 'Ta note : ' + fmtNote(val) + '/10' : 'Note retirée', 'ok');
  if (S.shared){ envoyerNote(box.dataset.rate, val); return; }
  if (c.ep) setEpNote(c.id, val); else setNote(c.id, val);
  majNotes();


}

const ICON_BROOM =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M19 4 12 11"/><path d="m8.5 10.5 5 5"/>' +
  '<path d="m11 13-4.2 1.1a2 2 0 0 0-1.3 1.2L4 20l4.7-1.5a2 2 0 0 0 1.2-1.3z"/></svg>';

/** Tuile de la rangée « Reprendre »: vidéo, chapitre de scan ou tome. */
function resumeTileHTML(c){
  const a = S.byKey.get(c.anime);
  const pct = Math.max(0, Math.min(100, (c.pct || 0) * 100));
  const tgt = resumeTarget(c);
  const broom = '<button class="forget" data-forget="' + esc(resumeId(c)) + '" ' +
    'title="Retirer de « Reprendre »" aria-label="Retirer de « Reprendre »">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';

  let face, name, meta;
  if (c.kind === 'ep'){
    const season = a && a.seasonList.length > 1 ? seasonLabel(c.ep.seasonKey) + ' · ' : '';
    face = '<div class="th" data-thumb="' + esc(c.ep.rel) + '">' +
             '<div class="ph">' + (c.ep.ep != null ? esc(c.ep.ep) : '▶') + '</div>';
    name = a ? a.title : c.anime;
    meta = esc(season) + (c.ep.ep != null ? 'Ép. ' + c.ep.ep : esc(c.ep.title));
  } else if (c.kind === 'scan'){
    const pos = getScanPos(c.ref);
    face = '<div class="th sc"><div class="ph">📖</div>' +
           '<img data-cover="' + esc(c.ref) + '" alt="">';
    name = c.hit.a.title;
    meta = esc(c.hit.c.title) + '<span class="sep"></span>p. ' +
           ((pos ? pos.p : 0) + 1) + '/' + c.hit.c.pages.length;
  } else {
    const hue = ((c.doc.vol != null ? c.doc.vol : 3) * 47) % 360;
    face = '<div class="th vol" style="--h:' + hue + '">' + artTag(c.a) +
           '<span class="vtint"></span>' +
           '<span class="vlabel">' + (c.doc.vol != null ? 'Tome ' + c.doc.vol : esc(c.doc.title)) + '</span>';
    name = c.a.title;
    meta = (c.doc.vol != null ? esc(c.doc.title) : esc(c.doc.ext.toUpperCase())) +
           '<span class="sep"></span>' + Math.round(pct) + ' %';
  }
  return '<div class="tile resume" tabindex="0" ' + tgt.attr + '="' + esc(tgt.val) + '">' +
      face +
      '<div class="veil"></div><div class="play"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg></div>' +
      '<div class="tags">' +
        (c.kind === 'ep' && c.ep.play === 'ts' ? '<span class="tag ts">.ts</span>' : '') +
        (c.kind === 'scan' ? '<span class="tag kind">Scan</span>' : '') +
        (c.kind === 'doc'  ? '<span class="tag kind">Lecture</span>' : '') +
      '</div>' +
      (pct > 0 ? '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' : '') +
    '</div>' +
    '<div class="tbody">' +
      '<div class="tname">' + esc(name) + '</div>' +
      '<div class="tmeta">' + meta + '</div>' +
    '</div>' + broom + '</div>';
}

function tileHTML(e){
  const a = S.byKey.get(e.anime);
  const p = getProgress(e);
  const pct = p && p.d ? Math.min(100, p.t / p.d * 100) : 0;
  const season = a && a.seasonList.length > 1 ? seasonLabel(e.seasonKey) + ' · ' : '';
  return '<div class="tile" tabindex="0" data-play="' + esc(e.rel) + '">' +
    '<div class="th' + classeSpoil(e) + '" data-thumb="' + esc(e.rel) + '">' +
      '<div class="ph">' + (e.ep != null ? esc(e.ep) : '▶') + '</div>' +
      '<div class="veil"></div><div class="play"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg></div>' +
      '<div class="tags">' +
        (e.play === 'ts' ? '<span class="tag ts">.ts</span>' : '') +
        (S.freshSet && S.freshSet.has(e.rel) ? '<span class="tag new">Nouveau</span>' : '') +
        (p && p.done ? '<span class="tag done">Vu</span>' : '') +
      '</div>' +
      (pct > 0 ? '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' : '') +
    '</div>' +
    '<div class="tbody">' +
      '<div class="tname">' + esc(a ? a.title : e.anime) + '</div>' +
      '<div class="tmeta">' + esc(season) + (e.ep != null ? 'Ép. ' + e.ep : esc(titreEpisode(e))) +

        '<span class="sep"></span>' + fmtSize(e.size) + '</div>' +
    '</div></div>';
}

/** Ce que contient une fiche sans episode: des edits, des chapitres, ou les
    deux. Annoncer « 0 edit » sur une serie de scans n'aurait rien voulu dire. */
function statsSansEpisode(a){
  const bouts = [];
  if (a.edits.length) bouts.push(fmtCount(a.edits.length,'edit','edits'), fmtSize(a.editSize));
  if (hasReading(a))  bouts.push(fmtCount(docsTotal(a),'chapitre','chapitres'));
  if (!bouts.length)  bouts.push('vide');
  return bouts.map(b => '<span>' + esc(b) + '</span>').join('<span class="sep"></span>');
}

/* ---------------------------------------------------------- série --- */
function renderAnime(key){
  const a = S.byKey.get(key);
  if (!a){ S.view = 'home'; return renderHome(); }
  const view = $('#view-anime'); view.hidden = false;
  // une oeuvre sans episode garde sa fiche — jaquette, note, categories, et les
  // boutons qui menent au fil des edits et aux scans. Il n'y a simplement ni
  // saison ni liste d'episodes a montrer.
  const sansEp    = !a.seasonList.length;
  const seasonKey = sansEp ? null
    : (S.seasonKey != null && a.seasons.has(S.seasonKey) ? S.seasonKey : saisonEnCours(a));

  const season    = sansEp ? null : a.seasons.get(seasonKey);
  const next = nextUnwatched(a);
  const initials = a.title.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();

  view.innerHTML =
    '<div class="dhero">' +
      '<div class="dhero-bg">' + artTag(a, true) + '</div>' +
      '<button class="backbtn" data-go="home">‹ Retour</button>' +
      '<div class="dtop">' +
        '<div class="dposter">' + (a.art ? artTag(a) :
            '<div class="ph" style="display:grid;place-items:center;height:100%;font-size:2.2rem;font-weight:800;color:rgba(255,255,255,.14)">' + esc(initials) + '</div>') + '</div>' +
        '<div class="dinfo">' +
          '<h1>' + esc(a.title) + '</h1>' +
          '<div class="dstats">' +
            (sansEp
              ? statsSansEpisode(a)
              : '<span>' + fmtCount(a.seasonList.length,'saison','saisons') + '</span><span class="sep"></span>' +
                '<span>' + fmtCount(a.episodes.length,'épisode','épisodes') + '</span><span class="sep"></span>' +
                '<span>' + fmtSize(a.size) + '</span>') +
            metaChips(a) +
            (a.tsCount ? '<span class="chip ts">' + a.tsCount + ' fichiers .ts</span>' : '') +
          '</div>' +
          noteBoxHTML(a) +
          descHTML(a) +
          '<div class="cats" id="catBox"></div>' +
          '<div class="dactions">' +
            (next ? '<button class="btn btn-light" data-play="' + esc(next.rel) + '">' +
              '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg>Lecture</button>' : '') +
            (a.edits.length ? '<button class="btn btn-ghost" data-edits="' + esc(a.key) + '">' +
               '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>' +
               fmtCount(a.edits.length, 'edit', 'edits') + '</button>' : '') +
            (hasReading(a) ? '<button class="btn btn-ghost" data-docs="' + esc(a.key) + '">' +
               '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M13 3v5h5"/></svg>' +
               esc(readingLabels(a).join(' · ')) + '</button>' : '') +
            favButtonHTML(a.key) +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    (a.seasonList.length > 1 ? '<div class="seasons">' + a.seasonList.map(s =>
        '<button class="sbtn' + (s.key === seasonKey ? ' on' : '') + '" data-season="' + esc(s.key) + '">' +
        esc(s.label) + '<small>' + s.eps.length + '</small></button>').join('') + '</div>' : '') +
    (sansEp ? '' : '<div class="eplist">' + season.eps.map(epHTML).join('') + '</div>');

  paintCats(a);
  // pas de scrollIntoView ici: la navigation remonte déjà la page, et un simple
  // changement de saison doit laisser la vue exactement où elle est
  $$('[data-season]', view).forEach(b => b.addEventListener('click', () => {
    S.seasonKey = b.dataset.season; renderAnime(key); hydrate();
  }));
}

/* ------------------------------------------------- page light novel - */
/** Intitulé global: « Light novel » s'il n'y a qu'un type de collection. */
function readingLabels(a){
  return [...a.docGroups.map(g => g.label), ...a.scanGroups.map(g => g.label)];
}
function docsLabel(){
  const labels = new Set();
  for (const a of S.animes) readingLabels(a).forEach(l => labels.add(l));
  return labels.size === 1 ? [...labels][0] : 'Lectures';
}
function docsTotal(a){
  return a.docGroups.reduce((n,g) => n + g.volumes.length + g.loose.length, 0) +
         a.scanGroups.reduce((n,g) => n + g.chapters.length, 0);
}
function hasReading(a){ return a.docGroups.length > 0 || a.scanGroups.length > 0; }
/* Une serie sans le moindre episode ne se regarde pas: elle ne vit que dans
   l'onglet de lecture. L'ecarter des rangees et de la liste des series evite
   une vignette qui promet une video dont il n'existe aucun fichier. */
/* Une oeuvre qui n'a que des edits se regarde quand meme: elle reste dans la
   liste des series. Celle qui a des scans, elle, vit deja dans l'onglet de
   lecture — l'y montrer deux fois n'aiderait personne. */
function hasVideo(a){ return a.episodes.length > 0 || (a.edits.length > 0 && !hasReading(a)); }
function videoSeries(){ return S.animes.filter(hasVideo); }

/** Section d'une collection de scans: grille de chapitres, couverture = 1re page. */
function scanSectionHTML(a, g){
  return '<section class="docsec">' +
    '<div class="row-head"><h2>' + esc(g.label) + '</h2>' +
      '<span class="cnt">' + fmtCount(g.chapters.length,'chapitre','chapitres') +
      ' · ' + fmtCount(g.pageCount,'page','pages') + '</span></div>' +
    '<div class="volgrid">' + g.chapters.map(c => chapCardHTML(a, g, c)).join('') + '</div>' +
  '</section>';
}
function chapSpec(a, g, c){ return a.key + '|' + g.key + '|' + c.key; }
function chapCardHTML(a, g, c){
  const spec = chapSpec(a, g, c);
  const seen = getScanPos(spec);
  const pct  = seen ? Math.min(100, (seen.p + 1) / c.pages.length * 100) : 0;
  const done = pct > 96;
  return '<button class="volc" data-scan="' + esc(spec) + '">' +
    '<span class="vcover scan">' +
      '<img data-cover="' + esc(spec) + '" alt="">' +
      '<span class="vfmt">' + c.pages.length + ' p.</span>' +
      (done ? '<span class="vdone">Lu</span>' : '') +
      (pct > 0 && !done ? '<span class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></span>' : '') +
    '</span>' +
    '<span class="vmeta"><b>' + esc(c.title) + '</b>' +
      '<em>' + (seen != null && !done ? 'page ' + (seen + 1) + ' / ' + c.pages.length : fmtCount(c.pages.length,'page','pages')) + '</em>' +
    '</span></button>';
}
function findChapter(spec){
  const [aKey, gKey, cKey] = String(spec).split('|');
  const a = S.byKey.get(aKey);
  if (!a) return null;
  const g = a.scanGroups.find(x => x.key === gKey);
  if (!g) return null;
  const i = g.chapters.findIndex(x => x.key === cKey);
  return i < 0 ? null : { a, g, c: g.chapters[i], index: i };
}
/** Page dédiée: une série précise, ou l'index de toutes celles qui ont des documents. */
function renderDocs(key){
  const view = $('#view-docs'); view.hidden = false;
  const a = key ? S.byKey.get(key) : null;

  if (!a){
    const list = sortReading(S.animes.filter(hasReading), S.filter.docSort);
    view.innerHTML = '<div class="pagehead split">' +
        '<div class="ph-tx"><h1>' + esc(docsLabel()) + '</h1>' +
        '<p>' + fmtCount(list.length, 'série', 'séries') + ' avec des documents à lire</p></div>' +
        (list.length > 1 ? filterBarHTML('docSort', DOC_SORTS) : '') +
      '</div>' +
      (list.length
        ? '<div class="gridview posters">' + list.map(docPosterHTML).join('') + '</div>'
        : '<div class="empty"><div class="big">📚</div><b>Aucun document</b>Range des PDF, EPUB ou Markdown dans un dossier de série.</div>');
    wireFilters(view, () => { renderDocs(null); hydrate(); });
    return;
  }

  const initials = a.title.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
  view.innerHTML =
    '<div class="dhero">' +
      '<div class="dhero-bg">' + artTag(a, true) + '</div>' +
      // toute serie a desormais une fiche, y compris celle qui n'a que des
      // scans: le retour y remonte plutot qu'a l'index des lectures.
      '<button class="backbtn" data-anime="' + esc(a.key) + '">‹ ' + esc(a.title) + '</button>' +
      '<div class="dtop">' +
        '<div class="dposter">' + (a.art ? artTag(a) :
          '<div class="ph" style="display:grid;place-items:center;height:100%;font-size:2.2rem;font-weight:800;color:rgba(255,255,255,.14)">' + esc(initials) + '</div>') + '</div>' +
        '<div class="dinfo">' +
          '<h1>' + esc(readingLabels(a).join(' · ')) + '</h1>' +
          '<div class="dstats"><span>' + esc(a.title) + '</span><span class="sep"></span>' +
            '<span>' + fmtCount(docsTotal(a), 'document', 'documents') + '</span></div>' +
          descHTML(a) +
          noteBoxHTML(a) +
        '</div>' +
      '</div>' +
    '</div>' +
    a.docGroups.map(g => docSectionHTML(a, g)).join('') +
    a.scanGroups.map(g => scanSectionHTML(a, g)).join('');

  wireFormatSwitches(view, a, key);
  hydratePeeks(view);
  hydrateCovers(view);
}
function docPosterHTML(a){
  const initials = a.title.split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
  return '<div class="tile poster" tabindex="0" data-docs="' + esc(a.key) + '">' +
    '<div class="th"><div class="ph">' + esc(initials) + '</div>' +
      artTag(a) +
      '<div class="veil"></div>' +
      '<div class="tags">' + (a.docGroups[0] ? a.docGroups[0].formats : ['scan'])
          .map(e => '<span class="tag">' + esc(e.toUpperCase()) + '</span>').join('') + '</div>' +
      noteMarkHTML(a) +
    '</div>' +
    '<div class="tbody"><div class="tname">' + esc(a.title) + '</div>' +
      '<div class="tmeta">' + esc(readingLabels(a).join(' · ')) + '<span class="sep"></span>' +
      fmtCount(docsTotal(a), 'élément', 'éléments') + '</div></div></div>';
}
/** Le changement de format ne redessine que la page documents, sans bouger la vue. */
function wireFormatSwitches(view, a, key){
  $$('[data-fmt]', view).forEach(b => b.addEventListener('click', () => {
    store.set('fmt.' + a.key + '.' + b.dataset.group, b.dataset.fmt);
    const y = window.scrollY;
    renderDocs(key);
    hydrate();
    window.scrollTo(0, y);
  }));
}

/** Section d'une collection: en-tête, sélecteur de format, grille de tomes. */
function docSectionHTML(a, g){
  const fmt = pickFormat(a, g);
  const cards = g.volumes.map(v => volCardHTML(a, g, v, fmt)).join('');
  const others = g.loose.map(d => looseCardHTML(a, d)).join('');
  const count = g.volumes.length
    ? fmtCount(g.volumes.length, 'tome', 'tomes') + (g.loose.length ? ' + ' + g.loose.length : '')
    : fmtCount(g.loose.length, 'fichier', 'fichiers');

  return '<section class="docsec">' +
    '<div class="row-head">' +
      '<h2>' + esc(g.label) + '</h2><span class="cnt">' + esc(count) + '</span>' +
      (g.formats.length > 1 ? '<div class="fmtsw">' + g.formats.map(e =>
        '<button data-fmt="' + esc(e) + '" data-group="' + esc(g.key) + '"' +
        (e === fmt ? ' class="on"' : '') + '>' + esc(e.toUpperCase()) + '</button>').join('') + '</div>' : '') +
    '</div>' +
    '<div class="volgrid">' + cards + others + '</div>' +
  '</section>';
}
function pickFormat(a, g){
  const saved = store.get('fmt.' + a.key + '.' + g.key, null);
  return g.formats.includes(saved) ? saved : g.formats[0];
}

/** Couverture de tome: jaquette de la série floutée, teintée par numéro de volume. */
function volCardHTML(a, g, v, fmt){
  const doc  = v.byExt[fmt] || v.byExt[g.formats.find(e => v.byExt[e])];
  const has  = !!v.byExt[fmt];
  const peek = v.byExt.md || v.byExt.txt;         // le texte du tome, quel que soit le format affiché
  const hue  = (v.vol * 47) % 360;
  return '<button class="volc" data-doc="' + esc(doc.rel) + '">' +
    '<span class="vcover" style="--h:' + hue + '">' +
      artTag(a) +
      '<span class="vtint"></span>' +
      '<span class="vseries">' + esc(a.title) + '</span>' +
      '<span class="vn">' + v.vol + '</span>' +
      '<span class="vword">Volume</span>' +
      '<span class="vfmt' + (has ? '' : ' alt') + '">' + esc(doc.ext.toUpperCase()) + '</span>' +
    '</span>' +
    '<span class="vmeta"><b>' + esc(v.title) + '</b>' +
      '<em' + (peek ? ' data-peek="' + esc(peek.rel) + '"' : '') + '>' + fmtSize(doc.size) + '</em></span>' +
  '</button>';
}
function looseCardHTML(a, d){
  return '<button class="volc" data-doc="' + esc(d.rel) + '">' +
    '<span class="vcover" style="--h:210">' +
      artTag(a) +
      '<span class="vtint"></span>' +
      '<span class="vseries">' + esc(a.title) + '</span>' +
      '<span class="vn small">' + esc(d.ext.toUpperCase()) + '</span>' +
      '<span class="vfmt">' + fmtSize(d.size) + '</span>' +
    '</span>' +
    '<span class="vmeta"><b>' + esc(d.title) + '</b><em></em></span>' +
  '</button>';
}

/* Aperçu textuel: on ne lit que le début du fichier Markdown du tome. */
function firstProse(text){
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let head = '';
  for (const raw of lines){
    const l = raw.trim();
    if (!l || /^[-*_=]{3,}$/.test(l)) continue;
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h){ head = h[1].replace(/[*_`#]/g, '').trim(); continue; }
    const body = l.replace(/^&gt;\s*|^>\s*/, '').replace(/[*_`]/g, '').trim();
    if (body.length < 25) continue;
    return { head, body: body.slice(0, 160) };
  }
  return { head, body: '' };
}
async function peekDoc(rel){
  const cached = store.get('pk.' + rel, null);
  if (cached) return cached;
  const hit = findDoc(rel);
  if (!hit) return null;
  let text = '';
  try {
    const f = await fileOf(hit.doc);
    if (f) text = await f.slice(0, 6000).text();
    else if (hit.doc.ref && hit.doc.ref.kind === 'url'){
      const r = await fetch(hit.doc.ref.url, { headers:{ Range:'bytes=0-5999' } });
      text = await r.text();
    }
  } catch(e){ return null; }
  if (!text) return null;
  const snip = firstProse(text);
  store.set('pk.' + rel, snip);
  return snip;
}
/** Remplit les aperçus, quatre fichiers à la fois. */
async function hydratePeeks(root){
  const targets = $$('[data-peek]', root).filter(el => !el.dataset.peeked);
  targets.forEach(el => { el.dataset.peeked = '1'; });
  let i = 0;
  const worker = async () => {
    while (i < targets.length){
      const el = targets[i++];
      const snip = await peekDoc(el.dataset.peek);
      if (!snip || (!snip.head && !snip.body)) continue;
      const size = el.textContent;
      if (snip.head) el.innerHTML = '<span class="pkhead">' + esc(snip.head) + '</span> · ' + esc(size);
      if (snip.body) el.closest('.volc').title = snip.body + '…';
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

function epHTML(e){
  const p = getProgress(e);
  const pct = p && p.d ? Math.min(100, p.t / p.d * 100) : 0;
  const left = p && p.d && !p.done && p.t > 20 ? ' · ' + fmtTime(p.d - p.t) + ' restantes' : '';
  return '<div class="ep" tabindex="0" data-play="' + esc(e.rel) + '">' +
    '<div class="num">' + (e.ep != null ? esc(e.ep) : '•') + '</div>' +
    '<div class="epth' + classeSpoil(e) + '" data-thumb="' + esc(e.rel) + '">' +
      (pct > 0 ? '<div class="bar" style="z-index:2"><i style="width:' + pct.toFixed(1) + '%"></i></div>' : '') +
    '</div>' +
    '<div class="epinfo"><b>' + esc(titreEpisode(e)) + '</b>' +
      '<div class="sub">' + fmtSize(e.size) + '<span class="sep"></span><span class="mono">.' + esc(e.ext) + '</span>' +
      (e.play === 'ts' ? '<span class="chip ts">MPEG-TS</span>' : '') +
      (p && p.done ? '<span class="chip">Vu</span>' : '') + esc(left) + '</div>' +
    '</div>' +
    rateHTML('e:' + e.rel) +
    '<div class="go"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg></div>' +
    '</div>';
}

/* ------------------------------------------------- listes / recherche */
/**
 * Cherche à la fois dans les catégories et dans les séries.
 * Taper « action » remonte donc la catégorie Action avec tout ce qu'elle contient.
 * Les épisodes ne sont pas cherchés: ils portent tous le même nom.
 */
/* ------------------------------------------------ recherche tolerante
 * Accents et majuscules ignores, fautes de frappe tolerees (une lettre sur un
 * mot court, deux sur un long), debut de mot accepte (« shing »), et l'on
 * cherche aussi dans les categories et la description: « attaque des titans »
 * trouve Shingeki no Kyojin par les « Titans » de son resume. Le titre compte
 * plus que la description; les resultats sont ranges par pertinence.
 */
const MOTS_VIDES = new Set(['de','des','du','la','le','les','l','d','un','une','et','a','au','aux','en',
                            'the','of','an','and','in','on']);
function normaliserTexte(t){
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function distanceEdition(a, b, max){
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prec = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++){
    const cour = [i];
    let mini = i;
    for (let k = 1; k <= b.length; k++){
      cour[k] = Math.min(prec[k] + 1, cour[k - 1] + 1, prec[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      if (cour[k] < mini) mini = cour[k];
    }
    if (mini > max) return max + 1;
    prec = cour;
  }
  return prec[b.length];
}
/** Ce que vaut un mot cherche face aux mots d'un texte: 1 exact, moins si approche, 0 sinon. */
function accordMot(jeton, mots){
  let meilleur = 0;
  const tol = jeton.length >= 7 ? 2 : jeton.length >= 4 ? 1 : 0;
  for (const m of mots){
    if (m === jeton) return 1;
    if (jeton.length >= 3 && m.startsWith(jeton)) meilleur = Math.max(meilleur, .9);
    else if (jeton.length >= 4 && m.includes(jeton)) meilleur = Math.max(meilleur, .7);
    else if (tol && distanceEdition(jeton, m, tol) <= tol) meilleur = Math.max(meilleur, .75);
  }
  return meilleur;
}
function searchLibrary(q){
  const brut = normaliserTexte(q);
  if (!brut) return { cats: [], series: [] };
  const jetons = brut.split(' ').filter(m => m && !MOTS_VIDES.has(m));
  if (!jetons.length) jetons.push(...brut.split(' '));
  const besoin = Math.ceil(jetons.length / 2);

  const byCat = new Map();
  for (const a of S.animes) for (const c of catsOf(a.key)){
    const nc = normaliserTexte(c), mots = nc.split(' ');
    if (!nc.includes(brut) && !jetons.every(j => accordMot(j, mots) >= .75)) continue;
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(a);
  }
  const cats = [...byCat.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((x,y) => y.items.length - x.items.length || naturalCompare(x.label, y.label));

  const trouves = [];
  for (const a of S.animes){
    const titre = normaliserTexte(a.title + ' ' + a.key);
    const champs = [
      [3, titre.split(' ')],
      [1.5, normaliserTexte(catsOf(a.key).join(' ') + ' ' + [a.lang, a.subs, a.quality].filter(Boolean).join(' ')).split(' ')],
      [1, normaliserTexte(descOf(a.key)).split(' ')]
    ];
    let score = titre.includes(brut) ? 10 : 0, accordes = 0;
    for (const j of jetons){
      let mieux = 0;
      for (const [poids, mots] of champs) mieux = Math.max(mieux, poids * accordMot(j, mots));
      if (mieux > 0){ accordes++; score += mieux; }
    }
    if (score >= 10 || accordes >= besoin) trouves.push({ a, score });
  }
  trouves.sort((x, y) => y.score - x.score || naturalCompare(x.a.title, y.a.title));
  return { cats, series: trouves.map(t => t.a) };
}

/* ------------------------------------------------- filtres séries --- */
/* Onze séries et cinq cents épisodes: l'ordre alphabétique seul ne suffit plus.
   Les choix vivent en mémoire — ils survivent à la navigation, pas au rechargement. */
const SORTS = [
  ['note',    'Note'],
  ['az',      'A → Z'],
  ['recent',  'Ajout récent'],
  ['watched', 'Vu récemment'],
  ['eps',     'Nombre d’épisodes'],
  ['size',    'Taille']
];
function lastWatched(a){
  let at = 0;
  for (const e of a.episodes){ const p = getProgress(e); if (p && p.at > at) at = p.at; }
  return at;
}
function addedAt(a){
  let at = 0;
  for (const e of a.episodes) if (e.added > at) at = e.added;
  return at;
}
function sortSeries(list, sort, lastOf){
  const l = list.slice();
  if (sort === 'recent')  return l.sort((x,y) => addedAt(y) - addedAt(x) || naturalCompare(x.title,y.title));
  if (sort === 'watched') return l.sort((x,y) => lastOf(y) - lastOf(x) || naturalCompare(x.title,y.title));
  if (sort === 'eps')     return l.sort((x,y) => y.episodes.length - x.episodes.length || naturalCompare(x.title,y.title));
  if (sort === 'size')    return l.sort((x,y) => y.size - x.size || naturalCompare(x.title,y.title));
  if (sort === 'note')    return l.sort((x,y) => noteTri(y) - noteTri(x) || naturalCompare(x.title,y.title));
  return l.sort((x,y) => naturalCompare(x.title, y.title));
}
/* Les lectures se trient elles aussi, et pas selon les memes criteres qu'une
   serie a regarder: ni taille ni nombre d'episodes, mais des chapitres et une
   derniere page ouverte. La barre prend donc son champ et sa liste. */
const DOC_SORTS = [
  ['note',     'Note'],
  ['az',       'A → Z'],
  ['recent',   'Ajout récent'],
  ['read',     'Lu récemment'],
  ['chapters', 'Nombre de chapitres']
];
function lastRead(a){
  let at = 0;
  for (const d of a.docs){ const p = getReadPos(d.rel); if (p && p.at > at) at = p.at; }
  for (const g of a.scanGroups || []) for (const c of g.chapters){
    const p = getScanPos(chapSpec(a, g, c));
    if (p && p.at > at) at = p.at;
  }
  return at;
}
function sortReading(list, sort){
  const l = list.slice();
  if (sort === 'note')     return l.sort((x,y) => noteTri(y) - noteTri(x) || naturalCompare(x.title,y.title));
  if (sort === 'recent')   return l.sort((x,y) => (y.added||0) - (x.added||0) || naturalCompare(x.title,y.title));
  if (sort === 'read')     return l.sort((x,y) => lastRead(y) - lastRead(x) || naturalCompare(x.title,y.title));
  if (sort === 'chapters') return l.sort((x,y) => docsTotal(y) - docsTotal(x) || naturalCompare(x.title,y.title));
  return l.sort((x,y) => naturalCompare(x.title, y.title));
}
function filterBarHTML(champ, sorts){
  const courant = S.filter[champ];
  return '<div class="filters">' +
    '<label class="fsel"><span>Trier par</span><select data-f="' + esc(champ) + '">' +
      sorts.map(([val, txt]) =>
        '<option value="' + esc(val) + '"' + (val === courant ? ' selected' : '') + '>' +
        esc(txt) + '</option>').join('') +
    '</select></label></div>';
}
function wireFilters(root, apres){
  $$('[data-f]', root).forEach(s => s.addEventListener('change', () => {
    S.filter[s.dataset.f] = s.value;
    if (apres) apres(); else { renderList('all'); hydrate(); }
  }));
}

/* La page d'un episode: lui en haut, et les edits qui le montrent. On y
   arrive en touchant l'episode affiche sous l'oeuvre dans le fil d'edits. */
function renderEpisode(rel){
  const view = $('#view-list'); view.hidden = false;
  const ep = findEp(rel), a = ep && S.byKey.get(ep.anime);
  if (!ep || !a){ S.view = 'home'; view.hidden = true; return renderHome(); }
  const p = getProgress(ep), edits = editsDeLEpisode(ep);
  const LIRE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg>';
  view.innerHTML =
    '<div class="pagehead epage">' +
      '<div><button class="backbtn" data-anime="' + esc(a.key) + '">‹ ' + esc(a.title) + '</button></div>' +
      '<div class="epage-haut">' +
        '<div class="epage-th' + classeSpoil(ep) + '" data-thumb="' + esc(ep.rel) + '"></div>' +
        '<div class="epage-info">' +
          '<div class="epage-k">' + esc(a.title + ' · ' + nomCourtEpisode(ep)) + '</div>' +
          '<h1>' + esc(titreEpisode(ep)) + '</h1>' +
          '<div class="epage-meta">' +
            (p && p.done ? '<span class="chip">Vu</span>' : p && p.t > 20 ? '<span class="chip">En cours</span>' : '') +
            rateHTML('e:' + ep.rel) + '</div>' +
          '<div class="hero-actions">' +
            '<button class="btn btn-light" data-play="' + esc(ep.rel) + '">' + LIRE + 'Lecture</button>' +
            (edits.length ? '<button class="btn btn-ghost" data-edits-ep="' + esc(ep.rel) + '">⚡ ' +
              fmtCount(edits.length, 'edit', 'edits') + ' de l’épisode</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    (edits.length
      ? '<section class="searchsec"><div class="row-head"><h2>Edits de cet épisode</h2><span class="cnt">' +
          fmtCount(edits.length, 'edit', 'edits') + '</span></div><div class="ep-edits">' +
          edits.map(x => '<button class="ep-edit" data-edits-ep="' + esc(ep.rel) + '" data-depuis="' + esc(x.rel) + '">' +
            LIRE + esc(x.title) + '</button>').join('') + '</div></section>'
      : '<div class="empty"><b>Aucun edit rangé sur cet épisode</b>Les edits se rangent par épisode dans annoter-edits.html.</div>');
}

/* La saison ouverte par defaut sur la fiche d'une serie: celle ou l'on en
   est. Le dernier episode regarde, ou celui qui le suit s'il est fini; la
   premiere saison si l'on n'a rien commence, ou si tout est vu. */
function saisonEnCours(a){
  let dernier = null, at = 0;
  for (const e of a.episodes){ const p = getProgress(e); if (p && p.at > at){ at = p.at; dernier = e; } }
  if (!dernier) return a.seasonList[0].key;
  const p = getProgress(dernier);
  const cible = p.done ? a.episodes.find(e => e.idx > dernier.idx && !(getProgress(e) || {}).done) : dernier;
  return cible ? cible.seasonKey : a.seasonList[0].key;
}

function renderList(kind){

  const view = $('#view-list'); view.hidden = false;

  if (kind === 'search'){
    const { cats, series } = searchLibrary(S.query);
    const bits = [];
    if (cats.length)   bits.push(fmtCount(cats.length, 'catégorie', 'catégories'));
    if (series.length) bits.push(fmtCount(series.length, 'série', 'séries'));

    const section = (head, items) =>
      '<section class="searchsec"><div class="row-head">' + head +
        '<span class="cnt">' + fmtCount(items.length,'série','séries') + '</span></div>' +
        '<div class="gridview posters">' + items.map(a => posterHTML(a)).join('') + '</div></section>';

    view.innerHTML = '<div class="pagehead"><h1>Résultats pour « ' + esc(S.query) + ' »</h1>' +
      '<p>' + esc(bits.join(' · ') || 'aucun résultat') + '</p></div>' +
      cats.map(c => section('<span class="catlabel">Catégorie</span><h2>' + esc(c.label) + '</h2>', c.items)).join('') +
      (series.length ? section('<h2>Séries</h2>', series) : '') +
      (!cats.length && !series.length
        ? '<div class="empty"><div class="big">🔍</div><b>Rien trouvé</b>Essaie un nom de série ou de catégorie.</div>' : '');
    return;
  }
  /* « Tout » ne trie rien: les séries à regarder, les collections de scans et
     les recueils de documents cohabitent. Chaque vignette sait déjà où elle
     mène — posterHTML pose data-anime sur ce qui se regarde et data-docs sur ce
     qui se lit — donc un clic tombe sur la bonne page sans rien de plus ici. */
  const tout = kind === 'tout';
  const list = sortSeries(tout ? S.animes : videoSeries(), S.filter.sort, lastWatched);
  const nEp   = list.reduce((n,a) => n + a.episodes.length, 0);
  const nLect = tout ? list.filter(hasReading).length : 0;
  const bouts = [fmtCount(list.length,'série','séries')];
  if (nEp)   bouts.push(fmtCount(nEp,'épisode','épisodes'));
  if (nLect) bouts.push(fmtCount(nLect,'à lire','à lire'));
  const sub = bouts.join(' · ');
  view.innerHTML =
    '<div class="pagehead split">' +
      '<div class="ph-tx"><h1>' + (tout ? 'Tout' : 'Toutes les séries') +
        '</h1><p>' + esc(sub) + '</p></div>' +
      filterBarHTML('sort', SORTS) +
    '</div>' +
    (list.length
      ? '<div class="gridview posters">' + list.map(a => posterHTML(a)).join('') + '</div>'
      : '<div class="empty"><div class="big">🔍</div><b>Aucune série ne correspond</b>Retire un filtre pour élargir.</div>');
  wireFilters(view);
}

/* ------------------------------------------------------ interactions */
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-ep-page],[data-edits-ep],[data-rate-n],[data-forget],[data-fav],[data-play],[data-anime],[data-go],[data-rail],[data-doc],[data-docs],[data-scan],[data-edits],[data-edits-tous]');
  if (!t) return;
  // la page d'un episode (depuis le fil d'edits), et le fil des edits d'un episode
  if (t.dataset.epPage){
    if (!ED.hidden) closeEdits();
    S.view = 'episode'; S.epRel = t.dataset.epPage; S.query = ''; $('#q').value = '';
    render(); scrollTo(0, 0); return;
  }
  if (t.dataset.editsEp){ openEditsEpisode(t.dataset.editsEp, t.dataset.depuis); return; }

  // les etoiles vivent dans une ligne d'episode, elle-meme cliquable: la note
  // se pose sans lancer la lecture
  if (t.dataset.rateN !== undefined){
    ev.preventDefault(); ev.stopPropagation();
    poserNote(t);
    return;
  }
  if (t.dataset.forget !== undefined){
    ev.preventDefault(); ev.stopPropagation();
    const gone = forgetResume(t.dataset.forget);
    if (gone){
      const a = S.byKey.get(gone.key);
      toastAction('Avancement de ' + (a ? a.title : gone.key) + ' oublié',
                  'Annuler', () => { undoForget(); render(); });
    }
    render();
    return;
  }
  if (t.dataset.fav !== undefined){
    ev.preventDefault(); ev.stopPropagation();
    const key = t.dataset.fav;
    setFav(key, !isFav(key));
    render();
    return;
  }
  if (t.dataset.rail){
    const rail = t.parentElement.querySelector('.rail');
    rail.scrollBy({ left: parseInt(t.dataset.rail,10) * (rail.clientWidth * 0.82), behavior:'smooth' });
    return;
  }
  if (t.dataset.play) { const e = findEp(t.dataset.play); if (e) openPlayer(e); return; }
  if (t.dataset.doc)  { openDoc(t.dataset.doc); return; }
  if (t.dataset.scan) { openScan(t.dataset.scan); return; }
  if (t.dataset.edits){ openEdits(t.dataset.edits); return; }
  if (t.dataset.editsTous !== undefined){ openEditsTous(); return; }
  if (t.dataset.docs !== undefined){
    S.view = 'docs'; S.docKey = t.dataset.docs || null;
    S.query = ''; $('#q').value = '';
    render(); window.scrollTo(0, 0); return;
  }
  if (t.dataset.anime){
    if (!ED.hidden) closeEdits();          // le nom de l'œuvre, cliqué depuis le fil
    S.view = 'anime'; S.animeKey = t.dataset.anime; S.seasonKey = null;
    S.query = ''; $('#q').value = ''; render(); window.scrollTo(0,0); return;
  }
  if (t.dataset.go)   { S.view = t.dataset.go; S.query = ''; $('#q').value = ''; render(); window.scrollTo(0,0); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.matches('.tile,.ep')) { ev.target.click(); ev.preventDefault(); }
});
function findEp(rel){
  for (const a of S.animes) for (const e of a.episodes) if (e.rel === rel) return e;
  return null;
}
/**
 * Rangées horizontales.
 * La molette verticale n'est JAMAIS détournée: elle fait monter/descendre la page,
 * même au-dessus d'un épisode. Pour se déplacer dans une rangée: les flèches,
 * un cliqué-glissé, Maj+molette, ou un geste horizontal de pavé tactile.
 */
function wireRows(root){
  $$('.rail', root).forEach(rail => {
    rail.addEventListener('wheel', (ev) => {
      if (!ev.shiftKey) return;                       // sinon: défilement vertical normal
      if (rail.scrollWidth <= rail.clientWidth) return;
      ev.preventDefault();
      rail.scrollBy({ left: (ev.deltaY || ev.deltaX) * 1.2 });
    }, { passive:false });

    // cliqué-glissé horizontal, sans déclencher la lecture au relâchement
    let drag = null;
    rail.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.pointerType === 'touch') return;
      drag = { x: ev.clientX, left: rail.scrollLeft, moved: false, id: ev.pointerId };
    });
    rail.addEventListener('pointermove', (ev) => {
      if (!drag || drag.id !== ev.pointerId) return;
      const dx = ev.clientX - drag.x;
      if (!drag.moved){
        if (Math.abs(dx) < 6) return;
        drag.moved = true;
        rail.classList.add('dragging');
        rail.style.scrollBehavior = 'auto';
        try { rail.setPointerCapture(ev.pointerId); } catch(e){}
      }
      rail.scrollLeft = drag.left - dx;
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved;
      try { rail.releasePointerCapture(drag.id); } catch(e){}
      drag = null;
      rail.classList.remove('dragging');
      rail.style.scrollBehavior = '';
      if (moved){ rail.dataset.dragged = '1'; setTimeout(() => delete rail.dataset.dragged, 0); }
    };
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
    rail.addEventListener('click', (ev) => {
      if (rail.dataset.dragged){ ev.preventDefault(); ev.stopPropagation(); }
    }, true);

    rail.addEventListener('scroll', () => paintArrows(rail), { passive:true });
    paintArrows(rail);
  });
}
/** Masque la flèche d'un côté quand la rangée y est déjà au bout. */
function paintArrows(rail){
  const wrap = rail.parentElement;
  if (!wrap) return;
  const l = wrap.querySelector('.rail-btn.l'), r = wrap.querySelector('.rail-btn.r');
  const max = rail.scrollWidth - rail.clientWidth;
  if (l) l.disabled = rail.scrollLeft <= 2;
  if (r) r.disabled = max <= 2 || rail.scrollLeft >= max - 2;
}
addEventListener('resize', () => $$('.rail').forEach(paintArrows));
$('#q').addEventListener('input', (ev) => { S.query = ev.target.value.trim(); render(); });
function refresh(){
  if (S.mode === 'fs')        return scan();
  if (S.mode === 'http')      return autoDetect();
  return pickFolder();
}
$('#btnRefresh').addEventListener('click', refresh);
$('#btnFolder').addEventListener('click', pickFolder);
$('#btnPick').addEventListener('click', pickFolder);
addEventListener('scroll', () => $('#topbar').classList.toggle('solid', scrollY > 40), { passive:true });
addEventListener('keydown', (ev) => {
  // Ctrl+R recharge la page: ce n'est pas un « R » de rescan
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.matches('input,textarea,select')) return;
  if ($('#player').hidden && $('#reader').hidden && $('#edits').hidden){

    if (ev.key === '/' ){ ev.preventDefault(); $('#q').focus(); }
    if (ev.key === 'r' || ev.key === 'R'){ if (S.mode === 'fs' || S.mode === 'http') refresh(); }
  }
});
// nouveaux épisodes: on rescanne quand l'onglet revient au premier plan
let lastScan = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.mode !== 'fs' && S.mode !== 'http') return;
  if (Date.now() - lastScan < 8000 || !$('#player').hidden || !$('#reader').hidden) return;
  if (!$('#edits').hidden) return;             // rescanner sous le fil couperait la video
  lastScan = Date.now();
  refresh();
});

/* drag & drop d'un dossier */
const drop = $('#drop');
['dragenter','dragover'].forEach(t => addEventListener(t, (ev) => { ev.preventDefault(); drop && drop.classList.add('hot'); }));
['dragleave','drop'].forEach(t => addEventListener(t, (ev) => { ev.preventDefault(); if (ev.type === 'dragleave' && ev.relatedTarget) return; drop && drop.classList.remove('hot'); }));
addEventListener('drop', async (ev) => {
  ev.preventDefault();
  const items = [...(ev.dataTransfer ? ev.dataTransfer.items : [])];
  if (!items.length) return;
  const out = [];
  bar(20);
  for (const it of items){
    const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if (entry){ S.rootName = S.rootName || entry.name; await readEntry(entry, [], out); }
  }
  if (!out.length) return bar(0);
  S.mode = 'input'; S.pendingFiles = out.map(f => ({ ...f, path: f.path }));
  await scan();
});

$('#dirInput').addEventListener('change', async (ev) => {
  const list = [...ev.target.files];
  if (!list.length) return;
  S.mode = 'input';
  S.rootName = (list[0].webkitRelativePath || '').split('/')[0] || 'videos';
  S.pendingFiles = list.map(f => ({
    path: (f.webkitRelativePath || f.name).split('/').slice(1),
    size: f.size, lastModified: f.lastModified, ref: { kind:'file', file: f }
  }));
  await scan();
  toast('Astuce : utilise Chrome ou Edge pour que le dossier soit retrouvé tout seul au prochain lancement');
});

/* ------------------------------------------ vu / pas vu, a la main ---
 * Clic droit sur un episode (appui long sur un telephone): le marquer vu ou
 * non vu, ou tout marquer vu jusqu'a lui. C'est aussi ce qui libere les edits
 * annotes sur un episode regarde ailleurs, ou quitte avant la fin.
 *
 * « Non vu » n'efface pas la position: il en pose une neuve, a zero. Effacee,
 * bibliotheque.json la rendrait au rechargement suivant; datee de maintenant,
 * c'est elle qui gagne la fusion, et le fichier la perd a sa reecriture.
 */
function marquerVu(eps, vu){
  const avant = eps.map(e => [e, getProgress(e)]);
  const at = Date.now();
  for (const e of eps){
    const p = getProgress(e);
    const d = p && p.d ? p.d : 1;      // jamais lance: la duree est inconnue, seule la fraction compte
    store.set(progressKey(e), vu ? { t: d, d, done: true, at } : { t: 0, d, done: false, at });
    touched(e.anime);
  }
  flushProgress();
  return avant;
}
function retablirVu(avant){
  const at = Date.now();
  for (const [e, p] of avant)
    store.set(progressKey(e), p ? Object.assign({}, p, { at }) : { t: 0, d: 1, done: false, at });
  avant.forEach(([e]) => touched(e.anime));
  flushProgress();
  rafraichirVue();
}
function rafraichirVue(){
  const y = scrollY;
  render();
  scrollTo(0, y);
}
const CTX = document.createElement('div');
CTX.className = 'ctx'; CTX.id = 'ctxMenu'; CTX.hidden = true; CTX.setAttribute('role', 'menu');
document.body.appendChild(CTX);
let ctxEp = null, ctxOuvert = 0;
function fermerCtx(){ CTX.hidden = true; ctxEp = null; }
const ICO_VU = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const ICO_PASVU = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 8.5l7 7"/></svg>';
const ICO_JUSQUE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 3.5 3.5L14 9.5"/><path d="m10.5 16 1 1L20 8.5"/></svg>';
const ICO_LIRE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8-14 8z"/></svg>';
function ouvrirCtx(e, x, y){
  const a = S.byKey.get(e.anime);
  const p = getProgress(e);
  const vu = !!(p && p.done);
  const avant = a ? a.episodes.filter(x => x.idx <= e.idx) : [e];
  const reste = avant.filter(x => { const q = getProgress(x); return !(q && q.done); }).length;
  const season = a && a.seasonList.length > 1 ? seasonLabel(e.seasonKey) + ' · ' : '';
  ctxEp = e;
  ctxOuvert = performance.now();
  CTX.innerHTML =
    '<h5>' + esc((a ? a.title + ' · ' : '') + season + (e.ep != null ? 'Ép. ' + e.ep : e.title)) + '</h5>' +
    '<button role="menuitem" data-ctx="lire">' + ICO_LIRE + 'Lire</button>' +
    '<div class="ctx-trait"></div>' +
    (vu ? '<button role="menuitem" data-ctx="pasvu">' + ICO_PASVU + 'Marquer comme non vu</button>'
        : '<button role="menuitem" data-ctx="vu">' + ICO_VU + 'Marquer comme vu</button>') +
    // les edits qui montrent cet episode: seulement s'il y en a
    (editsDeLEpisode(e).length ? '<button role="menuitem" data-ctx="edits">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 3 5 13.5h6L10 21l9-11h-6z"/></svg>' +
      'Voir les edits de l’épisode<small>' + editsDeLEpisode(e).length + '</small></button>' : '') +
    (avant.length > 1 && reste > (vu ? 0 : 1)
      ? '<button role="menuitem" data-ctx="jusque">' + ICO_JUSQUE + 'Marquer vu jusqu\'ici<small>' +
        fmtCount(reste, 'épisode', 'épisodes') + '</small></button>' : '');
  CTX.hidden = false;
  const w = CTX.offsetWidth, h = CTX.offsetHeight;
  CTX.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  CTX.style.top  = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  const premier = CTX.querySelector('button');
  if (premier) premier.focus({ preventScroll: true });
}
document.addEventListener('contextmenu', (ev) => {
  const t = ev.target.closest('[data-play]');
  if (!t || t.tagName === 'BUTTON' || t.closest('#player')) return;
  const e = findEp(t.dataset.play);
  if (!e) return;
  ev.preventDefault();
  let x = ev.clientX, y = ev.clientY;
  if (!x && !y){ const r = t.getBoundingClientRect(); x = r.left + 24; y = r.top + r.height / 2; }   // touche Menu du clavier
  ouvrirCtx(e, x, y);
});
CTX.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ctx]');
  if (!b || !ctxEp) return;
  const e = ctxEp, a = S.byKey.get(e.anime), quoi = b.dataset.ctx;
  fermerCtx();
  if (quoi === 'lire'){ openPlayer(e); return; }
  if (quoi === 'edits'){ openEditsEpisode(e.rel); return; }

  let eps = [e];
  if (quoi === 'jusque' && a) eps = a.episodes.filter(x => x.idx <= e.idx && !(getProgress(x) || {}).done);
  const avant = marquerVu(eps, quoi !== 'pasvu');
  rafraichirVue();
  const msg = quoi === 'pasvu' ? 'Marqué comme non vu'
            : quoi === 'jusque' ? fmtCount(eps.length, 'épisode marqué vu', 'épisodes marqués vus')
            : 'Marqué comme vu';
  toastAction(msg, 'Annuler', () => retablirVu(avant));
});
document.addEventListener('pointerdown', (ev) => { if (!CTX.hidden && !CTX.contains(ev.target)) fermerCtx(); }, true);
// un defilement fait juste avant le clic droit arrive un instant apres: il ne ferme rien
addEventListener('scroll', () => { if (!CTX.hidden && performance.now() - ctxOuvert > 150) fermerCtx(); }, true);

addEventListener('resize', () => { if (!CTX.hidden) fermerCtx(); });
addEventListener('keydown', (ev) => {
  if (CTX.hidden) return;
  if (ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); fermerCtx(); return; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
    ev.preventDefault();
    const l = [...CTX.querySelectorAll('button')], i = l.indexOf(document.activeElement);
    l[(i + (ev.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length].focus();
  }
}, true);
