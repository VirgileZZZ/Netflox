/* 06-accompagnement.js
 *
 * Les fichiers bibliotheque.json: lecture, fusion, ecriture, et la source
 * d'un media (poignee locale ou adresse reseau).
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";
/* ========================================= fichier d'accompagnement == */
/* Repères de générique et catégories sont écrits dans un petit JSON déposé
   dans le dossier de la série, à côté de sa jaquette. Le navigateur ne peut
   écrire que si le dossier a été ouvert en lecture-écriture (Chrome/Edge). */
const SIDECAR = 'bibliotheque.json';

async function checkWrite(){
  if (S.mode !== 'fs' || !S.dirHandle) return false;
  try { return (await S.dirHandle.queryPermission({ mode:'readwrite' })) === 'granted'; }
  catch(e){ return false; }
}
/** Relit les fichiers d'accompagnement: ils font foi sur le stockage local. */
async function readSidecars(){
  if (S.mode !== 'fs') return 0;
  let found = 0;
  const stale = [];
  S.loading = true;
  try {
  for (const a of S.animes){
    const dir = S.seriesDirs.get(a.key);
    if (!dir) continue;
    let data;
    try {
      const fh = await dir.getFileHandle(SIDECAR);
      data = JSON.parse(await (await fh.getFile()).text());
    } catch(e){ continue; }                    // absent ou illisible: on ignore
    if (!data || typeof data !== 'object') continue;
    found++;
    // le fichier a voyage avec son dossier: s'il porte encore l'ancien nom,
    // c'est un renommage, et tout ce que le navigateur range dessous suit.
    if (data.serie && data.serie !== a.key && renommerSerie(data.serie, a.key))
      stale.push(a.key);
    if (Array.isArray(data.categories)) setCats(a.key, data.categories.filter(c => typeof c === 'string'));
    if (data.favori) setFav(a.key, true);
    if (typeof data.note === 'number') setNote(a.key, data.note);
    for (const [rel, v] of Object.entries(data.notes_episodes || {}))
      if (typeof v === 'number') setEpNote(a.key + '/' + rel, v);
    if (typeof data.note_imdb === 'number') setImdb(a.key, data.note_imdb);
    for (const [rel, v] of Object.entries(data.notes_episodes_imdb || {}))
      if (typeof v === 'number') setEpImdb(a.key + '/' + rel, v);
    if (typeof data.description === 'string') setDesc(a.key, data.description);
    for (const [rel, t] of Object.entries(data.titres_episodes || {}))
      if (typeof t === 'string') setEpTitre(a.key + '/' + rel, titreUtile(t));
    for (const [champ, prefixe] of [['generiques','intro.'], ['generiques_fin','outro.']]){
      const g = data[champ] || {};
      for (const rel of Object.keys(g)){
        const seg = g[rel];
        if (seg && typeof seg.start === 'number' && typeof seg.end === 'number' && seg.end > seg.start)
          store.set(prefixe + a.key + '/' + rel, { start: seg.start, end: seg.end });
      }
    }
    if (mergeProgress(a, data.progression)) stale.push(a.key);
  }
  } finally { S.loading = false; }
  // ce que le navigateur avait de plus frais n'était pas encore sur le disque
  stale.forEach(k => saveSidecar(k));
  return found;
}

/**
 * Fusionne la progression du fichier avec celle du navigateur: pour chaque
 * entrée, la plus récente gagne. Renvoie vrai si le navigateur était en avance,
 * auquel cas le fichier sera réécrit.
 */
