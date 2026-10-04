/* 03-etat.js
 *
 * L'etat de l'application et tout ce qui se range dans le navigateur:
 * progression, notes, categories, favoris, renommages, messages.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */
"use strict";

/* ------------------------------------------------------------ état -- */
const $  = (s, r) => (r||document).querySelector(s);
const $$ = (s, r) => [...(r||document).querySelectorAll(s)];

/** Dossiers cherchés tout seuls à côté de la page, dans l'ordre. */
const AUTO_DIRS = ['videos/', 'video/', './'];

const S = {
  animes: [], byKey: new Map(), files: 0,
  mode: null,            // 'fs' (File System Access) | 'input' | 'http'
  dirHandle: null,
  seriesDirs: new Map(),   // nom de dossier de serie -> handle, pour ecrire dedans
  canWrite: false,
  shared: false,           // vrai sur une bibliotheque partagee: lecture seule
  host: { cats:{}, favs:{}, intro:{}, outro:{}, notes:{}, epNotes:{},
           imdb:{}, epImdb:{}, descs:{}, titres:{} },  // ce que l'hote a range, tel quel
  httpBase: null,
  rootName: '',
  view: 'home',
  animeKey: null,
  seasonKey: null,
  docKey: null,          // série affichée sur la page documents (null = index)
  current: null,         // épisode en lecture
  queue: [],             // épisodes de la série en cours
  query: '',
  filter: { sort:'note', docSort:'note' },   // la note d'abord: l'alphabet ne dit rien
  tsReady: null,         // null = pas testé, true/false = mpegts.js dispo
  tsPlayer: null,
  srcUrl: null,          // source en cours de lecture (blob: ou http:)
  srcRevoke: null,       // à appeler pour libérer srcUrl (null si ce n'est pas un blob)
  replier: null,         // adresse de repli si l'URL directe est refusée (voir urlDirecte)
  switching: false       // vrai pendant un changement d'épisode
};

/* ------------------------------------------------------- stockage --- */
const store = (() => {
  let mem = {};
  let ok = true;
  try { localStorage.setItem('ad2.t','1'); localStorage.removeItem('ad2.t'); }
  catch(e){ ok = false; }
  return {
    get(k, d){
      try { const v = ok ? localStorage.getItem('ad2.'+k) : mem[k];
            return v == null ? d : JSON.parse(v); }
      catch(e){ return d; }
    },
    set(k, v){
      const s = JSON.stringify(v);
      try { if (ok) localStorage.setItem('ad2.'+k, s); else mem[k] = s; }
      catch(e){ trimThumbs(); try { if (ok) localStorage.setItem('ad2.'+k, s); } catch(e2){} }
    },
    del(k){ try { if (ok) localStorage.removeItem('ad2.'+k); else delete mem[k]; } catch(e){} },
    keys(){ try { return ok ? Object.keys(localStorage).filter(k=>k.startsWith('ad2.')).map(k=>k.slice(4)) : Object.keys(mem); } catch(e){ return []; } }
  };
})();
function trimThumbs(){
  const keys = store.keys().filter(k => k.startsWith('th.'));
  keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => store.del(k));
}
const progressKey = (ep) => 'pg.' + ep.rel;
function getProgress(ep){ return store.get(progressKey(ep), null); }
function setProgress(ep, t, d){
  if (!d || !isFinite(d)) return;
  const pct = t / d;
  if (pct > 0.94 || t < 12){ store.set(progressKey(ep), { t: pct > 0.94 ? d : 0, d, done: pct > 0.94, at: Date.now() }); }
  else store.set(progressKey(ep), { t, d, done: false, at: Date.now() });
  touched(ep.anime);
}

/* Scans et textes retiennent une position et sa date, comme les vidéos: les
   trois médias peuvent alors être triés ensemble dans « Reprendre ».
   L'ancien format (un simple nombre) reste lisible. */
const scanKey = (spec) => 'sc.' + spec;
const readKey = (rel)  => 'rd.' + rel;
function normPos(v){
  if (v == null) return null;
  if (typeof v === 'number') return { p: v, at: 0 };   // écrit par une version précédente
  return (typeof v.p === 'number') ? { p: v.p, at: v.at || 0 } : null;
}
function getScanPos(spec){ return normPos(store.get(scanKey(spec), null)); }
function setScanPos(spec, page, key){
  store.set(scanKey(spec), { p: page, at: Date.now() });
  touched(key || String(spec).split('|')[0]);
}
function getReadPos(rel){ return normPos(store.get(readKey(rel), null)); }
function setReadPos(rel, pct, key){
  store.set(readKey(rel), { p: pct, at: Date.now() });
  touched(key || String(rel).split('/')[0]);
}

