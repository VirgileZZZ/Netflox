/* 01-outils.js
 *
 * Fonctions pures: formats, chemins, titres, tri, regroupement des scans.
 *
 * Charge par index.html, dans l'ordre. Script classique et non module:
 * une page ouverte en file:// ne peut pas charger de module — le navigateur
 * y voit une requete inter-origines et la refuse. Tous ces fichiers
 * partagent donc la meme portee globale, exactement comme quand ils ne
 * faisaient qu'un. L'ordre compte: il est celui de la liste dans la page.
 */

"use strict";
/* ==================================================================== */
/* ==== PURE LOGIC START ==== (fonctions pures, sans DOM ni état)       */
/* ==================================================================== */
const VIDEO_EXT  = ['mp4','m4v','webm','mov','mkv','ts','m2ts','avi','flv','ogv'];
const NATIVE_EXT = ['mp4','m4v','webm','mov','ogv'];
const TS_EXT     = ['ts','m2ts'];
const IMAGE_EXT  = ['jpg','jpeg','png','webp','avif','gif','bmp'];
const DOC_EXT    = ['pdf','epub','cbz','cbr','md','txt'];
const SKIP_DIR   = ['node_modules','.git','__pycache__','$recycle.bin','system volume information'];

function extOf(name){ const i = String(name).lastIndexOf('.'); return i < 1 ? '' : String(name).slice(i+1).toLowerCase(); }
function baseOf(name){ const i = String(name).lastIndexOf('.'); return i < 1 ? String(name) : String(name).slice(0,i); }
/* Ce qu'on range a cote des episodes plutot que dedans: les sous-titres, que
   le navigateur ne lit qu'en .vtt separe, et les autres langues, qu'il ne sait
   pas aller chercher dans un MP4 a plusieurs pistes. */
const DOSSIER_COTE = { 'sous-titres': 'sub', 'sous titres': 'sub', 'subs': 'sub',
                       'subtitles': 'sub', 'audio': 'aud', 'pistes': 'aud' };
const SUB_EXT = ['vtt'];
const AUD_EXT = ['m4a','mp3','aac','opus','ogg','wav'];
/**
 * Un fichier depose dans « sous-titres/ » ou « audio/ » sous une saison. Son
 * nom reprend celui de l'episode, suivi de la langue: game_3.fr.vtt se
 * rattache a game_3.mp4 de la meme saison.
 */
function coteGenre(p, name){
  const dirs = p.slice(0,-1);
  if (dirs.length < 2) return null;
  const genre = DOSSIER_COTE[String(dirs[dirs.length-1]).toLowerCase()];
  if (!genre) return null;
  const ext = extOf(name);
  if (!(genre === 'sub' ? SUB_EXT : AUD_EXT).includes(ext)) return null;
  const m = baseOf(name).match(/^(.+)\.([A-Za-z]{2,3}\d?)$/);
  if (!m) return null;
  return { genre, folder: dirs[0], seasonKey: dirs.slice(1,-1).join('/'),
           base: m[1], lang: m[2].toLowerCase() };
}
function coteOf(p, name, f){
  const c = coteGenre(p, name);
  if (!c) return null;
  c.name = name; c.rel = p.join('/');
  c.size = (f && f.size) || 0; c.ref = f && f.ref;
  return c;
}
/**
 * Ce qu'un scan doit ramasser. Un .vtt ou un .m4a n'est reconnu par aucun
 * `kindOf`: sans cette porte, le scan les jetait avant que le rattachement
 * puisse les voir, et les menus langue et sous-titres restaient vides.
 * Le chemin arrive tel que l'explorateur le donne, racine comprise.
 */