function mergeProgress(a, prog){
  if (!prog || typeof prog !== 'object') return false;
  const oubli = store.get(OUBLI + a.key, 0);   // coup de balai: date de l'oubli
  let localAhead = false;
  const merge = (disk, here, keep) => {
    if (!disk || typeof disk.at !== 'number') return;
    if (disk.at <= oubli){ localAhead = true; return; }   // le fichier retarde: il sera reecrit
    const mine = here ? (here.at || 0) : -1;
    if (mine >= disk.at){ if (mine > disk.at) localAhead = true; return; }
    keep();
  };
  for (const [rel, v] of Object.entries(prog.videos || {})){
    const full = a.key + '/' + rel;
    if (!v || typeof v.t !== 'number' || typeof v.d !== 'number') continue;
    merge(v, store.get('pg.' + full, null),
          () => store.set('pg.' + full, { t: v.t, d: v.d, done: !!v.vu, at: v.at }));
  }
  for (const [rel, v] of Object.entries(prog.lectures || {})){
    const full = a.key + '/' + rel;
    if (!v || typeof v.p !== 'number') continue;
    merge(v, getReadPos(full), () => store.set(readKey(full), { p: v.p, at: v.at }));
  }
  for (const [ref, v] of Object.entries(prog.scans || {})){
    const spec = a.key + '|' + ref;
    if (!v || typeof v.p !== 'number') continue;
    merge(v, getScanPos(spec), () => store.set(scanKey(spec), { p: v.p, at: v.at }));
  }
  return localAhead;
}
/** Ce que la série doit retenir, sous la forme écrite dans le fichier. */
function sidecarData(a){
  const releve = (prefixe) => {
    const out = {};
    for (const e of a.episodes){
      const seg = store.get(prefixe + e.rel, null);
      if (seg && seg.start != null && seg.end != null && seg.end > seg.start)
        out[e.rel.slice(a.key.length + 1)] = {
          start: Math.round(seg.start * 100) / 100,
          end:   Math.round(seg.end   * 100) / 100
        };
    }
    return out;
  };
  const generiques = releve('intro.');
  const generiques_fin = releve('outro.');
  const videos = {};
  for (const e of a.episodes){
    const pg = getProgress(e);
    if (!pg || !pg.at || (!pg.done && pg.t <= 20)) continue;
    videos[e.rel.slice(a.key.length + 1)] = {
      t: Math.round(pg.t * 10) / 10, d: Math.round(pg.d * 10) / 10, vu: !!pg.done, at: pg.at
    };
  }
  const lectures = {};
  for (const d of a.docs){
    const pos = getReadPos(d.rel);
    if (!pos || !pos.at || pos.p < 0.005) continue;
    lectures[d.rel.slice(a.key.length + 1)] = { p: Math.round(pos.p * 1e4) / 1e4, at: pos.at };
  }
  const scans = {};
  for (const g of a.scanGroups || []) for (const c of g.chapters){
    const pos = getScanPos(chapSpec(a, g, c));
    if (!pos || !pos.at) continue;
    scans[g.key + '|' + c.key] = { p: pos.p, at: pos.at };
  }
  const progression = {};
  if (Object.keys(videos).length)   progression.videos = videos;
  if (Object.keys(lectures).length) progression.lectures = lectures;
  if (Object.keys(scans).length)    progression.scans = scans;

  const notesEp = {}, imdbEp = {}, titresEp = {};
  for (const e of a.episodes){
    const court = e.rel.slice(a.key.length + 1);
    const v = epNoteOf(e.rel);   if (v) notesEp[court] = v;
    const w = epImdbOf(e.rel);   if (w) imdbEp[court] = w;
    const t = epTitreOf(e.rel);  if (t) titresEp[court] = t;
  }
  const data = { version: 1, serie: a.key, categories: catsOf(a.key) };
  if (descOf(a.key)) data.description = descOf(a.key);
  if (noteOf(a.key)) data.note = noteOf(a.key);
  if (imdbOf(a.key)) data.note_imdb = imdbOf(a.key);
  if (Object.keys(notesEp).length) data.notes_episodes = notesEp;
  if (Object.keys(imdbEp).length)  data.notes_episodes_imdb = imdbEp;
  if (Object.keys(titresEp).length) data.titres_episodes = titresEp;
  data.generiques = generiques;
  if (Object.keys(generiques_fin).length) data.generiques_fin = generiques_fin;
  if (isFav(a.key)) data.favori = true;
  if (Object.keys(progression).length) data.progression = progression;
  return data;
}
/** Vrai quand il n'y a plus rien à retenir: le fichier est alors retiré. */
function sidecarEmpty(d){
  return !d.categories.length && !Object.keys(d.generiques).length &&
         !d.generiques_fin && !d.favori && !d.progression &&
         !d.note && !d.notes_episodes && !d.note_imdb &&
         !d.notes_episodes_imdb && !d.description && !d.titres_episodes;
}
async function writeSidecar(a){
  const dir = S.seriesDirs.get(a.key);
  if (!dir) return false;
  const data = sidecarData(a);
  try {
    if (sidecarEmpty(data)){
      try { await dir.removeEntry(SIDECAR); } catch(e){}
      return true;
    }
    const fh = await dir.getFileHandle(SIDECAR, { create:true });
    const w  = await fh.createWritable();
    await w.write(JSON.stringify(data, null, 2));
    await w.close();
    return true;
  } catch(e){
    console.warn('Écriture de ' + SIDECAR + ' impossible', e);
    return false;
  }
}
/* La progression bouge toutes les 4 secondes pendant la lecture: on note la
   série concernée et on n'écrit sur le disque qu'aux moments calmes (pause,
   fin d'épisode, fermeture du lecteur), pour ne pas marteler le fichier. */