/* ------------------------------------------------------- favoris ---- */
function favMap(){ return S.shared ? S.host.favs : (store.get('favs', {}) || {}); }
function isFav(key){ return !!favMap()[key]; }
function setFav(key, on){
  if (lectureSeule()) return;
  const all = favMap();
  if (on) all[key] = Date.now(); else delete all[key];
  store.set('favs', all);
  saveSidecar(key);
}
function favList(){
  const all = favMap();
  return S.animes.filter(a => all[a.key]).sort((x,y) => all[y.key] - all[x.key]);
}

/* --------------------------------------------------------- notes ---- */
/* Une note sur dix, mise par l'hote seul: lui seul a un disque ou l'ecrire.
   L'invite la lit — la partager n'a d'interet que pour ca — mais l'interface
   qui la pose ne s'affiche pas chez lui, et setNote refuserait de toute facon.
   Les deux tables sont gardees en memoire: une note d'episode se relit une
   fois par vignette, et repasser par JSON.parse a chaque fois se sentirait. */
let noteCache = null, epNoteCache = null;
let imdbCache = null, epImdbCache = null, descCache = null, titreCache = null;
function noteMap(){
  if (S.shared) return S.host.notes;
  if (!noteCache) noteCache = store.get('notes', {}) || {};
  return noteCache;
}
function epNoteMap(){
  if (S.shared) return S.host.epNotes;
  if (!epNoteCache) epNoteCache = store.get('epnotes', {}) || {};
  return epNoteCache;
}
/* A cote de la mienne vit celle d'IMDb, reprise du fichier de la serie. Elle
   ne se clique pas: c'est une reference, pas un avis, et la modifier ici
   n'aurait aucun sens. Les deux pesent pareil dans ce qui s'affiche. */
function imdbMap(){
  if (S.shared) return S.host.imdb;
  if (!imdbCache) imdbCache = store.get('imdb', {}) || {};
  return imdbCache;
}
function epImdbMap(){
  if (S.shared) return S.host.epImdb;
  if (!epImdbCache) epImdbCache = store.get('epimdb', {}) || {};
  return epImdbCache;
}
function descMap(){
  if (S.shared) return S.host.descs;
  if (!descCache) descCache = store.get('descs', {}) || {};
  return descCache;
}
/* Le nom du fichier ne dit rien: « shingeki-no-kyojin_5.mp4 ». Le vrai titre
   de l'episode vient du fichier de la serie et lui est attache ici — le
   fichier sur le disque, lui, n'est jamais renomme. */
function titreMap(){
  if (S.shared) return S.host.titres;
  if (!titreCache) titreCache = store.get('titres', {}) || {};
  return titreCache;
}
function epTitreOf(rel){
  const t = titreMap()[rel];
  return typeof t === 'string' ? t : '';
}
function setEpTitre(rel, titre){
  if (lectureSeule()) return;
  const all = titreMap();
  titre = String(titre || '').trim();
  if (titre) all[rel] = titre; else delete all[rel];
  store.set('titres', all);
  saveSidecar(String(rel).split('/')[0]);
}
/* Une fois la bibliotheque batie, chaque episode connu prend son titre. Le
   faire ici plutot qu'a l'affichage evite d'y penser a chaque endroit qui
   nomme un episode: la liste, le lecteur, la carte du suivant. */
function appliquerTitres(){
  const tous = titreMap();
  for (const a of S.animes) for (const e of a.episodes){
    const t = titreUtile(tous[e.rel]);
    if (t) e.title = t;
  }
}
function imdbOf(key){ return normNote(imdbMap()[key]); }
function epImdbOf(rel){ return normNote(epImdbMap()[rel]); }
function descOf(key){ const d = descMap()[key]; return typeof d === 'string' ? d : ''; }
function setImdb(key, n){
  if (lectureSeule()) return;
  const all = imdbMap();
  n = normNote(n);
  if (n) all[key] = n; else delete all[key];
  store.set('imdb', all);
  saveSidecar(key);
}
function setEpImdb(rel, n){
  if (lectureSeule()) return;
  const all = epImdbMap();
  n = normNote(n);
  if (n) all[rel] = n; else delete all[rel];
  store.set('epimdb', all);
  saveSidecar(String(rel).split('/')[0]);
}
function setDesc(key, texte){
  if (lectureSeule()) return;
  const all = descMap();
  texte = String(texte || '').trim();
  if (texte) all[key] = texte; else delete all[key];
  store.set('descs', all);
  saveSidecar(key);
}
/* Les deux notes pesent pareil: leur moyenne. Si je n'ai pas note, il reste
   celle d'IMDb — et l'inverse pour une serie qu'IMDb ne connait pas. */