function fichierUtile(parts){
  const name = parts[parts.length - 1];
  if (!name) return false;
  return !!kindOf(name) || !!coteGenre(stripRoot(parts), name);
}
function kindOf(name){
  const e = extOf(name);
  if (VIDEO_EXT.includes(e)) return 'video';
  if (IMAGE_EXT.includes(e)) return 'image';
  if (DOC_EXT.includes(e))   return 'doc';
  return null;
}
function playModeOf(name){
  const e = extOf(name);
  if (NATIVE_EXT.includes(e)) return 'native';
  if (TS_EXT.includes(e))     return 'ts';
  if (e === 'mkv')            return 'maybe';
  return 'no';
}
function naturalCompare(a,b){
  return String(a).localeCompare(String(b), 'fr', { numeric:true, sensitivity:'base' });
}
/** Retire le dossier racine choisi ("videos", "video"…) du chemin relatif. */
function stripRoot(parts){
  const p = parts.slice();
  while (p.length > 1 && /^videos?$/i.test(p[0])) p.shift();
  return p;
}
/* Étiquettes reconnues à la fin d'un nom de dossier, dans n'importe quel ordre.
   Les sous-titres des sources anime-sama sont incrustés dans l'image (aucune piste
   de sous-titres dans les fichiers), donc VOSTFR décrit bien la vidéo elle-même. */
const QUALITY_TAG = /^(\d{3,4}p|4k|uhd|hd|sd)$/i;
const LANG_TAGS = {
  vostfr:'VOSTFR', vosta:'VOSTA', vostf:'VOSTF', vost:'VOST', vo:'VO',
  vf:'VF', vfq:'VFQ', vff:'VFF', multi:'MULTI', dub:'DUB', sub:'SUB', raw:'RAW'
};
/* Sous-titres au choix, en .vtt a cote des episodes, plutot qu'incrustes dans
   l'image. Une etiquette a part: elle ne dit rien de la langue parlee, et
   splitTags s'arrete au premier mot inconnu — sans elle, un dossier
   « xxx-720p-vostfr-multisub » perdait aussi son 720p et son VOSTFR. */