const dirtySeries = new Set();
function touched(key){ if (key && !S.loading) dirtySeries.add(key); }
function flushProgress(){
  // appele aussi depuis beforeunload: un delai de 500 ms n'y survivrait pas
  for (const key of dirtySeries) saveSidecar(key, true);
  dirtySeries.clear();
}

const sidecarT = new Map();
let sidecarWarned = false;
/** Écriture différée: on regroupe les modifications rapprochées. `sansDelai`
    est pour les gestes qu'un rechargement immédiat ne doit pas défaire. */
function saveSidecar(key, sansDelai){
  if (!key || S.loading) return;      // pendant la relecture, on n'écrit rien
  if (S.shared) return;               // l'invité n'écrit chez personne, pas même un avertissement
  if (!S.canWrite){
    if (!sidecarWarned){
      sidecarWarned = true;
      toast('Gardé dans ce navigateur seulement : le dossier n\'est pas ouvert en écriture');
    }
    return;
  }
  clearTimeout(sidecarT.get(key));
  if (sansDelai){
    const a = S.byKey.get(key);
    if (a) writeSidecar(a);
    return;
  }
  sidecarT.set(key, setTimeout(async () => {
    const a = S.byKey.get(key);
    if (a) await writeSidecar(a);
  }, 500));
}

/* ------------------------------------------- fichiers -> source ------ */
async function fileOf(item){
  const r = item.ref;
  if (!r) return null;
  if (r.file) return r.file;
  if (r.kind === 'handle'){
    try { r.file = await r.handle.getFile(); return r.file; } catch(e){ return null; }
  }
  return null;
}
/** Adresse lisible par <video>/<img>, quelle que soit l'origine du fichier. */
async function srcOf(item){
  if (item.ref && item.ref.kind === 'url') return { url: item.ref.url, revoke: null };
  const f = await fileOf(item);
  if (!f) return null;
  const url = URL.createObjectURL(f);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
/**
 * Page ouverte en file:// : l'adresse directe du fichier, plutôt que le blob:.
 * Les deux se lisent pareil, mais RTX Video Super Resolution ne s'accroche qu'à
 * une vraie URL — devant un blob: elle reste éteinte sans rien dire.
 * L'adresse se reconstruit comme en mode partagé: le dossier racine, puis le
 * chemin relatif de l'épisode. Renvoie null dès qu'un doute subsiste; l'appelant
 * garde alors le blob:, et le repli est de toute façon armé côté lecteur.
 */
function urlDirecte(item){
  if (location.protocol !== 'file:') return null;
  if (!S.rootName || !item || !item.rel) return null;
  return encodeURIComponent(S.rootName) + '/' +
         item.rel.split('/').map(encodeURIComponent).join('/');
}

/* ================================================== drag and drop ==== */
async function readEntry(entry, path, out){
  if (!entry) return;
  if (entry.isFile){
    await new Promise(res => entry.file(f => {
      out.push({ path: path.concat(entry.name), size: f.size, lastModified: f.lastModified, ref: { kind:'file', file: f } });
      res();
    }, res));
  } else if (entry.isDirectory){
    if (shouldSkipDir(entry.name)) return;
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise(res => reader.readEntries(res, () => res([])));
      for (const e of batch) await readEntry(e, path.concat(entry.name), out);
    } while (batch.length);
  }
}