function melange(mine, imdb){
  if (mine && imdb) return Math.round((mine + imdb) * 5) / 10;
  return mine || imdb || 0;
}
/* 0 = pas de note. Tout le reste est ramene dans 1..10, a une decimale:
   les notes reprises d'IMDb en ont une, et l'arrondir a l'entier ferait d'un
   8,7 et d'un 9,4 la meme chose. Les etoiles, elles, posent des entiers. */
function normNote(v){
  const n = Math.round((+v || 0) * 10) / 10;
  return n >= 1 && n <= 10 ? n : 0;
}
function noteOf(key){ return normNote(noteMap()[key]); }
function epNoteOf(rel){ return normNote(epNoteMap()[rel]); }
function setNote(key, n){
  if (lectureSeule()) return;
  const all = noteMap();
  n = normNote(n);
  if (n) all[key] = n; else delete all[key];
  store.set('notes', all);
  saveSidecar(key);
}
function setEpNote(rel, n){
  if (lectureSeule()) return;
  const all = epNoteMap();
  n = normNote(n);
  if (n) all[rel] = n; else delete all[rel];
  store.set('epnotes', all);
  saveSidecar(String(rel).split('/')[0]);
}
/* Noter ses episodes un par un dit deja ce qu'on pense de la serie: faute de
   note d'ensemble, leur moyenne en tient lieu. Elle trie et s'affiche comme
   une vraie note, en disant d'ou elle vient. */
function epNoteAvg(a){
  let somme = 0, n = 0;
  for (const e of a.episodes){
    const v = melange(epNoteOf(e.rel), epImdbOf(e.rel));
    if (v){ somme += v; n++; }
  }
  return n ? Math.round(somme / n * 10) / 10 : 0;
}
/** Ce qu'une cible « s:cle » (serie) ou « e:chemin » (episode) vaut a l'ecran. */
function noteCible(cible){
  const genre = String(cible).slice(0, 1);
  const id    = String(cible).slice(2);
  if (genre === 'e'){
    const mine = epNoteOf(id), imdb = epImdbOf(id);
    return { id, ep:true, mine, imdb, note: melange(mine, imdb), auto:false };
  }
  const mine = noteOf(id), imdb = imdbOf(id);
  const note = melange(mine, imdb);
  const a = S.byKey.get(id);
  if (note || !a) return { id, ep:false, mine, imdb, note, auto:false };
  // ni l'un ni l'autre: restent les episodes, s'il y en a de notes
  return { id, ep:false, mine:0, imdb:0, note: epNoteAvg(a), auto:true };
}
function noteTri(a){ return noteCible('s:' + a.key).note; }

/* ------------------------------------- oubli d'une reprise en cours -- */
/* Le balai des tuiles « Reprendre ». Effacer la seule position affichée ne
   sert à rien: l'épisode d'avant remonterait aussitot à sa place. On oublie
   donc tout l'avancement de la série — vidéos, scans et lectures — d'un coup.
   Rien n'est supprimé sur le disque, et le message propose d'annuler. */
let lastForget = null;
/* Effacer les positions du navigateur ne suffit pas: bibliotheque.json les
   garde et les rendrait au rechargement suivant. On date donc l'oubli, et
   tout ce que le fichier contient de plus ancien est ignore puis reecrit. */
const OUBLI = 'oubli.';

/* ------------------------------------------------ dossier renomme ----
 * Tout ce que le navigateur retient d'une serie est range sous le nom de son
 * dossier: la progression, les notes, les categories, le favori, les reperes
 * de generique, les vignettes, les edits deja vus. Renommer le dossier sur le
 * disque — corriger une faute de frappe, par exemple — laisse donc tout ca
 * derriere, sous un nom que plus personne ne demande. Rien ne casse: la serie
 * revient simplement vierge, ce qui est pire, parce que ca ne se voit pas.
 *
 * On deplace donc les cles au lieu de les abandonner.
 */