const SUB_TAGS = { multisub:'MULTISUB', multisubs:'MULTISUB', msubs:'MULTISUB' };
/** "xxx-720p-vostfr" -> { name:"xxx", quality:"720p", lang:"VOSTFR" } */
function splitTags(folder){
  let name = String(folder), quality = null, lang = null, subs = null;
  for (let i = 0; i < 4; i++){
    const m = name.match(/[-_. ]([A-Za-z0-9]+)$/);
    if (!m) break;
    const tag = m[1], low = tag.toLowerCase();
    if (!quality && QUALITY_TAG.test(tag))      quality = /^(4k|uhd|hd|sd)$/i.test(tag) ? tag.toUpperCase() : low;
    else if (!lang && LANG_TAGS[low] !== undefined) lang = LANG_TAGS[low];
    else if (!subs && SUB_TAGS[low] !== undefined) subs = SUB_TAGS[low];
    else break;
    name = name.slice(0, m.index);
  }
  return { name, quality, lang, subs };
}
const KEEP_UP = new Set(['tv','ova','oav','ona','ln','sp','hs','jjk','ost','bd','vf','va','fr','en','jp','ii','iii','iv','vi','vii']);
const SMALL_W = new Set(['et','de','du','des','la','le','les','un','une','au','aux','the','of','and','a','no','ni','wa','ga','to','na','ka']);
function prettify(raw){
  const words = String(raw).replace(/[_.]+/g,' ').replace(/-+/g,' ').trim().split(/\s+/).filter(Boolean);
  return words.map((w,i)=>{
    const low = w.toLowerCase();
    if (KEEP_UP.has(low)) return low.toUpperCase();
    if (/^\d+$/.test(low)) return low;
    if (i > 0 && SMALL_W.has(low)) return low;
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ');
}
function seasonLabel(raw){
  if (!raw) return 'Épisodes';
  const t = String(raw).toLowerCase().trim();
  let m = t.match(/^(?:saison|season|s)[ _-]?(\d+)(?:[ _-](\d+))?$/);
  if (m) return 'Saison ' + m[1] + (m[2] ? ' · Partie ' + m[2] : '');
  if (/^films?$/.test(t) || /^movies?$/.test(t)) return 'Films';
  if (/^(oav|ova|ona)s?$/.test(t)) return t.slice(0,3).toUpperCase();
  if (/^(ln|novels?|light[ _-]?novels?)$/.test(t)) return 'Light novel';
  if (/^scans?$/.test(t)) return 'Scans';
  if (/^(hs|hors[ _-]?serie|hors[ _-]?série)$/.test(t)) return 'Hors-série';
  if (/^(sp|specials?|speciaux|spéciaux)$/.test(t)) return 'Spéciaux';
  return prettify(raw);
}
/** Clé de tri d'une saison: [rang, partie]. Films/OAV/LN passent après les saisons. */
function seasonRank(raw){
  const t = String(raw || '').toLowerCase().trim();
  if (/^films?$|^movies?$/.test(t))        return [900, 0];
  if (/^(oav|ova|ona)s?$/.test(t))         return [910, 0];
  if (/^(sp|specials?|speciaux)$/.test(t)) return [920, 0];
  if (/^(hs|hors[ _-]?serie)/.test(t))     return [930, 0];
  if (/^(ln|novel|light[ _-]?novel)/.test(t)) return [960, 0];
  if (/^scans?$/.test(t))                  return [970, 0];
  const m = t.match(/(\d+)(?:[ _.-](\d+))?/);
  if (!m) return [800, 0];
  return [parseInt(m[1],10), m[2] ? parseInt(m[2],10) : 0];
}
/** Numéro d'épisode déduit du nom de fichier. */
function episodeNumber(fileBase){
  const b = String(fileBase);
  /* Un chiffre apres la virgule: les speciaux s'intercalent en 23.5. Sans lui,
     « serie_23.5 » se lisait « .5 » et le special passait pour l'episode 5.
     Un seul chiffre: « serie.2023.12 » doit rester l'episode 12. */
  let m = b.match(/[_\-. ](\d{1,4}(?:\.\d)?)$/);
  if (m) return parseFloat(m[1]);
  m = b.match(/(?:^|[^a-z0-9])(?:ep?|episode|épisode)[ _.\-]?(\d{1,4})(?![0-9])/i);
  if (m) return parseInt(m[1],10);
  m = b.match(/(?:^|[^a-z0-9])s\d{1,2}e(\d{1,4})(?![0-9])/i);
  if (m) return parseInt(m[1],10);
  const nums = b.match(/\d{1,4}/g);
  if (nums) return parseInt(nums[nums.length-1],10);
  return null;
}
/** Titre lisible d'un épisode: on retire le nom de la série et le numéro. */
function episodeTitle(fileBase, animeFolder, ep){
  let s = String(fileBase);
  if (animeFolder){
    const re = new RegExp('^' + animeFolder.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[ _.\\-]*', 'i');
    s = s.replace(re, '');
  }
  s = s.replace(/^[ _.\-]+|[ _.\-]+$/g,'');
  if (ep != null) s = s.replace(new RegExp('^0*' + String(ep).replace('.', '\.') + '$'), '');
  s = s.replace(/^[ _.\-]+|[ _.\-]+$/g,'');
  if (!s || /^\d+$/.test(s)) return ep != null ? 'Épisode ' + ep : prettify(fileBase);
  return prettify(s);
}
/** Numéro de tome déduit d'un nom de fichier ("… Volume-12" -> 12). */
function volumeNumber(base){
  const b = String(base);
  let m = b.match(/(?:volumes?|vol|tomes?|tomo|books?|livres?|t)[ _.\-–—#]*(\d{1,3})(?![0-9])/i);
  if (m) return parseInt(m[1],10);
  m = b.match(/(?:^|[^0-9])(\d{1,3})\s*$/);
  if (m) return parseInt(m[1],10);
  return null;
}
/**
 * Range les documents d'une série en collections (Light novel, Scans…),
 * chaque collection groupant les tomes et leurs formats disponibles.
 */
function groupDocs(docs){
  const groups = new Map();
  for (const d of docs){
    if (!groups.has(d.group)){
      groups.set(d.group, {
        key: d.group,
        label: d.group ? seasonLabel(d.group) : 'Documents',
        vols: new Map(), loose: [], formats: new Set()
      });
    }
    const g = groups.get(d.group);
    g.formats.add(d.ext);
    if (d.vol == null){ g.loose.push(d); continue; }
    if (!g.vols.has(d.vol)) g.vols.set(d.vol, { vol: d.vol, title: 'Volume ' + d.vol, byExt: {} });
    const v = g.vols.get(d.vol);
    if (!v.byExt[d.ext] || d.size > v.byExt[d.ext].size) v.byExt[d.ext] = d;
  }
  const rank = (e) => { const i = DOC_EXT.indexOf(e); return i < 0 ? 99 : i; };
  return [...groups.values()].map(g => ({
    key: g.key, label: g.label,
    formats: [...g.formats].sort((a,b) => rank(a) - rank(b) || naturalCompare(a,b)),
    volumes: [...g.vols.values()].sort((a,b) => a.vol - b.vol),
    loose: g.loose.sort((a,b) => naturalCompare(a.name, b.name))
  })).sort((a,b) => naturalCompare(a.label, b.label));
}
/* --------------------------------------------------------- scans ---- */
/* Un dossier d'images sous une série est un chapitre; le dossier qui les
   contient est la collection. Il faut au moins quelques pages pour qu'un
   dossier compte comme chapitre, sinon une simple capture d'écran suffirait. */
const MIN_PAGES = 3;

/** Numéro de chapitre déduit d'un nom de dossier ("Chapter 10.5" -> 10.5). */
function chapterNumber(name){
  const s = String(name);
  let m = s.match(/(?:chapitres?|chapters?|chap|ch|tomes?|vol|episodes?|ep)[ _.\-#]*(\d{1,4}(?:[.,]\d+)?)/i);
  if (m) return parseFloat(m[1].replace(',', '.'));
  m = s.match(/(\d{1,4}(?:[.,]\d+)?)\s*$/);
  if (m) return parseFloat(m[1].replace(',', '.'));
  return null;
}
/**
 * Range les images d'une série en collections de chapitres.
 * Marque au passage les images utilisées, pour qu'elles ne soient pas
 * candidates comme jaquette de la série.
 */
function groupScans(images){
  const byDir = new Map();
  for (const img of images){
    const dirs = img.dirs || [];
    if (!dirs.length) continue;                        // image à la racine de la série
    const key = dirs.join('/');
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push(img);
  }
  const groups = new Map();
  for (const key of [...byDir.keys()].sort(naturalCompare)){
    const pages = byDir.get(key);
    if (pages.length < MIN_PAGES) continue;
    pages.forEach(p => { p.inChapter = true; });
    const parts = key.split('/');
    const gKey  = parts[0];
    const cKey  = parts.slice(1).join('/');
    if (!groups.has(gKey)) groups.set(gKey, { key: gKey, label: seasonLabel(gKey), chapters: [] });
    const num = chapterNumber(cKey || gKey);
    groups.get(gKey).chapters.push({
      key: cKey, num,
      title: num != null ? 'Chapitre ' + num : prettify(cKey || gKey),
      pages: pages.slice().sort((x,y) => naturalCompare(x.name, y.name))
    });
  }
  return [...groups.values()].map(g => {
    g.chapters.sort((x,y) => (x.num == null ? 1e9 : x.num) - (y.num == null ? 1e9 : y.num) || naturalCompare(x.key, y.key));
    g.pageCount = g.chapters.reduce((n,c) => n + c.pages.length, 0);
    return g;
  }).sort((x,y) => naturalCompare(x.label, y.label));
}

function shouldSkipDir(name){
  const n = String(name).toLowerCase();
  return SKIP_DIR.includes(n) || n === 'assets' || n === 'js';
}
/** Choisit la meilleure image comme jaquette. */
function pickArt(images, animeFolder){
  if (!images || !images.length) return null;
  const key = String(animeFolder||'').toLowerCase();
  const score = (img) => {
    const b = baseOf(img.name).toLowerCase();
    let s = 0;
    if (/^(cover|poster|folder|affiche|banner|art|thumb|show)$/.test(b)) s += 6;
    if (key && b === key) s += 5;
    if (key && (key.includes(b) || b.includes(key))) s += 3;
    return s;
  };
  // l'image la plus proche de la racine de la série la représente le mieux
  return images.slice().sort(
    (a,b) => (a.depth||0) - (b.depth||0) || score(b) - score(a) || naturalCompare(a.name,b.name)
  )[0];
}