function renommerSerie(ancien, nouveau){
  if (typeof ancien !== 'string' || typeof nouveau !== 'string') return 0;
  if (!ancien || !nouveau || ancien === nouveau) return 0;
  const vise = (s) => s === ancien || s.startsWith(ancien + '/');
  const mue  = (s) => nouveau + s.slice(ancien.length);
  let n = 0;

  // les cles a prefixe: pg.<chemin>, th.<chemin>, intro.<chemin>, oubli.<serie>...
  for (const k of store.keys()){
    const point = k.indexOf('.');
    if (point < 0) continue;                 // 'seen', 'vol', 'root': rien a voir
    const reste = k.slice(point + 1);
    if (!vise(reste)) continue;
    const v = store.get(k, null);
    if (v === null) continue;
    store.del(k);
    store.set(k.slice(0, point + 1) + mue(reste), v);
    n++;
  }
  // les tables, indexees par serie ou par chemin d'episode
  for (const nom of ['cats','favs','notes','imdb','descs','titres',
                     'epnotes','epimdb','edvus','edstats']){
    const t = store.get(nom, null);
    if (!t || typeof t !== 'object') continue;
    let touche = false;
    for (const k of Object.keys(t)){
      if (!vise(k)) continue;
      t[mue(k)] = t[k]; delete t[k]; touche = true; n++;
    }
    if (touche) store.set(nom, t);
  }
  // la liste des episodes connus au dernier scan, sinon tout passe pour neuf
  const seen = store.get('seen', null);
  if (Array.isArray(seen) && seen.some(vise))
    store.set('seen', seen.map(r => (vise(r) ? mue(r) : r)));

  // les tables gardees en memoire ont ete lues avant le deplacement
  noteCache = epNoteCache = imdbCache = epImdbCache = descCache = titreCache = null;
  edVusCache = edStatsCache = null;
  return n;
}
/* Les renommages deja faits avant que la detection ci-dessus existe: le
   fichier d'accompagnement a ete reecrit au nouveau nom entre-temps, il ne
   garde donc plus trace de l'ancien. Cette table se vide une fois passee. */
const RENOMMES = {
  'invicible-720p-vostfr': 'invincible-720p-vostfr',
  // un chemin d'episode marche aussi: progression, vignette, notes, « vu » suivent
  'mushoku-tensei-1080p-vostfr-multisub/saison1/mushoku-tensei_23.5.mp4':
    'mushoku-tensei-1080p-vostfr-multisub/saison1/mushoku-tensei_24.mp4',
};
/* Monter RENOMMES_VERSION a chaque ajout: la table repasse une fois, et ce qui
   a deja ete deplace n'a plus de cle a l'ancien nom, donc rien ne bouge deux fois. */
const RENOMMES_VERSION = 2;
function reparerRenommages(){
  if (store.get('renommes', 0) >= RENOMMES_VERSION) return;
  for (const [ancien, nouveau] of Object.entries(RENOMMES)) renommerSerie(ancien, nouveau);
  store.set('renommes', RENOMMES_VERSION);
}
function seriesOfResume(kind, ref){
  if (kind === 'scan') return ref.split('|')[0];
  return ref.split('/')[0];
}
/** Vrai pour une position de lecture appartenant à cette série. */
function isProgressKey(k, key){
  if (k.startsWith('pg.') || k.startsWith('rd.')) return k.slice(3).split('/')[0] === key;
  if (k.startsWith('sc.')) return k.slice(3).split('|')[0] === key;
  return false;
}
function forgetResume(id){
  const i = String(id).indexOf('|');
  const key = seriesOfResume(String(id).slice(0, i), String(id).slice(i + 1));
  const entries = [];
  for (const k of store.keys()) if (isProgressKey(k, key)) entries.push([k, store.get(k, null)]);
  if (!entries.length) return null;
  entries.forEach(([k]) => store.del(k));
  store.set(OUBLI + key, Date.now());
  lastForget = { entries, key };
  touched(key);
  saveSidecar(key, true);    // maintenant, pas au prochain moment calme
  return lastForget;
}
function undoForget(){
  if (!lastForget) return false;
  lastForget.entries.forEach(([k, v]) => store.set(k, v));
  store.del(OUBLI + lastForget.key);
  touched(lastForget.key);
  saveSidecar(lastForget.key, true);
  lastForget = null;
  return true;
}

/* ---------------------------------------------------------- toast --- */
let toastT;
function toast(msg, kind){
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast on' + (kind ? ' ' + kind : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.className = 'toast', 3200);
}
/** Message avec un bouton, pour revenir sur un geste qui efface quelque chose. */
function toastAction(msg, label, fn){
  const el = $('#toast');
  el.innerHTML = '';
  el.appendChild(document.createTextNode(msg));
  const b = document.createElement('button');
  b.className = 'tundo';
  b.textContent = label;
  b.addEventListener('click', () => { el.className = 'toast'; clearTimeout(toastT); fn(); });
  el.appendChild(b);
  el.className = 'toast on';
  clearTimeout(toastT);
  toastT = setTimeout(() => el.className = 'toast', 6000);
}
